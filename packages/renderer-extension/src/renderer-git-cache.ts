import type { GitLogResult, GitWorkspaceStatus } from "@codexhost/shared-contracts";
import type { RendererGitClient } from "./renderer-git-sidebar.js";
import { gitTargetKey, gitTargetParams, type RendererGitTarget } from "./renderer-git-target.js";

const FRESH_MS = 30_000;
const MAX_ENTRIES = 48;
const MAX_BYTES = 16 * 1024 * 1024;

interface Entry {
  client: RendererGitClient;
  targetKey: string;
  key: string;
  value?: unknown;
  request?: Promise<unknown>;
  expiresAt: number;
  bytes: number;
}

// 缓存状态、历史与模型目录；并发读取共用请求，写入后失效。
export class RendererGitCache {
  readonly #entries: Entry[] = [];

  #find(client: RendererGitClient, target: RendererGitTarget, key: string): Entry | undefined {
    return this.#entries.find(
      (entry) =>
        entry.client === client && entry.targetKey === gitTargetKey(target) && entry.key === key,
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
    target: RendererGitTarget,
    key: string,
    read: () => Promise<T>,
  ): Promise<T> {
    let entry = this.#find(client, target, key);
    if (entry?.request) return entry.request as Promise<T>;
    if (entry?.value !== undefined && entry.expiresAt > Date.now()) {
      this.#remove(entry);
      this.#entries.push(entry);
      return Promise.resolve(entry.value as T);
    }
    if (!entry) {
      entry = { client, targetKey: gitTargetKey(target), key, expiresAt: 0, bytes: 0 };
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

  peekStatus(
    client: RendererGitClient,
    target: RendererGitTarget,
    repository?: string,
  ): GitWorkspaceStatus | null {
    return (
      (this.#find(client, target, JSON.stringify([repository, "status"]))?.value as
        GitWorkspaceStatus | undefined) ?? null
    );
  }

  status(
    client: RendererGitClient,
    target: RendererGitTarget,
    repository?: string,
  ): Promise<GitWorkspaceStatus> {
    return this.#read(client, target, JSON.stringify([repository, "status"]), () =>
      client.inspectGitStatus({
        ...gitTargetParams(target),
        ...(repository ? { repository } : {}),
      }),
    );
  }

  models(client: RendererGitClient, target: RendererGitTarget, repository?: string) {
    return this.#read(client, target, JSON.stringify([repository, "models"]), () =>
      client.listGitMessageModels({
        ...gitTargetParams(target),
        ...(repository ? { repository } : {}),
      }),
    );
  }

  history(
    client: RendererGitClient,
    target: RendererGitTarget,
    repository?: string,
  ): Promise<GitLogResult> {
    return this.#read(client, target, JSON.stringify([repository, "history"]), () => {
      if (!client.inspectGitLog) throw new Error("当前连接不支持提交历史。");
      return client.inspectGitLog({
        ...gitTargetParams(target),
        ...(repository ? { repository } : {}),
        limit: 200,
      });
    });
  }

  update(
    client: RendererGitClient,
    target: RendererGitTarget,
    status: GitWorkspaceStatus,
    repository?: string,
  ): void {
    this.invalidate(client);
    this.#store(
      {
        client,
        targetKey: gitTargetKey(target),
        key: JSON.stringify([repository, "status"]),
        expiresAt: 0,
        bytes: 0,
      },
      status,
    );
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
