import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GitRepositories } from "@codexhost/shared-contracts";
import { GitWorkspaceError } from "./git-workspace.js";

const linkSchema = z.object({ project: z.string(), repository: z.string() }).strict();
const key = (value: string): string => createHash("sha256").update(value).digest("hex");

// 每个关联独立原子落盘，多个 Host 连接同时添加不同仓库不会覆盖彼此的记录。
export class GitRepositoryLinks {
  constructor(
    private readonly home: string,
    private readonly root: (cwd: string) => Promise<string | null>,
    private readonly submoduleRoot: (
      cwd: string,
      path: string,
    ) => Promise<string | null> = async () => null,
    // 由组合根注入的前缀扫描：会话项目目录本身不是仓库时，用它找出目录内的一级子仓库。
    private readonly scanChildRepositories: (
      project: string,
    ) => Promise<readonly string[]> = async () => [],
    private readonly files: {
      paths: typeof path;
      realpath: (directory: string) => Promise<string>;
    } = { paths: path, realpath },
  ) {}

  async #project(cwd: string): Promise<string> {
    return (await this.root(cwd)) ?? this.files.realpath(cwd);
  }

  #directory(project: string): string {
    return path.join(this.home, "git-repository-links", key(project));
  }

  // discover 只在展示仓库清单时打开：工作流与授权判定沿用显式关联，避免每次 Git 操作都扫描目录。
  async list(cwd: string, options: { discover?: boolean } = {}): Promise<GitRepositories> {
    const project = await this.#project(cwd);
    const directory = this.#directory(project);
    const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    });
    const links = await Promise.all(
      files
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            const link = linkSchema.parse(
              JSON.parse(await readFile(path.join(directory, name), "utf8")),
            );
            if (link.project !== project) {
              throw new GitWorkspaceError("关联仓库记录与当前项目不匹配。");
            }
            return link.repository;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              return null;
            }
            throw error;
          }
        }),
    );
    const linked = new Set(
      links.filter((item): item is string => item !== null && item !== project),
    );
    const nested = options.discover ? await this.#childRepositories(project, linked) : [];
    return {
      project,
      repositories: [
        { path: project, primary: true },
        ...[...linked, ...nested].sort().map((repository) => ({
          path: repository,
          primary: false,
          // 自动识别的仓库不由本机关联记录保管，界面据此区分它与显式关联。
          ...(linked.has(repository) ? {} : { discovered: true }),
        })),
      ],
    };
  }

  async link(cwd: string, repository: string): Promise<GitRepositories> {
    if (!this.files.paths.isAbsolute(repository)) {
      throw new GitWorkspaceError("请输入 Git 仓库的绝对路径。");
    }
    const project = await this.#project(cwd);
    const root = await this.root(repository);
    if (!root) {
      throw new GitWorkspaceError("所选目录不是 Git 仓库。");
    }
    if (root !== project) {
      const directory = this.#directory(project);
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, `${key(root)}.json`);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ project, repository: root }) + "\n", {
          mode: 0o600,
        });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    return this.list(cwd, { discover: true });
  }

  async unlink(cwd: string, repository: string): Promise<GitRepositories> {
    const project = await this.#project(cwd);
    if (repository === project) {
      throw new GitWorkspaceError("不能解除会话主项目的关联。");
    }
    const record = path.join(this.#directory(project), `${key(repository)}.json`);
    if (
      !(await this.#recordExists(record)) &&
      (await this.#isChildRepository(project, repository))
    ) {
      throw new GitWorkspaceError("项目目录内的仓库由目录自动识别，无需解除关联。");
    }
    // 已删除或移动的仓库也能解除关联；只移除本机记录，不修改仓库内容。
    await rm(record, { force: true });
    return this.list(cwd, { discover: true });
  }

  async resolve(cwd: string, repository?: string): Promise<string> {
    const project = await this.#project(cwd);
    if (!repository) {
      return project;
    }
    const known = await this.list(cwd);
    if (known.repositories.some((entry) => entry.path === repository)) {
      // 仓库路径后来被替换为指向其他位置的符号链接时，不沿用旧关联授权。
      if ((await this.root(repository)) !== repository) {
        throw new GitWorkspaceError("关联仓库的位置已变化，请重新关联。");
      }
      return repository;
    }

    // 关联仓库的递归子模块也属于当前项目；普通嵌套仓库仍需显式关联。
    for (const owner of known.repositories) {
      const relative = this.files.paths.relative(owner.path, repository);
      if (!relative || relative.startsWith("..") || this.files.paths.isAbsolute(relative)) {
        continue;
      }
      const ownerRoot = await this.root(owner.path);
      if (owner.primary && ownerRoot === null) {
        continue;
      }
      if (ownerRoot !== owner.path) {
        throw new GitWorkspaceError("关联仓库的位置已变化，请重新关联。");
      }
      const submodulePath = relative.split(this.files.paths.sep).join("/");
      const submoduleRoot = await this.submoduleRoot(owner.path, submodulePath);
      if (!submoduleRoot) {
        continue;
      }
      const submodule = await this.root(repository);
      if (!submodule) {
        throw new GitWorkspaceError("该子模块目录不是 Git 仓库，请先初始化或更新子模块。");
      }
      if (submodule !== repository || submodule !== submoduleRoot) {
        throw new GitWorkspaceError("子模块的位置已变化，请重新更新子模块。");
      }
      return repository;
    }

    // 会话项目目录本身不是仓库时，目录内自动识别的一级子仓库可直接操作。
    if (await this.#isChildRepository(project, repository)) {
      return repository;
    }
    throw new GitWorkspaceError("该仓库尚未关联当前项目，请先关联再操作。");
  }

  // 关联记录是“解除关联”的唯一依据，缺失时自动识别的仓库没有可移除的对象。
  async #recordExists(record: string): Promise<boolean> {
    try {
      await stat(record);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  // 只接受项目目录的直接子目录，且该子目录自身就是仓库根；更深层或嵌套仓库仍需显式关联。
  async #isChildRepository(project: string, repository: string): Promise<boolean> {
    if (this.files.paths.dirname(repository) !== project) {
      return false;
    }
    if ((await this.root(project)) !== null) {
      return false;
    }
    return (await this.root(repository)) === repository;
  }

  // 项目目录本身是仓库时不做子目录扫描：目录内的仓库属于嵌套仓库，仍需显式关联。
  async #childRepositories(project: string, linked: ReadonlySet<string>): Promise<string[]> {
    if ((await this.root(project)) !== null) {
      return [];
    }
    const discovered = await this.scanChildRepositories(project);
    return [...new Set(discovered)]
      .filter((repository) => repository !== project && !linked.has(repository))
      .sort();
  }
}
