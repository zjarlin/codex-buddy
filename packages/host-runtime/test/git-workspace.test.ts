import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitWorkspace } from "../src/git-workspace.js";

const testGitEnvironment = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "protocol.file.allow",
  GIT_CONFIG_VALUE_0: "always",
};

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function repository(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "codexhost-git-"));
  cleanup.push(directory);
  await execFileAsync("git", ["init", "-q", directory]);
  await execFileAsync("git", ["-C", directory, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", directory, "config", "user.name", "Test"]);
  await writeFile(path.join(directory, "tracked.txt"), "one\n");
  await execFileAsync("git", ["-C", directory, "add", "tracked.txt"]);
  await execFileAsync("git", ["-C", directory, "commit", "-qm", "init"]);
  return directory;
}

async function submoduleRepository(): Promise<{ parent: string; child: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "codexhost-git-submodule-"));
  cleanup.push(root);
  const child = path.join(root, "child");
  const parent = path.join(root, "parent");
  await execFileAsync("git", ["init", "-q", child]);
  await execFileAsync("git", ["-C", child, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", child, "config", "user.name", "Test"]);
  await writeFile(path.join(child, "child.txt"), "child\n");
  await execFileAsync("git", ["-C", child, "add", "child.txt"]);
  await execFileAsync("git", ["-C", child, "commit", "-qm", "child"]);
  await execFileAsync("git", ["init", "-q", parent]);
  await execFileAsync("git", ["-C", parent, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", parent, "config", "user.name", "Test"]);
  await writeFile(path.join(parent, "parent.txt"), "parent\n");
  await execFileAsync("git", ["-C", parent, "add", "parent.txt"]);
  await execFileAsync("git", ["-C", parent, "commit", "-qm", "parent"]);
  await execFileAsync("git", [
    "-C",
    parent,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    child,
    "vendor/child",
  ]);
  await execFileAsync("git", ["-C", parent, "commit", "-qm", "add submodule"]);
  await execFileAsync("git", ["-C", parent, "config", "protocol.file.allow", "always"]);
  return { parent, child };
}

describe("GitWorkspace", () => {
  // 建立一个带真实 file:// 远端的克隆，供同步/推送分叉用例使用。
  async function cloneWithRemote(): Promise<{
    clone: string;
    remote: string;
    advanceRemote: (content?: string) => Promise<void>;
  }> {
    const root = await mkdtemp(path.join(tmpdir(), "codexhost-git-remote-"));
    cleanup.push(root);
    const remote = path.join(root, "remote.git");
    const source = path.join(root, "source");
    const clone = path.join(root, "clone");
    await execFileAsync("git", ["init", "-q", "--bare", remote]);
    // 让裸远端默认指向 main，克隆后才有跟踪分支可同步。
    await execFileAsync("git", ["-C", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
    await execFileAsync("git", ["init", "-q", source]);
    await execFileAsync("git", ["-C", source, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", source, "config", "user.name", "Test"]);
    await writeFile(path.join(source, "tracked.txt"), "base\n");
    await execFileAsync("git", ["-C", source, "add", "tracked.txt"]);
    await execFileAsync("git", ["-C", source, "commit", "-qm", "init"]);
    await execFileAsync("git", ["-C", source, "remote", "add", "origin", remote]);
    await execFileAsync("git", ["-C", source, "push", "-q", "origin", "HEAD:main"]);
    await execFileAsync("git", ["clone", "-q", remote, clone]);
    await execFileAsync("git", ["-C", clone, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", clone, "config", "user.name", "Test"]);
    const advanceRemote = async (content = "remote\n"): Promise<void> => {
      await writeFile(path.join(source, "tracked.txt"), content);
      await execFileAsync("git", ["-C", source, "commit", "-qam", "remote"]);
      await execFileAsync("git", ["-C", source, "push", "-q", "origin", "HEAD:main"]);
    };
    return { clone, remote, advanceRemote };
  }

  // 远端与克隆共用一个 push 目标，用于验证 non-fast-forward 拒绝。
  async function divergedClone(): Promise<{ clone: string; advanceRemote: () => Promise<void> }> {
    const { clone, advanceRemote } = await cloneWithRemote();
    return { clone, advanceRemote: () => advanceRemote("remote divergence\n") };
  }

  it("reports staged, modified, untracked and renamed files", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "tracked.txt"), "two\n");
    await writeFile(path.join(directory, "new.txt"), "new\n");
    await execFileAsync("git", ["-C", directory, "mv", "tracked.txt", "renamed.txt"]);
    await writeFile(path.join(directory, "renamed.txt"), "two\nthree\n");

    const workspace = new GitWorkspace(testGitEnvironment);
    const status = await workspace.status(directory);

    expect(status.workspace).toBe(directory);
    expect(status.branch).toBeTruthy();
    expect(status.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "renamed.txt", originalPath: "tracked.txt", staged: true }),
        expect.objectContaining({ path: "new.txt", untracked: true }),
      ]),
    );
  });

  it("localizes a missing repository error instead of exposing raw git output", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-not-git-"));
    cleanup.push(directory);

    await expect(new GitWorkspace(testGitEnvironment).status(directory)).rejects.toMatchObject({
      name: "GitWorkspaceError",
      message: "当前目录不是 Git 仓库。",
    });
  });

  it("shows an untracked file diff", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "new.txt"), "new\n");

    const result = await new GitWorkspace().diff(directory, "new.txt");

    expect(result.diff).toContain("new file mode");
    expect(result.diff).toContain("+new");
  });

  it("returns both sides of a changed and untracked file", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "tracked.txt"), "two\n");
    await writeFile(path.join(directory, "new.txt"), "new\n");
    const workspace = new GitWorkspace(testGitEnvironment);

    const tracked = await workspace.content(directory, "tracked.txt");
    expect(tracked).toMatchObject({
      path: "tracked.txt",
      baseLabel: "HEAD",
      base: "one\n",
      working: "two\n",
      conflicted: false,
      ours: null,
      theirs: null,
      binary: false,
    });
    expect(tracked.revision).toMatch(/^[a-f0-9]{64}$/u);

    await expect(workspace.content(directory, "new.txt")).resolves.toMatchObject({
      path: "new.txt",
      baseLabel: "空文件",
      base: "",
      working: "new\n",
      conflicted: false,
    });
  });

  it("returns conflict stages for a conflicted file", async () => {
    const directory = await repository();
    await execFileAsync("git", ["-C", directory, "checkout", "-qb", "feature"]);
    await writeFile(path.join(directory, "tracked.txt"), "feature\n");
    await execFileAsync("git", ["-C", directory, "commit", "-qam", "feature"]);
    await execFileAsync("git", ["-C", directory, "checkout", "-q", "-"]);
    await writeFile(path.join(directory, "tracked.txt"), "main\n");
    await execFileAsync("git", ["-C", directory, "commit", "-qam", "main"]);
    await expect(execFileAsync("git", ["-C", directory, "merge", "feature"])).rejects.toMatchObject(
      { code: 1 },
    );
    await writeFile(
      path.join(directory, "tracked.txt"),
      "main\n<<<<<<< HEAD\nmain\n=======\nfeature\n>>>>>>> feature\n",
    );

    const result = await new GitWorkspace(testGitEnvironment).content(directory, "tracked.txt");

    expect(result).toMatchObject({
      path: "tracked.txt",
      baseLabel: "BASE",
      base: "one\n",
      conflicted: true,
      ours: "main\n",
      theirs: "feature\n",
    });
  });

  it("previews dirty, uninitialized, orphaned and deleted submodules without reading directories", async () => {
    const { parent } = await submoduleRepository();
    const directory = path.join(parent, "vendor/child");
    const git = (...args: string[]) => execFileAsync("git", ["-C", parent, ...args]);
    const workspace = new GitWorkspace(testGitEnvironment);
    await writeFile(path.join(directory, "child.txt"), "dirty child\n");
    expect((await workspace.diff(parent, "vendor/child")).diff).toContain("-dirty");
    await expect(workspace.content(parent, "vendor/child")).resolves.toMatchObject({
      kind: "submodule",
      working: "",
      binary: false,
      conflicted: false,
    });
    // 未初始化子模块仍有 gitlink，但工作区只有空目录。
    await rm(directory, { recursive: true });
    await mkdir(directory);
    await expect(workspace.content(parent, "vendor/child")).resolves.toMatchObject({
      kind: "submodule",
    });
    const orphan = "orphan-module";
    const head = (await git("rev-parse", "HEAD")).stdout.trim();
    await git("update-index", "--add", "--cacheinfo", `160000,${head},${orphan}`);
    await mkdir(path.join(parent, orphan));
    expect((await workspace.status(parent)).warnings).toEqual([expect.stringContaining(orphan)]);
    await expect(workspace.content(parent, orphan)).resolves.toMatchObject({
      kind: "submodule",
    });
    // 已暂存删除后从 HEAD 识别子模块，而非把目录或提交对象当正文。
    await git("rm", "-f", "--cached", "vendor/child");
    await expect(workspace.content(parent, "vendor/child")).resolves.toMatchObject({
      kind: "submodule",
    });
    await rm(directory, { recursive: true });
    await expect(workspace.content(parent, "vendor/child")).resolves.toMatchObject({
      kind: "submodule",
    });
    expect((await workspace.diff(parent, "vendor/child")).diff).toContain("-Subproject commit");
  });

  it("returns an empty working side for deleted files and read-only directory metadata", async () => {
    const directory = await repository();
    const workspace = new GitWorkspace(testGitEnvironment);
    await rm(path.join(directory, "tracked.txt"));
    await expect(workspace.content(directory, "tracked.txt")).resolves.toMatchObject({
      kind: "file",
      base: "one\n",
      working: "",
      binary: false,
      truncated: false,
    });
    await mkdir(path.join(directory, "src"));
    await writeFile(path.join(directory, "src", "new.txt"), "new\n");
    await expect(workspace.content(directory, "src")).resolves.toMatchObject({
      kind: "directory",
      base: "",
      working: "",
      binary: false,
    });
  });

  it("marks a binary working tree file as not editable", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "tracked.bin"), Buffer.from([0, 1, 2, 3]));

    const result = await new GitWorkspace(testGitEnvironment).content(directory, "tracked.bin");

    expect(result).toMatchObject({
      path: "tracked.bin",
      working: "",
      binary: true,
      truncated: false,
    });
  });

  it("stages selected paths and creates a commit", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "tracked.txt"), "two\n");
    await writeFile(path.join(directory, "new.txt"), "new\n");
    const workspace = new GitWorkspace(testGitEnvironment);

    const staged = await workspace.stage(directory, ["new.txt"]);
    expect(staged.changes.find((change) => change.path === "new.txt")?.staged).toBe(true);
    expect(staged.changes.find((change) => change.path === "tracked.txt")?.staged).toBe(false);

    const result = await workspace.commit(directory, "feat: add new file", false);
    expect(result.commit).toBeTruthy();
    expect(result.pushed).toBe(false);
    expect(result.status.changes).toEqual([
      expect.objectContaining({ path: "tracked.txt", staged: false, unstaged: true }),
    ]);
  });

  it("commits only the selected paths even when other changes are staged", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "tracked.txt"), "two\n");
    await writeFile(path.join(directory, "new.txt"), "new\n");
    const workspace = new GitWorkspace(testGitEnvironment);
    await workspace.stage(directory, ["tracked.txt", "new.txt"]);

    const result = await workspace.commit(directory, "feat: add selected file", false, ["new.txt"]);

    expect(result.status.changes).toEqual([
      expect.objectContaining({ path: "tracked.txt", staged: true }),
    ]);
  });

  it("unstages a selected path without touching others", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "tracked.txt"), "two\n");
    await writeFile(path.join(directory, "new.txt"), "new\n");
    const workspace = new GitWorkspace(testGitEnvironment);
    await workspace.stage(directory, ["tracked.txt", "new.txt"]);

    const result = await workspace.unstage(directory, ["new.txt"]);

    expect(result.changes.find((change) => change.path === "new.txt")?.staged).toBe(false);
    expect(result.changes.find((change) => change.path === "new.txt")?.untracked).toBe(true);
    expect(result.changes.find((change) => change.path === "tracked.txt")?.staged).toBe(true);
  });

  it("reports initialized and modified submodules, and updates an uninitialized one", async () => {
    const { parent, child } = await submoduleRepository();
    const workspace = new GitWorkspace(testGitEnvironment);
    const initialized = await workspace.status(parent);
    expect(initialized.submodules).toContainEqual({ path: "vendor/child", status: "current" });
    expect(initialized.changes.find((change) => change.path === "vendor/child")).toBeUndefined();

    await writeFile(path.join(parent, "vendor/child/child.txt"), "changed\n");
    const modified = await workspace.status(parent);
    expect(modified.submodules).toContainEqual({ path: "vendor/child", status: "modified" });
    expect(modified.changes.find((change) => change.path === "vendor/child")?.submodule).toEqual({
      path: "vendor/child",
      status: "modified",
    });

    await rm(path.join(parent, "vendor/child"), { recursive: true, force: true });
    await rm(path.join(parent, ".git", "modules", "vendor", "child"), {
      recursive: true,
      force: true,
    });
    const missing = await workspace.status(parent);
    expect(missing.submodules).toContainEqual({ path: "vendor/child", status: "uninitialized" });
    const updated = await workspace.updateSubmodule(parent, { path: "vendor/child", init: true });
    expect(updated.submodules).toContainEqual({ path: "vendor/child", status: "current" });
    await expect(workspace.updateSubmodule(parent, { path: child, init: true })).rejects.toThrow(
      "超出工作区",
    );
    await expect(
      workspace.updateSubmodule(parent, { path: "not-a-submodule", init: true }),
    ).rejects.toThrow("不是已声明");
  }, 20_000);

  it("recommends a fast eligible 垃 model for commit messages", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "codexhost-git-home-"));
    cleanup.push(home);
    const server = await new Promise<Server>((resolve) => {
      const next = import("node:http").then(({ createServer }) => {
        const instance = createServer((_request, response) => {
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              data: [
                { id: "gpt-strong" },
                { id: "deepseek-chat" },
                { id: "deepseek-flash" },
                { id: "text-embedding-3-small" },
              ],
            }),
          );
        });
        instance.listen(0, "127.0.0.1", () => resolve(instance));
      });
      void next;
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture address");
    await writeFile(
      path.join(home, "config.toml"),
      `model_provider = "fixture"\n[model_providers.fixture]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nexperimental_bearer_token = "fixture-only"\n`,
    );
    try {
      const result = await new GitWorkspace().messageModels({ CODEX_HOME: home });
      expect(result.defaultModel).toBe("deepseek-flash");
      expect(result.models).toContainEqual(
        expect.objectContaining({ id: "deepseek-flash", recommended: true }),
      );
      expect(result.models).toContainEqual(
        expect.objectContaining({ id: "deepseek-chat", recommended: false }),
      );
      expect(result.models).toContainEqual(
        expect.objectContaining({ id: "text-embedding-3-small", eligible: false }),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("reads the commit graph, refs, changed files, and commit diff", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "tracked.txt"), "two\n");
    await execFileAsync("git", ["-C", directory, "add", "tracked.txt"]);
    await execFileAsync("git", ["-C", directory, "commit", "-qm", "feat: second"]);
    await execFileAsync("git", ["-C", directory, "tag", "v1"]);
    const workspace = new GitWorkspace(testGitEnvironment);

    const log = await workspace.log(directory);
    expect(log.branch).toBeTruthy();
    expect(log.refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "HEAD", kind: "head" })]),
    );
    expect(log.refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "refs/tags/v1", kind: "tag" })]),
    );
    expect(log.commits[0]).toMatchObject({ subject: "feat: second" });
    expect(log.commits[0]?.parents).toHaveLength(1);

    const latest = log.commits[0];
    if (!latest) throw new Error("Expected a commit in the log");
    const detail = await workspace.commitDetail(directory, latest.commit);
    expect(detail.body).toContain("feat: second");
    expect(detail.files).toContainEqual(
      expect.objectContaining({ path: "tracked.txt", status: "M", additions: 1 }),
    );
    const diff = await workspace.commitDiff(directory, detail.commit.commit, "tracked.txt");
    expect(diff.diff).toContain("+two");
  });

  it("reports an in-progress merge with its conflict list", async () => {
    const directory = await repository();
    await execFileAsync("git", ["-C", directory, "checkout", "-qb", "feature"]);
    await writeFile(path.join(directory, "tracked.txt"), "feature\n");
    await execFileAsync("git", ["-C", directory, "commit", "-qam", "feature"]);
    await execFileAsync("git", ["-C", directory, "checkout", "-q", "-"]);
    await writeFile(path.join(directory, "tracked.txt"), "main\n");
    await execFileAsync("git", ["-C", directory, "commit", "-qam", "main"]);
    await expect(execFileAsync("git", ["-C", directory, "merge", "feature"])).rejects.toBeTruthy();

    const status = await new GitWorkspace(testGitEnvironment).status(directory);

    expect(status.operation).toBe("merge");
    expect(status.conflicts).toEqual(["tracked.txt"]);
  });

  it("syncs an up-to-date branch and fast-forwards behind commits from the remote", async () => {
    const { clone, advanceRemote } = await cloneWithRemote();
    const workspace = new GitWorkspace(testGitEnvironment);
    // 远端没有新提交时同步报告 up-to-date。
    await expect(workspace.sync(clone)).resolves.toMatchObject({
      strategy: "up-to-date",
      behind: 0,
      conflicts: [],
    });
    // 远端前进一个提交后，本地落后且无本地提交，应快进。
    await advanceRemote();
    const mid = await new GitWorkspace(testGitEnvironment).fetch(clone);
    // fetch 之后本地应落后 1 个提交；这同时回归 behind 的解析。
    expect(mid.behind).toBe(1);
    const synced = await workspace.sync(clone);
    expect(synced.strategy).toBe("fast-forward");
    expect(synced.behind).toBe(1);
    expect(synced.status.behind).toBe(0);
  });

  it("merges diverged remote history and surfaces conflicts without auto-resolving", async () => {
    const { clone, remote, advanceRemote } = await cloneWithRemote();
    const workspace = new GitWorkspace(testGitEnvironment);
    await advanceRemote("remote change\n");
    // 本地提交同样修改 tracked.txt，制造合并冲突。
    await writeFile(path.join(clone, "tracked.txt"), "local change\n");
    await execFileAsync("git", ["-C", clone, "commit", "-qam", "local"]);

    const result = await workspace.sync(clone);

    expect(result.strategy).toBe("conflict");
    expect(result.conflicts).toEqual(["tracked.txt"]);
    expect(result.status.operation).toBe("merge");
    // 冲突保留在原工作区，未自动合并；解决并暂存后可继续。
    await writeFile(path.join(clone, "tracked.txt"), "resolved\n");
    await execFileAsync("git", ["-C", clone, "add", "tracked.txt"]);
    const continued = await workspace.mergeContinue(clone);
    expect(continued.operation).toBeNull();
    expect(continued.conflicts).toEqual([]);
    expect(remote).toBeTruthy();
  });

  it("treats a non-fast-forward push as a structured rejection with the behind count", async () => {
    const { clone, advanceRemote } = await divergedClone();
    // 远端前进后本地也提交，推送必然被拒。
    await advanceRemote();
    await writeFile(path.join(clone, "tracked.txt"), "local\n");
    await execFileAsync("git", ["-C", clone, "commit", "-qam", "local"]);

    await expect(new GitWorkspace(testGitEnvironment).push(clone)).rejects.toMatchObject({
      name: "GitPushRejectedError",
      behind: 1,
    });
  });

  it("aborts an in-progress merge", async () => {
    const directory = await repository();
    await execFileAsync("git", ["-C", directory, "checkout", "-qb", "feature"]);
    await writeFile(path.join(directory, "tracked.txt"), "feature\n");
    await execFileAsync("git", ["-C", directory, "commit", "-qam", "feature"]);
    await execFileAsync("git", ["-C", directory, "checkout", "-q", "-"]);
    await writeFile(path.join(directory, "tracked.txt"), "main\n");
    await execFileAsync("git", ["-C", directory, "commit", "-qam", "main"]);
    await expect(execFileAsync("git", ["-C", directory, "merge", "feature"])).rejects.toBeTruthy();

    const status = await new GitWorkspace(testGitEnvironment).mergeAbort(directory);

    expect(status.operation).toBeNull();
    expect(status.conflicts).toEqual([]);
  });
});

