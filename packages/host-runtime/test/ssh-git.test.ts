import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { GitWorkspace, GitWorkspaceError } from "../src/git-workspace.js";
import { createSshGitRuntime, SshGitWorkspaces } from "../src/ssh-git.js";

const exec = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ssh-git-test-")));
  cleanup.push(directory);
  const cwd = path.join(directory, "remote project 'quoted'");
  const remote = path.join(directory, "remote.git");
  const environment = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "protocol.file.allow",
    GIT_CONFIG_VALUE_0: "always",
  };
  const git = (worktree: string, ...args: string[]) =>
    exec("git", ["-C", worktree, ...args], { env: environment });
  await exec("git", ["init", "-q", "-b", "main", cwd], { env: environment });
  await git(cwd, "config", "user.name", "Test");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "commit.gpgsign", "false");
  await writeFile(path.join(cwd, "file.txt"), "initial\n");
  await git(cwd, "add", "file.txt");
  await git(cwd, "commit", "-qm", "init");
  await exec("git", ["init", "-q", "--bare", remote], { env: environment });
  await git(cwd, "remote", "add", "origin", remote);
  await git(cwd, "push", "-qu", "origin", "main");
  const execute = vi.fn(async (args: readonly string[]) => {
    expect(args.slice(0, 7)).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-p",
      "2222",
    ]);
    expect(args.at(-2)).toBe("saved-alias");
    const command = args.at(-1);
    if (!command) throw new Error("SSH command missing");
    try {
      return await exec("sh", ["-c", command], { env: environment });
    } catch (error) {
      const failure = error as Error & { stdout: string; stderr: string };
      throw new GitWorkspaceError(failure.message, failure.stdout, failure.stderr);
    }
  });
  const runtime = createSshGitRuntime(
    { arguments: ["-p", "2222", "saved-alias"], authority: null },
    environment,
    execute,
  );
  return {
    directory,
    cwd,
    remote,
    runtime,
    execute,
    git,
    workspace: new GitWorkspace(environment, runtime),
  };
}

it.skipIf(process.platform === "win32")(
  "executes status, content, stage, commit and push through the remote command transport",
  async () => {
    const { directory, cwd, remote, runtime, workspace, git, execute } = await fixture();
    const file = "quote' $(echo bad).txt";
    await writeFile(path.join(cwd, file), "remote only\n");
    expect(await workspace.root(cwd)).toBe(cwd);
    expect((await workspace.status(cwd)).changes).toEqual([
      expect.objectContaining({ path: file, untracked: true }),
    ]);
    expect(await workspace.content(cwd, file)).toMatchObject({
      working: "remote only\n",
      base: "",
      binary: false,
    });
    await mkdir(path.join(cwd, "src"));
    expect(await runtime.listDirectories?.(cwd)).toContain("src");
    await workspace.stage(cwd, [file]);
    expect((await git(cwd, "diff", "--cached", "--name-only")).stdout.trim()).toBe(file);
    await workspace.unstage(cwd, [file]);
    expect((await git(cwd, "diff", "--cached", "--name-only")).stdout).toBe("");
    await workspace.stage(cwd, [file]);
    const marker = path.join(directory, "injected");
    const message = `fix: quoted ' $(touch ${marker})`;
    expect(await workspace.commit(cwd, message, true)).toMatchObject({
      pushed: true,
      status: { changes: [], ahead: 0 },
    });
    expect((await git(remote, "log", "-1", "--format=%s", "main")).stdout.trim()).toBe(message);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(execute.mock.calls.some(([args]) => args.at(-1)?.includes("base64"))).toBe(true);
  },
  20_000,
);

it.skipIf(process.platform === "win32")(
  "reads remote operation metadata and binary content and preserves fetch/merge behavior",
  async () => {
    const { cwd, directory, remote, workspace, runtime, git } = await fixture();
    const clone = path.join(directory, "other");
    await exec("git", ["clone", "-q", "-b", "main", remote, clone]);
    await git(clone, "config", "user.name", "Test");
    await git(clone, "config", "user.email", "test@example.com");
    await writeFile(path.join(clone, "file.txt"), "updated upstream\n");
    await git(clone, "commit", "-qam", "upstream");
    await git(clone, "push", "-q");
    expect(await workspace.sync(cwd)).toMatchObject({
      strategy: "fast-forward",
      status: { behind: 0 },
    });
    await mkdir(path.join(cwd, ".git/rebase-merge"));
    expect((await workspace.status(cwd)).operation).toBe("rebase");
    await rm(path.join(cwd, ".git/rebase-merge"), { recursive: true });
    await writeFile(path.join(cwd, "binary.bin"), Buffer.from([0, 255, 3]));
    expect(await workspace.content(cwd, "binary.bin")).toMatchObject({ binary: true, working: "" });
    await expect(runtime.realpath("/missing-remote-directory")).rejects.toThrow();
    await expect(workspace.content(cwd, "../outside")).rejects.toThrow("范围");
  },
);

it("isolates repository services by the saved SSH connection and rejects unknown hosts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ssh-git-connections-"));
  cleanup.push(home);
  const file = path.join(home, ".codex-global-state.json");
  await writeFile(
    file,
    JSON.stringify({
      "codex-managed-remote-connections": [
        { hostId: "first", source: "discovered", alias: "one" },
        { hostId: "second", source: "discovered", alias: "two" },
      ],
    }),
  );
  const services = new SshGitWorkspaces(home, { ...process.env, CODEX_HOME: home });
  const first = await services.forHost("first");
  expect(await services.forHost("first")).toBe(first);
  expect(await services.forHost("second")).not.toBe(first);
  await expect(services.forHost("unknown")).rejects.toThrow("SSH 连接");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved["codex-managed-remote-connections"][0].alias = "changed";
  await writeFile(file, JSON.stringify(saved));
  expect(await services.forHost("first")).not.toBe(first);
});
