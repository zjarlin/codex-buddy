import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  remoteProjectsSnapshotSchema,
  type RemoteProject,
  type RemoteProjectAccount,
  type RemoteProjectsSnapshot,
} from "@codexhost/shared-contracts";

const METADATA_DIRECTORY = "codexhost-remote-projects";
const METADATA_FILE = "shared-projects.json";
const METADATA_VERSION = 1;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const APP_SERVER_TIMEOUT_MS = 30_000;

interface RemoteProjectMetadataDocument {
  version: 1;
  accounts: RemoteProjectAccount[];
}

interface RemoteProjectCandidate extends RemoteProject {
  key: string;
}

interface AppServerRecord {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  roots?: unknown;
  projectId?: unknown;
  cwd?: unknown;
  updatedAt?: unknown;
  recencyAt?: unknown;
}

interface AppServerMessage {
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

function homeDirectory(environment: NodeJS.ProcessEnv): string {
  const home = environment.CODEX_HOME ?? path.join(environment.HOME ?? os.homedir(), ".codex");
  if (!path.isAbsolute(home)) throw new Error("Remote Codex home is not absolute");
  return path.normalize(home);
}

function metadataPath(environment: NodeJS.ProcessEnv): string {
  const root = environment.CODEXHOST_DATA_DIR
    ? path.normalize(environment.CODEXHOST_DATA_DIR)
    : path.join(homeDirectory(environment), ".codexhost");
  if (!path.isAbsolute(root)) throw new Error("Remote codexhost data directory is not absolute");
  return path.join(root, METADATA_DIRECTORY, METADATA_FILE);
}

async function codExExecutable(environment: NodeJS.ProcessEnv): Promise<string> {
  if (environment.CODEXHOST_STOCK_CODEX_PATH) return environment.CODEXHOST_STOCK_CODEX_PATH;
  const home = environment.HOME ?? os.homedir();
  try {
    const manifest = JSON.parse(
      await readFile(path.join(home, ".codexhost", "remote", "manifest.json"), "utf8"),
    ) as { stockCodexPath?: unknown };
    if (typeof manifest.stockCodexPath === "string" && path.isAbsolute(manifest.stockCodexPath)) {
      return manifest.stockCodexPath;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return environment.CODEX_CLI_PATH ?? "codex";
}

function scalarApiKey(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "API_KEY", "apiKey", "api_key", "key"]) {
    const candidate = scalarApiKey(record[key]);
    if (candidate) return candidate;
  }
  return null;
}

function accountLabel(value: unknown, identity: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["email", "account_email", "accountEmail"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
    }
  }
  return `API Key ${identity.slice(0, 8)}`;
}

async function accountIdentity(
  environment: NodeJS.ProcessEnv,
): Promise<{ id: string; label: string }> {
  const authPath = path.join(homeDirectory(environment), "auth.json");
  let auth: unknown = {};
  try {
    auth = JSON.parse(await readFile(authPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const apiKey = scalarApiKey(auth);
  const material = apiKey ?? JSON.stringify(auth);
  const id = createHash("sha256")
    .update("codexhost-remote-project-account-v1\0")
    .update(material)
    .digest("hex")
    .slice(0, 16);
  return { id, label: accountLabel(auth, id) };
}

async function readMetadata(filePath: string): Promise<RemoteProjectMetadataDocument> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, accounts: [] };
    throw error;
  }
  if (Buffer.byteLength(source) > MAX_METADATA_BYTES)
    throw new Error("Remote metadata is too large");
  const value: unknown = JSON.parse(source);
  const document = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (document?.version !== METADATA_VERSION || !Array.isArray(document.accounts)) {
    throw new Error("Remote project metadata has an unsupported format");
  }
  const parsed = remoteProjectsSnapshotSchema.parse({
    account: {
      id: "0000000000000000",
      label: "metadata",
      current: true,
      projects: [],
    },
    accounts: document.accounts,
  });
  return {
    version: 1,
    accounts: parsed.accounts.map((account) => ({ ...account, current: false })),
  };
}

async function writeMetadata(
  filePath: string,
  document: RemoteProjectMetadataDocument,
): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const source = `${JSON.stringify(document, null, 2)}\n`;
  await writeFile(temporary, source, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, filePath);
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function projectRoots(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const candidate = object(entry);
    return typeof candidate?.path === "string" && path.isAbsolute(candidate.path)
      ? [path.normalize(candidate.path)]
      : [];
  });
}

function projectId(value: AppServerRecord): string | null {
  return typeof value.id === "string" && value.id.length > 0 ? value.id : null;
}

function threadSummary(value: AppServerRecord) {
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  const name =
    typeof value.name === "string"
      ? value.name
      : typeof value.title === "string"
        ? value.title
        : "";
  const times = [value.updatedAt, value.recencyAt].filter(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry),
  );
  return {
    id: value.id,
    name: name.slice(0, 4_096),
    updatedAt: Math.max(0, ...times),
  };
}

class AppServerClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  #nextId = 1;
  #buffer = "";

  constructor(command: string, environment: NodeJS.ProcessEnv) {
    const script = command.endsWith(".mjs") ? command : null;
    this.#child = spawn(
      script ? process.execPath : command,
      [...(script ? [script] : []), "app-server", "--listen", "stdio://"],
      {
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk: string) => this.#receive(chunk));
    this.#child.stderr.resume();
    this.#child.on("error", (error) => this.#fail(error));
    this.#child.on("exit", (code, signal) =>
      this.#fail(new Error(`Remote Codex app-server exited (${code ?? signal ?? "unknown"})`)),
    );
    this.#child.unref();
  }

  #fail(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #receive(chunk: string): void {
    this.#buffer += chunk;
    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;
      let message: AppServerMessage;
      try {
        message = JSON.parse(line) as AppServerMessage;
      } catch {
        continue;
      }
      if (typeof message.id !== "number") continue;
      const pending = this.#pending.get(message.id);
      if (!pending) continue;
      this.#pending.delete(message.id);
      if (message.error !== undefined)
        pending.reject(new Error("Remote Codex app-server request failed"));
      else pending.resolve(message.result);
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Remote Codex app-server request timed out: ${method}`));
      }, APP_SERVER_TIMEOUT_MS);
      this.#pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    this.#child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return promise;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "codexhost_remote_projects", version: "1" },
      capabilities: { experimentalApi: true },
    });
    this.#child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
  }

  close(): void {
    this.#fail(new Error("Remote Codex app-server closed"));
    this.#child.stdin.end();
    this.#child.kill();
  }
}

async function listProjects(environment: NodeJS.ProcessEnv): Promise<RemoteProjectCandidate[]> {
  const command = await codExExecutable(environment);
  const client = new AppServerClient(command, environment);
  try {
    await client.initialize();
    const projects: RemoteProjectCandidate[] = [];
    let cursor: string | null = null;
    do {
      const response = object(
        await client.request("project/list", {
          limit: 200,
          ...(cursor ? { cursor } : {}),
          sortKey: "recencyAt",
          sortDirection: "desc",
        }),
      );
      const rows = Array.isArray(response?.data) ? response.data : [];
      for (const raw of rows) {
        const project = object(raw) as AppServerRecord | null;
        const id = project ? projectId(project) : null;
        if (!project || !id) continue;
        const roots = projectRoots(project.roots);
        const threadsById = new Map<string, RemoteProject["threads"][number]>();
        for (const summary of await listThreads(client, { projectId: id })) {
          threadsById.set(summary.id, summary);
        }
        if (roots.length > 0) {
          for (const summary of await listThreads(client, { cwd: roots })) {
            threadsById.set(summary.id, summary);
          }
        }
        projects.push({
          key: createHash("sha256")
            .update("codexhost-remote-project-v1\0")
            .update(roots.length > 0 ? roots.join("\0") : `${project.name ?? id}\0`)
            .digest("hex")
            .slice(0, 16),
          name: typeof project.name === "string" && project.name.trim() ? project.name : id,
          roots,
          threads: [...threadsById.values()].sort(
            (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
          ),
        });
      }
      cursor = typeof response?.nextCursor === "string" ? response.nextCursor : null;
    } while (cursor);
    return projects;
  } finally {
    client.close();
  }
}

async function listThreads(
  client: AppServerClient,
  filter: { projectId: string } | { cwd: string[] },
): Promise<RemoteProject["threads"]> {
  const threads = new Map<string, RemoteProject["threads"][number]>();
  let cursor: string | null = null;
  do {
    const response = object(
      await client.request("thread/list", {
        ...filter,
        limit: 1_000,
        ...(cursor ? { cursor } : {}),
        sortKey: "recency_at",
        sortDirection: "desc",
      }),
    );
    for (const thread of Array.isArray(response?.data) ? response.data : []) {
      const summary = threadSummary((object(thread) ?? {}) as AppServerRecord);
      if (summary) threads.set(summary.id, summary);
    }
    cursor = typeof response?.nextCursor === "string" ? response.nextCursor : null;
  } while (cursor && threads.size < 10_000);
  return [...threads.values()];
}

async function publishCurrentAccount(
  environment: NodeJS.ProcessEnv,
): Promise<RemoteProjectAccount> {
  const identity = await accountIdentity(environment);
  const projects = (await listProjects(environment)).map(({ key, ...project }) => ({
    ...project,
    key,
  }));
  const account = {
    ...identity,
    current: false,
    projects,
  } satisfies RemoteProjectAccount;
  const filePath = metadataPath(environment);
  const document = await readMetadata(filePath);
  document.accounts = [
    ...document.accounts.filter((entry) => entry.id !== identity.id),
    account,
  ].sort((left, right) => left.label.localeCompare(right.label, "en"));
  await writeMetadata(filePath, document);
  return account;
}

async function snapshot(environment: NodeJS.ProcessEnv): Promise<RemoteProjectsSnapshot> {
  const identity = await accountIdentity(environment);
  const document = await readMetadata(metadataPath(environment));
  return remoteProjectsSnapshotSchema.parse({
    account: {
      ...identity,
      current: true,
      projects: document.accounts.find((entry) => entry.id === identity.id)?.projects ?? [],
    },
    accounts: document.accounts.map((account) => ({
      ...account,
      current: account.id === identity.id,
    })),
  });
}

export async function inspectRemoteProjectsOnHost(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<RemoteProjectsSnapshot> {
  return snapshot(environment);
}

export async function syncRemoteProjectsOnHost(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<RemoteProjectsSnapshot> {
  await publishCurrentAccount(environment);
  return snapshot(environment);
}

if (process.argv[1] === "-") {
  try {
    const request = JSON.parse(Buffer.from(process.argv[2] ?? "", "base64").toString("utf8"));
    const action = request && typeof request === "object" ? request.action : null;
    const result =
      action === "sync"
        ? await syncRemoteProjectsOnHost(process.env)
        : await inspectRemoteProjectsOnHost(process.env);
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stderr.write("Unable to read shared projects on SSH Host\n");
    process.exitCode = 1;
  }
}
