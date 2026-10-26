import type { GitLogResult, GitWorkspaceStatus } from "@codexhost/shared-contracts";
import type { RendererGitClient } from "./renderer-git-sidebar.js";
import { gitTargetKey, gitTargetParams, type RendererGitTarget } from "./renderer-git-target.js";
import { reuseGitStatus } from "./renderer-git-status.js";

const FRESH_MS = 30_000;
const MAX_ENTRIES = 48;
const MAX_BYTES = 16 * 1024 * 1024;
// Host 的 Git 队列可能被长任务占住，状态或历史请求会一直不回包。超时只结束
// 渲染层的等待并释放操作锁；Host 的结果如果稍后到达仍由它自己处理。
export const GIT_READ_TIMEOUT_MS = 60_000;

// 超时与 Host 明确报错分开：超时只表示这次没等到结果，之前的状态仍然有效。
export class GitReadTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitReadTimeoutError";
  }
}

function withDeadline<T>(work: Promise<T>, timeout: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GitReadTimeoutError(message)), timeout);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface Entry {
  client: RendererGitClient;
  targetKey: string;
  key: string;
  value?: unknown;
  request?: Promise<unknown>;
  expiresAt: number;
  bytes: number;
}

// 状态与历史在 Git 写入后失效；Provider 模型目录按 Host 独立复用。
export class RendererGitCache {
  readonly #entries: Entry[] = [];
  #models = new WeakMap<
    RendererGitClient,
    { expiresAt: number; request: ReturnType<RendererGitClient["listGitMessageModels"]> }
  >();

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
    reuse?: (previous: unknown, next: T) => T,
    fresh = false,
  ): Promise<T> {
    let entry = this.#find(client, target, key);
    if (entry?.request) return entry.request as Promise<T>;
    if (!fresh && entry?.value !== undefined && entry.expiresAt > Date.now()) {
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
    const request = withDeadline(
      read(),
      GIT_READ_TIMEOUT_MS,
      "Host 未在 60 秒内返回 Git 结果，请重试。",
    )
      .then((value) => (reuse && pending.value !== undefined ? reuse(pending.value, value) : value))
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

  // fresh 只跳过新鲜度判断，仍复用进行中的请求与相同内容的上次结果，供周期刷新读取新状态。
  status(
    client: RendererGitClient,
    target: RendererGitTarget,
    repository?: string,
    options: { fresh?: boolean } = {},
  ): Promise<GitWorkspaceStatus> {
    return this.#read(
      client,
      target,
      JSON.stringify([repository, "status"]),
      () =>
        client.inspectGitStatus({
          ...gitTargetParams(target),
          ...(repository ? { repository } : {}),
        }),
      // 周期刷新常拿到内容相同的状态；沿用旧对象，界面按引用比较即可跳过重建。
      (previous, next) => reuseGitStatus(previous as GitWorkspaceStatus, next),
      options.fresh === true,
    );
  }

  models(client: RendererGitClient, target: RendererGitTarget, repository?: string) {
    const cached = this.#models.get(client);
    if (cached && cached.expiresAt > Date.now()) return cached.request;
    const entry = {
      expiresAt: Infinity,
      request: client.listGitMessageModels({
        ...gitTargetParams(target),
        ...(repository ? { repository } : {}),
      }),
    };
    this.#models.set(client, entry);
    void entry.request.then(
      (result) => {
        entry.expiresAt = Date.now() + (result.models.length ? 300_000 : 5_000);
      },
      () => {
        if (this.#models.get(client) === entry) this.#models.delete(client);
      },
    );
    return entry.request;
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
    this.#models = new WeakMap();
  }
}
