import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GitAuthAccount, GitAuthMethod, GitProvider } from "@codexhost/shared-contracts";

/** 令牌只存在 Host 本地；这里返回的持久化记录不会跨进程回传浏览器。 */
export interface GitAuthRecord {
  host: string;
  provider: GitProvider;
  method: GitAuthMethod;
  username: string | null;
  label: string | null;
  /** HTTPS 访问令牌或口令；SSH 方式为空。 */
  token: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

const RECORD_VERSION = 1;

function key(host: string): string {
  return createHash("sha256").update(host.toLowerCase()).digest("hex");
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

function parseRecord(raw: unknown): GitAuthRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== RECORD_VERSION) return null;
  const host = optionalText(value.host, 255)?.toLowerCase();
  const method =
    value.method === "ssh-key" ? "ssh-key" : value.method === "https-token" ? "https-token" : null;
  const provider =
    value.provider === "github" ||
    value.provider === "gitee" ||
    value.provider === "gitlab" ||
    value.provider === "generic"
      ? value.provider
      : null;
  const createdAt = optionalText(value.createdAt, 64);
  if (!host || !method || !provider || !createdAt) return null;
  return {
    host,
    provider,
    method,
    username: optionalText(value.username, 255),
    label: optionalText(value.label, 255),
    token: optionalText(value.token, 8192),
    createdAt,
    verifiedAt: optionalText(value.verifiedAt, 64),
  };
}

/** 令牌永不进入投影；界面只依赖这一份摘要。 */
export function gitAuthAccountView(record: GitAuthRecord): GitAuthAccount {
  return {
    host: record.host,
    provider: record.provider,
    method: record.method,
    ...(record.username ? { username: record.username } : {}),
    ...(record.label ? { label: record.label } : {}),
    createdAt: record.createdAt,
    verifiedAt: record.verifiedAt,
  };
}

function validHost(host: string): string {
  const value = host.trim().toLowerCase();
  if (!value || value.length > 255 || /\s|[/\\]/u.test(value)) {
    throw new Error("Git 主机名无效。");
  }
  return value;
}

/**
 * 每个主机一份记录，权限 0600，写入走临时文件 + rename，避免半写坏文件。
 * 目录按 CODEX_HOME 隔离，与 mapping-store、git-repository-links 的落盘约定一致。
 */
export class GitAuthStore {
  #cache = new Map<string, GitAuthRecord | null>();

  constructor(private readonly home: string) {}

  #directory(): string {
    return path.join(this.home, "git-accounts");
  }

  #file(host: string): string {
    return path.join(this.#directory(), `${key(host)}.json`);
  }

  async read(host: string): Promise<GitAuthRecord | null> {
    const normalized = validHost(host);
    if (this.#cache.has(normalized)) return this.#cache.get(normalized) ?? null;
    const record = await this.#readFile(normalized);
    this.#cache.set(normalized, record);
    return record;
  }

  async #readFile(host: string): Promise<GitAuthRecord | null> {
    let raw: string;
    try {
      raw = await readFile(this.#file(host), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      const record = parseRecord(JSON.parse(raw));
      // 文件名是主机名的哈希；内容主机不一致说明记录被移动或损坏，不能当成有效登录态。
      return record?.host === host ? record : null;
    } catch {
      return null;
    }
  }

  async list(hosts: readonly string[]): Promise<GitAuthRecord[]> {
    const wanted = [...new Set(hosts.map(validHost))];
    const records = await Promise.all(wanted.map((host) => this.read(host)));
    return records.filter((record): record is GitAuthRecord => record !== null);
  }

  /** 已保存的全部主机；用于展示“项目已不再引用但仍有登录态”的主机。 */
  async storedHosts(): Promise<GitAuthRecord[]> {
    const names = await readdir(this.#directory()).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    });
    const records = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            return parseRecord(
              JSON.parse(await readFile(path.join(this.#directory(), name), "utf8")),
            );
          } catch {
            return null;
          }
        }),
    );
    return records.filter((record): record is GitAuthRecord => record !== null);
  }

  async save(input: {
    host: string;
    provider: GitProvider;
    method: GitAuthMethod;
    username?: string | null;
    label?: string | null;
    token?: string | null;
    verifiedAt?: string | null;
  }): Promise<GitAuthRecord> {
    const host = validHost(input.host);
    const existing = await this.read(host);
    const record: GitAuthRecord = {
      host,
      provider: input.provider,
      method: input.method,
      username: optionalText(input.username, 255) ?? existing?.username ?? null,
      label: optionalText(input.label, 255) ?? existing?.label ?? null,
      token: input.token ?? (input.method === "https-token" ? (existing?.token ?? null) : null),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      verifiedAt: input.verifiedAt ?? null,
    };
    const directory = this.#directory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = this.#file(host);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify({ version: RECORD_VERSION, ...record })}\n`, {
        mode: 0o600,
      });
      await chmod(temporary, 0o600);
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
    this.#cache.set(host, record);
    return record;
  }

  async markVerified(host: string, username: string | null): Promise<GitAuthRecord | null> {
    const existing = await this.read(host);
    if (!existing) return null;
    return this.save({
      host: existing.host,
      provider: existing.provider,
      method: existing.method,
      username: username ?? existing.username,
      label: existing.label,
      token: existing.token,
      verifiedAt: new Date().toISOString(),
    });
  }

  async remove(host: string): Promise<void> {
    const normalized = validHost(host);
    await rm(this.#file(normalized), { force: true });
    this.#cache.set(normalized, null);
  }
}
