import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
