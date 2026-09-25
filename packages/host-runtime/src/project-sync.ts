import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { projectSyncRemoteSchema, type ProjectSyncSnapshot } from "@codexhost/shared-contracts";

const execute = promisify(execFile);
const COMMAND_TIMEOUT = 60_000;
const MAX_OUTPUT = 1024 * 1024;
export interface ProjectEntry {
  name: string;
  remote: string;
}

export interface ProjectState {
  version: 1;
  projects: ProjectEntry[];
  bindings: Record<string, string>;
  gitRemote: string | null;
  peers: { id: string; name: string; publicKey: string; exchangePublicKey: string }[];
}

const emptyState = (): ProjectState => ({
  version: 1,
  projects: [],
  bindings: {},
  peers: [],
  gitRemote: null,
});

function gitRemote(remote: string, allowLocal = false): string {
  const value = projectSyncRemoteSchema.parse(remote);
  if (/\s|[\x00-\x1f]/u.test(value) || value.startsWith("-")) {
    throw new Error("Invalid Git remote");
  }
  if (/^git@[a-z0-9.-]+:[a-z0-9._/-]+(?:\.git)?$/iu.test(value)) {
    if (value.split(":")[1]?.split("/").includes("..")) throw new Error("Invalid Git remote");
    return value;
  }
  if (allowLocal && path.isAbsolute(value)) return value;
  const url = new URL(value);
  if (
    !["https:", "ssh:"].includes(url.protocol) ||
    !url.hostname ||
    (url.protocol === "https:" && url.username !== "") ||
    (url.protocol === "ssh:" && url.username !== "" && url.username !== "git") ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname ||
    url.pathname === "/" ||
    /%(?:2f|5c|2e)/iu.test(url.pathname)
  ) {
    throw new Error("Only credential-free HTTPS or SSH Git remotes are supported");
  }
  return value;
}

function identity(remote: string, allowLocal = false): string {
  const value = gitRemote(remote, allowLocal);
  if (path.isAbsolute(value)) return value;
  if (value.startsWith("git@")) {
    const separator = value.indexOf(":");
    return `${value.slice(4, separator)}/${value.slice(separator + 1).replace(/\.git$/iu, "")}`.toLowerCase();
  }
  const url = new URL(value);
  return `${url.hostname.toLowerCase()}/${url.pathname
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/iu, "")
    .toLowerCase()}`;
}

function projectName(remote: string): string {
  const name =
    remote
      .replace(/\/?\.git$/iu, "")
      .split(/[/:]/u)
      .at(-1) ?? "";
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/iu.test(name) || name === "." || name === "..") {
    throw new Error("Remote repository name cannot be used as a local folder");
  }
  return name;
}

function parseEntries(value: unknown, allowLocal = false): ProjectEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid project manifest");
  const document = value as Record<string, unknown>;
  if (
    document.version !== 1 ||
    !Array.isArray(document.projects) ||
    document.projects.length > 1000
  ) {
    throw new Error("Unsupported project manifest");
  }
  const seen = new Set<string>();
  return document.projects.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid project entry");
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.name !== "string" ||
      entry.name.length < 1 ||
      entry.name.length > 200 ||
      typeof entry.remote !== "string"
    ) {
      throw new Error("Invalid project entry");
    }
    const key = identity(entry.remote, allowLocal);
    if (seen.has(key)) throw new Error("Duplicate project remote");
    seen.add(key);
    return { name: entry.name, remote: gitRemote(entry.remote, allowLocal) };
  });
}

