import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, stat, utimes, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test, vi } from "vitest";
import { GitWorkspace } from "../src/git-workspace.js";
import { readSshGitMessageOnHost } from "../src/ssh-git-message-worker.js";

const exec = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "git-message-revision-"));
  cleanup.push(directory);
  const git = (...args: string[]) => exec("git", ["-C", directory, ...args]);
  await git("init", "-q");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await writeFile(path.join(directory, "tracked.txt"), "base\n");
  await git("add", ".");
  await git("commit", "-qm", "base");
  return { directory, git, workspace: new GitWorkspace() };
}

test("detects same-length edits with restored mtime and reuses unchanged content after staging", async () => {
  const { directory, git, workspace } = await fixture();
  const file = path.join(directory, "tracked.txt");
  await writeFile(file, "next\n");
  const info = await stat(file);
  const first = await workspace.status(directory);
  expect(first.messageRevision).toMatch(/^[0-9a-f]{64}$/u);
  expect((await workspace.status(directory)).messageRevision).toBe(first.messageRevision);
  await writeFile(file, "more\n");
  await utimes(file, info.atime, info.mtime);
  const changed = await workspace.status(directory);
  expect(changed.changes.length).toBe(first.changes.length);
  expect(changed.messageRevision).not.toBe(first.messageRevision);
  await git("add", ".");
  expect((await workspace.status(directory)).messageRevision).toBe(changed.messageRevision);
});

test("hashes untracked binary content beyond the model prompt limit and preserves host worker parity", async () => {
  const { directory, workspace } = await fixture();
  const binary = Buffer.alloc(80_000);
  const file = path.join(directory, "new.bin");
  await writeFile(file, binary);
  const first = await workspace.status(directory);
  binary[79_999] = 1;
  await writeFile(file, binary);
  const changed = await workspace.status(directory);
  expect(changed.messageRevision).not.toBe(first.messageRevision);
  expect(await readSshGitMessageOnHost({ kind: "revision", status: changed })).toBe(
    changed.messageRevision,
  );
});

test("tracks commit path selection, renames and deletions without including other unstaged files", async () => {
  const { directory, git, workspace } = await fixture();
  await writeFile(path.join(directory, "tracked.txt"), "next\n");
  await git("add", "tracked.txt");
  const first = await workspace.status(directory);
  await writeFile(path.join(directory, "other.txt"), "unrelated\n");
  expect((await workspace.status(directory)).messageRevision).toBe(first.messageRevision);
  await git("add", "other.txt");
  expect((await workspace.status(directory)).messageRevision).not.toBe(first.messageRevision);
  await git("commit", "-qm", "next");
  expect((await workspace.status(directory)).messageRevision).toBeNull();
  await rename(path.join(directory, "tracked.txt"), path.join(directory, "renamed.txt"));
  await git("add", "-A");
  const renamed = await workspace.status(directory);
  expect(renamed.messageRevision).toMatch(/^[0-9a-f]{64}$/u);
  await rm(path.join(directory, "renamed.txt"));
  expect((await workspace.status(directory)).messageRevision).toBe(renamed.messageRevision);
  await git("add", "-A");
  expect((await workspace.status(directory)).messageRevision).not.toBe(renamed.messageRevision);
});

test("fingerprints and describes staged contents while ignoring later unstaged edits", async () => {
  const { directory, git, workspace } = await fixture();
  const file = path.join(directory, "tracked.txt");
  await writeFile(file, "staged content\n");
  const unstaged = await workspace.status(directory);
  await git("add", "tracked.txt");
  await writeFile(file, "working content not staged\n");
  const staged = await workspace.status(directory);
  expect(staged.messageRevision).toBe(unstaged.messageRevision);
  const home = await mkdtemp(path.join(tmpdir(), "git-message-staged-"));
  cleanup.push(home);
  await writeFile(
    path.join(home, "config.toml"),
    'model_provider="fixture"\n[model_providers.fixture]\nbase_url="https://fixture.invalid/v1"\nexperimental_bearer_token="fixture"\n',
  );
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    const prompt = JSON.parse(String(init?.body)).messages[1].content;
    expect(prompt).toContain("+staged content");
    expect(prompt).not.toContain("working content not staged");
    await writeFile(file, "another unstaged edit\n");
    return Response.json({ choices: [{ message: { content: "fix: staged content" } }] });
  });
  const result = await workspace.generateMessage({
    cwd: directory,
    model: "ask",
    paths: ["tracked.txt"],
    environment: { CODEX_HOME: home },
  });
  expect(result.revision).toBe(staged.messageRevision);
  await git("add", "tracked.txt");
  expect((await workspace.status(directory)).messageRevision).not.toBe(staged.messageRevision);
});

test.skipIf(process.platform === "win32")(
  "hashes symlink targets without reading the linked file",
  async () => {
    const { directory, git, workspace } = await fixture();
    const link = path.join(directory, "link");
    await symlink("missing-a", link);
    const first = await workspace.status(directory);
    await rm(link);
    await symlink("missing-b", link);
    const changed = await workspace.status(directory);
    expect(changed.messageRevision).not.toBe(first.messageRevision);
    await git("add", "link");
    expect((await workspace.status(directory)).messageRevision).toBe(changed.messageRevision);
  },
);

test("includes new file contents and rejects model results after concurrent edits", async () => {
  const { directory, workspace } = await fixture();
  const home = await mkdtemp(path.join(tmpdir(), "git-message-provider-"));
  cleanup.push(home);
  await writeFile(
    path.join(home, "config.toml"),
    'model_provider="fixture"\n[model_providers.fixture]\nbase_url="https://fixture.invalid/v1"\nexperimental_bearer_token="fixture"\n',
  );
  const file = path.join(directory, "new.txt");
  await writeFile(file, "new file content\n");
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body)).messages[1].content).toContain("new file content");
    await writeFile(file, "changed while waiting\n");
    return Response.json({ choices: [{ message: { content: "feat: stale" } }] });
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    workspace.generateMessage({ cwd: directory, model: "ask", environment: { CODEX_HOME: home } }),
  ).rejects.toThrow("文件已变化");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("model lookup does not block Git status and prefers the available ask model", async () => {
  const { directory, workspace } = await fixture();
  const home = await mkdtemp(path.join(tmpdir(), "git-model-list-"));
  cleanup.push(home);
  await writeFile(
    path.join(home, "config.toml"),
    'model_provider="fixture"\n[model_providers.fixture]\nbase_url="https://fixture.invalid/v1"\nexperimental_bearer_token="fixture"\n',
  );
  let finish: (response: Response) => void = () => {};
  let began: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
        began();
      }),
  );
  const models = workspace.messageModels({ CODEX_HOME: home });
  await started;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const status = await Promise.race([
      workspace.status(directory),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Model lookup blocked Git")), 2000);
      }),
    ]);
    expect(status.messageRevision).toBeNull();
  } finally {
    clearTimeout(timeout);
    finish(Response.json({ data: [{ id: "deepseek-flash" }, { id: "ask" }] }));
  }
  expect((await models).defaultModel).toBe("ask");
});