// 用真实仓库验证操作副作用与返回状态，避免把成功的提交误报成失败。
describe("GitWorkspace pending mutations and submodule warnings", () => {
  it("keeps healthy submodules and returns stage, commit and push results with an orphan gitlink", async () => {
    const { parent } = await submoduleRepository();
    const git = (...args: string[]) => execFileAsync("git", ["-C", parent, ...args]);
    const head = (await git("rev-parse", "HEAD")).stdout.trim();
    const orphan = "aio-plugin-documentation-agent";
    await git("update-index", "--add", "--cacheinfo", `160000,${head},${orphan}`);
    await git("commit", "-qm", "add orphan gitlink");
    const remote = await mkdtemp(path.join(tmpdir(), "codexhost-warning-remote-"));
    cleanup.push(remote);
    await execFileAsync("git", ["init", "-q", "--bare", remote]);
    await git("remote", "add", "origin", remote);
    await git("push", "-qu", "origin", "HEAD");
    const workspace = new GitWorkspace(testGitEnvironment);
    const status = await workspace.status(parent);
    expect(status.submodules).toContainEqual({ path: "vendor/child", status: "current" });
    expect(status.warnings).toEqual([expect.stringContaining(orphan)]);
    await expect(workspace.submodules(parent)).resolves.toMatchObject({
      warnings: status.warnings,
    });
    await writeFile(path.join(parent, "parent.txt"), "updated\n");
    const staged = await workspace.stage(parent, ["parent.txt"]);
    expect(staged.changes).toContainEqual(
      expect.objectContaining({ path: "parent.txt", staged: true }),
    );
    expect(staged.warnings).toEqual(status.warnings);
    const committed = await workspace.commit(parent, "fix: healthy change", false);
    expect(committed.commit).toBeTruthy();
    expect(committed.status.warnings).toEqual(status.warnings);
    const pushed = await workspace.push(parent);
    expect(pushed.ahead).toBe(0);
    expect(pushed.warnings).toEqual(status.warnings);
    const remoteHead = (
      await execFileAsync("git", ["-C", remote, "rev-parse", `refs/heads/${pushed.branch}`])
    ).stdout.trim();
    expect(remoteHead).toBe((await git("rev-parse", "HEAD")).stdout.trim());
    expect((await git("show", "HEAD:.gitmodules")).stdout).not.toContain(orphan);
  });

  it("coalesces concurrent identical commits and clears failed requests for retry", async () => {
    const directory = await repository();
    const workspace = new GitWorkspace(testGitEnvironment);
    const message = "fix: one commit";
    const failed = await Promise.allSettled([
      workspace.commit(directory, message, false),
      workspace.commit(directory, message, false),
    ]);
    expect(failed.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await writeFile(path.join(directory, "tracked.txt"), "updated\n");
    await workspace.stage(directory, ["tracked.txt"]);
    const [first, duplicate] = await Promise.all([
      workspace.commit(directory, message, false),
      workspace.commit(directory, message, false),
    ]);
    expect(duplicate).toEqual(first);
    expect(first.commit).toBeTruthy();
    const count = await execFileAsync("git", ["-C", directory, "rev-list", "--count", "HEAD"]);
    expect(count.stdout.trim()).toBe("2");
  });
});
