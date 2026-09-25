import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ProjectSync, ProjectEntry } from "./project-sync.js";

const execute = promisify(execFile);
const MANIFEST = "codexbuddy-projects.json";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execute("git", ["-C", cwd, ...args], {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout.trim();
}

async function manifest(folder: string): Promise<ProjectEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(folder, MANIFEST), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Git project catalog");
  const document = value as Record<string, unknown>;
  if (
    document.version !== 1 ||
    !Array.isArray(document.projects) ||
    document.projects.length > 1000
  )
    throw new Error("Invalid Git project catalog");
  return document.projects as ProjectEntry[];
}

export class ProjectSyncGit {
  readonly #store: ProjectSync;

  constructor(store: ProjectSync) {
    this.#store = store;
  }

  async #withCheckout<T>(action: (folder: string) => Promise<T>): Promise<T> {
    const remote = await this.#store.gitConfiguration();
    if (!remote) throw new Error("Configure a private Git catalog first");
    const folder = await mkdtemp(path.join(tmpdir(), "codexbuddy-catalog-"));
    const checkout = path.join(folder, "checkout");
    try {
      await git(folder, "clone", "--quiet", "--", remote, checkout);
      await git(checkout, "rev-parse", "HEAD");
      return await action(checkout);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  async pull(): Promise<void> {
    await this.#withCheckout(async (folder) => {
      await this.#store.merge(await manifest(folder));
    });
  }

  async push(): Promise<void> {
    await this.#withCheckout(async (folder) => {
      await this.#store.merge(await manifest(folder));
      const projects = await this.#store.entries();
      const next = JSON.stringify({ version: 1, projects }, null, 2) + "\n";
      const target = path.join(folder, MANIFEST);
      const current = await readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      if (current === next) return;
      await writeFile(target, next, { mode: 0o600 });
      await git(folder, "add", "--", MANIFEST);
      await git(
        folder,
        "-c",
        "user.name=CodexBuddy",
        "-c",
        "user.email=codexbuddy@localhost",
        "commit",
        "-qm",
        "Update project catalog",
      );
      await git(folder, "push", "origin", "HEAD");
    });
  }
}
