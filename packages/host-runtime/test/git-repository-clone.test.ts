import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { discoverChildRepositories } from "../src/git-child-repositories.js";
import { cloneGitRepository } from "../src/git-repository-clone.js";
import { GitRepositoryLinks } from "../src/git-repository-links.js";
import { GitWorkspace } from "../src/git-workspace.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// 会话项目目录是按领域分组的容器目录，本身不是仓库；仓库作为它的同级目录出现。
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "codexhost-git-clone-")));
  directories.push(root);
  const group = path.join(root, "company-projects");
  const project = path.join(group, "backend");
  const source = path.join(root, "source");
  const remote = path.join(root, "source.git");
  const environment = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "protocol.file.allow",
    GIT_CONFIG_VALUE_0: "always",
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { env: environment, encoding: "utf8" });
  await mkdir(group);
  await mkdir(project);
  await mkdir(source);
  git(source, "init", "-q");
  git(source, "config", "user.email", "test@example.com");
  git(source, "config", "user.name", "Test");
  git(source, "config", "commit.gpgsign", "false");
  await writeFile(path.join(source, "app.txt"), "cloned\n");
  git(source, "add", ".");
  git(source, "commit", "-qm", "initial");
  execFileSync("git", ["clone", "-q", "--bare", source, remote], { env: environment });
  const workspace = new GitWorkspace();
  const links = new GitRepositoryLinks(
    path.join(root, "home"),
    (cwd) => workspace.root(cwd),
    (cwd, submodule) => workspace.submoduleRoot(cwd, submodule),
    (candidate) => discoverChildRepositories(workspace, candidate),
  );
  return { root, group, project, remote, links, workspace };
}

test("clones a Git address into the parent of the session project and links it", async () => {
  const { group, project, remote, links, workspace } = await fixture();
  const result = await cloneGitRepository(
    { cwd: project, remote },
    { git: workspace, links, cwd: project },
  );
  const target = path.join(group, "source");
  expect(result.project).toBe(project);
  expect(result.repositories).toEqual([
    { path: project, primary: true },
    { path: await realpath(target), primary: false },
  ]);
  // Windows 检出会按 core.autocrlf 换成 CRLF，比较内容而不是行尾。
  const cloned = await readFile(path.join(target, "app.txt"), "utf8");
  expect(cloned.replaceAll("\r\n", "\n")).toBe("cloned\n");
  // 克隆结果与当前项目平级，而不是落在项目目录内部。
  expect(path.dirname(target)).toBe(group);
}, 60_000);

test("honors an explicit parent directory and rejects occupied destinations", async () => {
  const { root, project, remote, links, workspace } = await fixture();
  const parent = path.join(root, "elsewhere");
  await mkdir(parent);
  const result = await cloneGitRepository(
    { cwd: project, remote, parent },
    { git: workspace, links, cwd: project },
  );
  const target = await realpath(path.join(parent, "source"));
  expect(result.repositories.map((entry) => entry.path)).toContain(target);
  await expect(
    cloneGitRepository({ cwd: project, remote, parent }, { git: workspace, links, cwd: project }),
  ).rejects.toThrow("目标目录已存在");
}, 60_000);

test("rejects invalid addresses, non-repository sources and missing parent directories", async () => {
  const { root, project, remote, links, workspace } = await fixture();
  const clone = (input: { remote: string; parent?: string }) =>
    cloneGitRepository({ cwd: project, ...input }, { git: workspace, links, cwd: project });
  await expect(clone({ remote: "https://user:secret@example.com/repo.git" })).rejects.toThrow(
    "Git 地址无效",
  );
  await expect(clone({ remote: "not a remote" })).rejects.toThrow("Git 地址无效");
  await expect(clone({ remote, parent: path.join(root, "missing") })).rejects.toThrow(
    "目标目录不存在",
  );
  // 远端目录本身不是 Git 仓库时，git clone 失败并给出本地化错误。
  const plain = path.join(root, "plain");
  const elsewhere = path.join(root, "elsewhere-source");
  await mkdir(plain);
  await mkdir(elsewhere);
  await expect(clone({ remote: plain, parent: elsewhere })).rejects.toThrow("找不到 Git 远程仓库");
}, 60_000);
