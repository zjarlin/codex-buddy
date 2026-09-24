import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitWorkspace } from "../src/git-workspace.js";

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

describe("GitWorkspace", () => {
  it("reports staged, modified, untracked and renamed files", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "tracked.txt"), "two\n");
    await writeFile(path.join(directory, "new.txt"), "new\n");
    await execFileAsync("git", ["-C", directory, "mv", "tracked.txt", "renamed.txt"]);
    await writeFile(path.join(directory, "renamed.txt"), "two\nthree\n");

    const workspace = new GitWorkspace();
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

  it("stages selected paths and creates a commit", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "tracked.txt"), "two\n");
    await writeFile(path.join(directory, "new.txt"), "new\n");
    const workspace = new GitWorkspace();

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
    const workspace = new GitWorkspace();
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
    const workspace = new GitWorkspace();
    await workspace.stage(directory, ["tracked.txt", "new.txt"]);

    const result = await workspace.unstage(directory, ["new.txt"]);

    expect(result.changes.find((change) => change.path === "new.txt")?.staged).toBe(false);
    expect(result.changes.find((change) => change.path === "new.txt")?.untracked).toBe(true);
    expect(result.changes.find((change) => change.path === "tracked.txt")?.staged).toBe(true);
  });

  it("prefers an eligible 垃 model for commit messages", async () => {
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
        expect.objectContaining({ id: "text-embedding-3-small", eligible: false }),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