export class ProjectSync {
  private readonly directory: string;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    environment: NodeJS.ProcessEnv = process.env,
    private readonly allowLocalRemote = false,
  ) {
    this.directory = path.join(
      environment.CODEXHOST_DATA_DIR
        ? path.resolve(environment.CODEXHOST_DATA_DIR)
        : path.join(os.homedir(), ".codexhost"),
      "project-sync",
    );
  }

  private remote(value: string): string {
    return gitRemote(value, this.allowLocalRemote);
  }
  private key(value: string): string {
    return identity(value, this.allowLocalRemote);
  }
  private parseEntries(value: unknown): ProjectEntry[] {
    return parseEntries(value, this.allowLocalRemote);
  }

  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action, action);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async git(cwd: string, ...args: string[]): Promise<string> {
    const result = await execute("git", ["-C", cwd, ...args], {
      timeout: COMMAND_TIMEOUT,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return result.stdout.trim();
  }

  private async read(): Promise<ProjectState> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.directory, "state.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid project sync state");
    const state = value as Record<string, unknown>;
    if (
      state.version !== 1 ||
      !state.bindings ||
      typeof state.bindings !== "object" ||
      Array.isArray(state.bindings)
    ) {
      throw new Error("Invalid project sync state");
    }
    const bindings = Object.fromEntries(
      Object.entries(state.bindings).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      ),
    );
    return {
      version: 1,
      projects: this.parseEntries({ version: 1, projects: state.projects }),
      bindings,
      gitRemote: typeof state.gitRemote === "string" ? this.remote(state.gitRemote) : null,
      peers: Array.isArray(state.peers)
        ? state.peers.filter(
            (peer): peer is ProjectState["peers"][number] =>
              typeof peer === "object" &&
              peer !== null &&
              typeof peer.id === "string" &&
              typeof peer.name === "string" &&
              typeof peer.publicKey === "string" &&
              typeof peer.exchangePublicKey === "string",
          )
        : [],
    };
  }

  private async save(state: ProjectState): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = path.join(this.directory, "state.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  }

  private async snapshot(state: ProjectState): Promise<ProjectSyncSnapshot> {
    const projects = await Promise.all(
      state.projects.map(async (project) => {
        const localPath = state.bindings[this.key(project.remote)] ?? null;
        const available = localPath !== null && (await this.matches(localPath, project.remote));
        return {
          ...project,
          localPath: available ? localPath : null,
          state: available ? ("ready" as const) : ("missing" as const),
        };
      }),
    );
    return {
      peers: state.peers.map(({ id, name }) => ({ id, name })),
      pending: [],
      connected: false,
      relay: null,
      gitRemote: state.gitRemote,
      projects,
    };
  }

  private async matches(folder: string, remote: string): Promise<boolean> {
    try {
      return this.key(await this.git(folder, "remote", "get-url", "origin")) === this.key(remote);
    } catch {
      return false;
    }
  }

  inspect(): Promise<ProjectSyncSnapshot> {
    return this.serialized(async () => this.snapshot(await this.read()));
  }

  add(folder: string): Promise<ProjectSyncSnapshot> {
    return this.serialized(async () => {
      const root = await this.git(folder, "rev-parse", "--show-toplevel");
      if ((await realpath(root)) !== (await realpath(folder)))
        throw new Error("Select the repository root");
      const remote = this.remote(await this.git(folder, "remote", "get-url", "origin"));
      const state = await this.read();
      const key = this.key(remote);
      if (!state.projects.some((entry) => this.key(entry.remote) === key)) {
        state.projects.push({ name: path.basename(root), remote });
      }
      state.bindings[key] = root;
      await this.save(state);
      return this.snapshot(state);
    });
  }

  bind(remote: string, folder: string): Promise<ProjectSyncSnapshot> {
    return this.serialized(async () => {
      const state = await this.read();
      const entry = state.projects.find((project) => this.key(project.remote) === this.key(remote));
      if (!entry || !(await this.matches(folder, entry.remote)))
        throw new Error("Local repository origin does not match the project");
      state.bindings[this.key(entry.remote)] = path.resolve(folder);
      await this.save(state);
      return this.snapshot(state);
    });
  }

  entries(): Promise<ProjectEntry[]> {
    return this.serialized(async () => (await this.read()).projects);
  }

  merge(incoming: ProjectEntry[]): Promise<ProjectSyncSnapshot> {
    return this.serialized(async () => {
      const state = await this.read();
      const validated = this.parseEntries({ version: 1, projects: incoming });
      const existing = new Set(state.projects.map((entry) => this.key(entry.remote)));
      state.projects.push(...validated.filter((entry) => !existing.has(this.key(entry.remote))));
      await this.save(state);
      return this.snapshot(state);
    });
  }

  peers(): Promise<ProjectState["peers"]> {
    return this.serialized(async () => (await this.read()).peers);
  }

  configureGit(remote: string | null): Promise<ProjectSyncSnapshot> {
    return this.serialized(async () => {
      const state = await this.read();
      state.gitRemote = remote === null ? null : this.remote(remote);
      await this.save(state);
      return this.snapshot(state);
    });
  }

  gitConfiguration(): Promise<string | null> {
    return this.serialized(async () => (await this.read()).gitRemote);
  }

  trust(peer: ProjectState["peers"][number]): Promise<ProjectSyncSnapshot> {
    return this.serialized(async () => {
      const state = await this.read();
      if (state.peers.length >= 32 && !state.peers.some((entry) => entry.id === peer.id)) {
        throw new Error("Too many paired devices");
      }
      state.peers = [...state.peers.filter((entry) => entry.id !== peer.id), peer];
      await this.save(state);
      return this.snapshot(state);
    });
  }

  removePeer(peerId: string): Promise<ProjectSyncSnapshot> {
    return this.serialized(async () => {
      const state = await this.read();
      state.peers = state.peers.filter((peer) => peer.id !== peerId);
      await this.save(state);
      return this.snapshot(state);
    });
  }

  clone(remote: string, parent: string): Promise<ProjectSyncSnapshot> {
    return this.serialized(async () => {
      const state = await this.read();
      const entry = state.projects.find((project) => this.key(project.remote) === this.key(remote));
      if (!entry) throw new Error("Project is not in the sync catalog");
      const directory = path.resolve(parent);
      if (!(await stat(directory)).isDirectory())
        throw new Error("Choose an existing parent directory");
      const target = path.join(directory, projectName(entry.remote));
      try {
        await lstat(target);
        throw new Error("Destination already exists; bind that repository instead");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        await this.git(directory, "clone", "--", entry.remote, target);
      } catch (cloneError) {
        await rm(target, { recursive: true, force: true });
        throw cloneError;
      }
      state.bindings[this.key(entry.remote)] = target;
      await this.save(state);
      return this.snapshot(state);
    });
  }
}
