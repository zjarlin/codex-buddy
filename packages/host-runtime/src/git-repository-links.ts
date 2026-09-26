import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
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
  ) {}

  async #project(cwd: string): Promise<string> {
    return (await this.root(cwd)) ?? realpath(cwd);
  }

  #directory(project: string): string {
    return path.join(this.home, "git-repository-links", key(project));
  }

  async list(cwd: string): Promise<GitRepositories> {
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
    return {
      project,
      repositories: [
        { path: project, primary: true },
        ...[...new Set(links.filter((item): item is string => item !== null && item !== project))]
          .sort()
          .map((repository) => ({ path: repository, primary: false })),
      ],
    };
  }

  async link(cwd: string, repository: string): Promise<GitRepositories> {
    if (!path.isAbsolute(repository)) {
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
    return this.list(cwd);
  }

  async unlink(cwd: string, repository: string): Promise<GitRepositories> {
    const project = await this.#project(cwd);
    if (repository === project) {
      throw new GitWorkspaceError("不能解除会话主项目的关联。");
    }
    // 已删除或移动的仓库也能解除关联；只移除本机记录，不修改仓库内容。
    await rm(path.join(this.#directory(project), `${key(repository)}.json`), { force: true });
    return this.list(cwd);
  }

  async resolve(cwd: string, repository?: string): Promise<string> {
    const project = await this.#project(cwd);
    if (!repository) {
      return project;
    }
    const known = await this.list(cwd);
    if (!known.repositories.some((entry) => entry.path === repository)) {
      throw new GitWorkspaceError("该仓库尚未关联当前项目，请先关联再操作。");
    }
    // 仓库路径后来被替换为指向其他位置的符号链接时，不沿用旧关联授权。
    if ((await this.root(repository)) !== repository) {
      throw new GitWorkspaceError("关联仓库的位置已变化，请重新关联。");
    }
    return repository;
  }
}
