import type { GitWorkspaceStatus, HostThreadId } from "@codexhost/shared-contracts";
import type { RendererGitClient } from "./renderer-git-sidebar.js";

const FRESH_MS = 30_000;
const MAX_ENTRIES = 48;
const MAX_BYTES = 16 * 1024 * 1024;

interface Entry {
  client: RendererGitClient;
  threadId: HostThreadId;
  key: string;
  value?: unknown;
  request?: Promise<unknown>;
  expiresAt: number;
  bytes: number;
}

// 只缓存只读快照；并发读取共用请求，写入后失效，限制正文占用的内存。
export class RendererGitCache {
  readonly #entries: Entry[] = [];

  #find(client: RendererGitClient, threadId: HostThreadId, key: string): Entry | undefined {
    return this.#entries.find(
      (entry) => entry.client === client && entry.threadId === threadId && entry.key === key,
    );
  }

  #remove(entry: Entry): void {
    const index = this.#entries.indexOf(entry);
    if (index >= 0) this.#entries.splice(index, 1);
  }

  #store(entry: Entry, value: unknown): void {
    entry.value = value;
    entry.expiresAt = Date.now() + FRESH_MS;
    entry.bytes = JSON.stringify(value).length * 2;
    this.#remove(entry);
    this.#entries.push(entry);
    let bytes = this.#entries.reduce((sum, item) => sum + item.bytes, 0);
    while (this.#entries.length > MAX_ENTRIES || bytes > MAX_BYTES) {
      const oldest = this.#entries.shift();
      if (oldest) bytes -= oldest.bytes;
    }
  }

  #read<T>(
    client: RendererGitClient,
    threadId: HostThreadId,
    key: string,
    read: () => Promise<T>,
  ): Promise<T> {
    let entry = this.#find(client, threadId, key);
    if (entry?.request) return entry.request as Promise<T>;
    if (entry?.value !== undefined && entry.expiresAt > Date.now()) {
      this.#remove(entry);
      this.#entries.push(entry);
      return Promise.resolve(entry.value as T);
    }
    if (!entry) {
      entry = { client, threadId, key, expiresAt: 0, bytes: 0 };
      this.#entries.push(entry);
      if (this.#entries.length > MAX_ENTRIES) this.#entries.shift();
    }
    const pending = entry;
    const request = read()
      .then((value) => {
        // 已被写操作清理的请求可以完成，但不能重新填回缓存。
        if (this.#entries.includes(pending)) this.#store(pending, value);
        return value;
      })
      .finally(() => {
        delete pending.request;
        if (pending.value === undefined) this.#remove(pending);
      });
    pending.request = request;
    return request;
  }

  peekStatus(client: RendererGitClient, threadId: HostThreadId): GitWorkspaceStatus | null {
    return (
      (this.#find(client, threadId, "status")?.value as GitWorkspaceStatus | undefined) ?? null
    );
  }

  status(client: RendererGitClient, threadId: HostThreadId): Promise<GitWorkspaceStatus> {
    return this.#read(client, threadId, "status", () => client.inspectGitStatus({ threadId }));
  }

  models(client: RendererGitClient, threadId: HostThreadId) {
    return this.#read(client, threadId, "models", () => client.listGitMessageModels({ threadId }));
  }

  diff(client: RendererGitClient, threadId: HostThreadId, path: string) {
    return this.#read(client, threadId, `diff:${path}`, async () => {
      const [diff, content] = await Promise.all([
        client.inspectGitDiff({ threadId, path }),
        client.inspectGitContent({ threadId, path }),
      ]);
      return { diff, content };
    });
  }

  update(client: RendererGitClient, threadId: HostThreadId, status: GitWorkspaceStatus): void {
    this.invalidate(client);
    this.#store({ client, threadId, key: "status", expiresAt: 0, bytes: 0 }, status);
  }

  invalidate(client: RendererGitClient): void {
    // 同一 Host 中的多个任务可能共享工作区，一并清理以免读到旧索引。
    for (const entry of [...this.#entries]) {
      if (entry.client === client) this.#remove(entry);
    }
  }

  clear(): void {
    this.#entries.length = 0;
  }
}
