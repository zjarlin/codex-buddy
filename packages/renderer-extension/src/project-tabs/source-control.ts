import { normalizeProjectOrigin } from "@codexhost/shared-contracts";

import {
  groupProjectSources,
  type ProjectSource,
  type ProjectSourceGroup,
  type ProjectSourceGrouping,
} from "../renderer-project-sources.js";
import {
  parseProjectSourceDeferred,
  parseProjectSourceRetention,
  PROJECT_SOURCE_DEFERRED_KEY,
  PROJECT_SOURCE_RETENTION_KEY,
  projectSourceSignature,
} from "./source-model.js";

const PROJECT_ORIGIN_CACHE_KEY = "codexhost.project-origins.v1";
const ORIGIN_CACHE_LIMIT = 1_000;
const ORIGIN_RETRY_MS = 30_000;
// 仓库可能后来才添加 origin，或迁移到另一个远端；缓存需要定期复核，
// 不能把首次读到的 null 当成永久身份。
const ORIGIN_CACHE_TTL_MS = 10 * 60 * 1000;
// 读取 origin 的请求本身可能有 Host 侧超时；这里只兜底极端情况下一直不返回的调用，
// 超过这个时间就不再让询问无限期等待，按当前可用信息展示。
const ORIGIN_PENDING_TIMEOUT_MS = 15_000;

export interface ProjectOriginClient {
  inspectGitOrigin?(input: { cwd: string }): Promise<{ remote: string | null }>;
}

export interface ProjectSourceCandidate {
  id: string;
  name: string;
  hostId: string;
  scope: "local" | "remote";
  paths: readonly string[];
  available: boolean;
}

export interface ProjectSourceState extends ProjectSource {
  hostId: string;
  paths: string[];
}

interface OriginEntry {
  origin: string | null;
  checkedAt: number;
  /**
   * 仓库确实配置了远端，但地址带凭据或无法识别。它不能参与跨界合并，也和
   * “没有 Git”不同；只记标记，不把原始地址写进本地存储。
   */
  unusable?: boolean;
}

type OriginCache = Record<string, OriginEntry>;

function storageKey(hostId: string, cwd: string): string {
  return JSON.stringify([hostId, cwd]);
}

function parseOriginCache(raw: string | null): OriginCache {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const record = entry as Record<string, unknown>;
        const origin = record.origin;
        const checkedAt = record.checkedAt;
        if (origin !== null && typeof origin !== "string") return [];
        return [
          [
            key,
            {
              origin,
              checkedAt:
                typeof checkedAt === "number" && Number.isFinite(checkedAt) ? checkedAt : 0,
              ...(record.unusable === true ? { unusable: true } : {}),
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

/**
 * 解析每个项目根目录的 Git 来源，并按仓库身份决定保留哪个来源。
 *
 * 成功读取的 origin（包括“确认没有 Git”）写入本地缓存，离线主机下次仍能
 * 参与同一仓库的分组；读取失败不缓存，避免一次网络抖动永久改变项目身份。
 */
export class ProjectSourceControl {
  #storage: Pick<Storage, "getItem" | "setItem">;
  #getClient: (hostId: string) => ProjectOriginClient | null;
  #onUpdate: () => void;
  #origins: OriginCache;
  #pending = new Map<string, number>();
  #retryAt = new Map<string, number>();
  #disposed = false;
  // refresh 由侧栏变更按帧驱动；配置是小的 JSON 对象，按原始字符串记忆解析结果，
  // 避免每帧重复 JSON.parse。
  #retentionMemo: { raw: string | null; value: Record<string, string> } | null = null;
  #deferredMemo: { raw: string | null; value: Record<string, string> } | null = null;

  constructor(options: {
    storage: Pick<Storage, "getItem" | "setItem">;
    getClient(hostId: string): ProjectOriginClient | null;
    onUpdate(): void;
  }) {
    this.#storage = options.storage;
    this.#getClient = options.getClient;
    this.#onUpdate = options.onUpdate;
    try {
      this.#origins = parseOriginCache(options.storage.getItem(PROJECT_ORIGIN_CACHE_KEY));
    } catch {
      this.#origins = {};
    }
  }

  retention(): Record<string, string> {
    const raw = this.#read(PROJECT_SOURCE_RETENTION_KEY);
    if (this.#retentionMemo?.raw === raw) return this.#retentionMemo.value;
    const value = parseProjectSourceRetention(raw);
    this.#retentionMemo = { raw, value };
    return value;
  }

  choose(groupKey: string, sourceId: string): void {
    const retention = this.retention();
    retention[groupKey] = sourceId;
    this.#write(PROJECT_SOURCE_RETENTION_KEY, retention);
    const deferred = this.#deferred();
    if (Reflect.deleteProperty(deferred, groupKey)) {
      this.#write(PROJECT_SOURCE_DEFERRED_KEY, deferred);
    }
  }

  defer(groupKey: string, sourceIds: readonly string[]): void {
    const deferred = this.#deferred();
    deferred[groupKey] = projectSourceSignature(sourceIds);
    this.#write(PROJECT_SOURCE_DEFERRED_KEY, deferred);
  }

  /** 同一组可用来源没有变化时，用户此前的“稍后决定”仍然有效。 */
  isDeferred(groupKey: string, sourceIds: readonly string[]): boolean {
    return this.#deferred()[groupKey] === projectSourceSignature(sourceIds);
  }

  /**
   * 返回当前可确定的分组；缺失的 origin 会在后台补齐并触发 onUpdate。
   *
   * `clientFor` 允许一次刷新内复用 Host 连接查询结果（连接发现会回溯 React Fiber）；
   * 缺省时回到构造时注入的客户端解析。
   */
  update(
    candidates: readonly ProjectSourceCandidate[],
    clientFor?: (hostId: string) => ProjectOriginClient | null,
  ): ProjectSourceGrouping<ProjectSourceState> {
    const sources = candidates.map((candidate) => this.#resolve(candidate, clientFor));
    return groupProjectSources(sources, this.retention());
  }

  /**
   * 还有根目录的 origin 正在读取。来源身份逐个补齐时，先按项目名得到的临时分组
   * 会漏掉随后并入的来源；等这批读取落地后再决定是否询问，避免对话框少列来源、
   * 以及用户推迟后因来源集合变化立刻再次弹出。
   */
  pendingOrigins(): boolean {
    const now = Date.now();
    let pending = false;
    for (const startedAt of this.#pending.values()) {
      if (now - startedAt <= ORIGIN_PENDING_TIMEOUT_MS) {
        pending = true;
        continue;
      }
      // 超时的读取不再阻塞询问；清掉记录让后续刷新能重新发起，而不是永久卡住。
      for (const [key, since] of this.#pending) {
        if (since === startedAt) this.#pending.delete(key);
      }
    }
    return pending;
  }

  dispose(): void {
    this.#disposed = true;
    this.#pending.clear();
  }

  #resolve(
    candidate: ProjectSourceCandidate,
    clientFor?: (hostId: string) => ProjectOriginClient | null,
  ): ProjectSourceState {
    const paths = [...new Set(candidate.paths.filter(Boolean))];
    // 连接状态只决定来源是否在线；读取 origin 的客户端可能在项目行首次
    // 出现时尚未就绪，不能因此把该来源当成“没有 Git”。
    let client: ProjectOriginClient | null = null;
    try {
      client = clientFor ? clientFor(candidate.hostId) : this.#getClient(candidate.hostId);
    } catch {
      // Host 客户端暂时不可用只影响能否补读 origin，不影响已缓存的身份。
    }
    const entries = paths.map((cwd) => this.#entry(candidate.hostId, cwd));
    if (client) {
      for (const [index, cwd] of paths.entries()) {
        const entry = entries[index];
        if (!entry || Date.now() - entry.checkedAt > ORIGIN_CACHE_TTL_MS) {
          this.#request(candidate.hostId, cwd, client);
        }
      }
    }
    // 项目身份以主路径为准；附加根目录只用于排除“同一项目里放了多个仓库”
    // 的歧义情形，避免把容器目录和它内部的仓库误认为同一条目。
    const primary = entries[0] ?? null;
    const resolved = paths.length > 0 && entries.every(Boolean);
    const identities = new Set(
      entries.flatMap((entry) => {
        const identity = normalizeProjectOrigin(entry?.origin);
        return identity ? [identity] : [];
      }),
    );
    // 配置了远端但地址带凭据或无法识别时，项目确实有仓库身份，只是不能用于
    // 跨主机合并；这属于“不确定”，不能当成“没有 Git”按名字并进别的仓库。
    const unusableOrigin = entries.some(
      (entry) =>
        entry?.unusable === true ||
        ((entry?.origin ?? null) !== null && normalizeProjectOrigin(entry?.origin) === null),
    );
    let origin: string | null = null;
    let originResolved: boolean | undefined = resolved;
    if (resolved && (identities.size > 1 || unusableOrigin)) {
      originResolved = false;
    } else if (resolved && identities.size === 1) {
      const primaryIdentity = normalizeProjectOrigin(primary?.origin);
      // 主路径不是仓库、只有附加根目录是仓库时无法确定项目身份，
      // 不退回名称匹配，避免把容器项目和同名仓库合并。
      originResolved = primaryIdentity !== null;
      origin = primaryIdentity ? (primary?.origin ?? null) : null;
    } else if (resolved) {
      origin = null;
    }
    // 离线主机读不到 origin 时按项目名做“可能的同一项目”匹配：此时行本身
    // 不可用，隐藏它不会藏掉可用入口；重新联机后会再按真实 origin 校正。
    // 在线但读取失败的来源保持独立，绝不凭名称隐藏一个能正常打开的项目。
    if (!originResolved && !candidate.available) originResolved = undefined;
    return {
      id: candidate.id,
      name: candidate.name,
      hostId: candidate.hostId,
      scope: candidate.scope,
      paths,
      available: candidate.available,
      origin,
      ...(originResolved === undefined ? {} : { originResolved }),
    };
  }

  #deferred(): Record<string, string> {
    const raw = this.#read(PROJECT_SOURCE_DEFERRED_KEY);
    if (this.#deferredMemo?.raw === raw) return this.#deferredMemo.value;
    const value = parseProjectSourceDeferred(raw);
    this.#deferredMemo = { raw, value };
    return value;
  }

  #read(key: string): string | null {
    try {
      return this.#storage.getItem(key);
    } catch {
      return null;
    }
  }

  #entry(hostId: string, cwd: string): OriginEntry | null {
    return this.#origins[storageKey(hostId, cwd)] ?? null;
  }

  #request(hostId: string, cwd: string, client: ProjectOriginClient): void {
    if (this.#disposed || !client.inspectGitOrigin) return;
    const key = storageKey(hostId, cwd);
    if (this.#pending.has(key)) return;
    const retryAt = this.#retryAt.get(key) ?? 0;
    if (Date.now() < retryAt) return;
    this.#pending.set(key, Date.now());
    const inspect = client.inspectGitOrigin;
    if (!inspect) {
      this.#pending.delete(key);
      return;
    }
    let pending: Promise<{ remote: string | null }>;
    try {
      pending = inspect.call(client, { cwd });
    } catch {
      this.#pending.delete(key);
      this.#retryAt.set(key, Date.now() + ORIGIN_RETRY_MS);
      return;
    }
    void pending.then(
      ({ remote }) => {
        this.#pending.delete(key);
        this.#retryAt.delete(key);
        if (this.#disposed) return;
        // 有地址但不能用作身份时不保存原文（可能含凭据），只记“不可用”，
        // 让该来源继续独立显示而不是被当成“没有 Git”按名字合并。
        const usable = remote !== null && normalizeProjectOrigin(remote) !== null;
        this.#store(key, usable ? remote : null, remote !== null && !usable);
        this.#onUpdate();
      },
      () => {
        this.#pending.delete(key);
        this.#retryAt.set(key, Date.now() + ORIGIN_RETRY_MS);
        if (!this.#disposed) this.#onUpdate();
      },
    );
  }

  #store(key: string, origin: string | null, unusable = false): void {
    this.#origins[key] = { origin, checkedAt: Date.now(), ...(unusable ? { unusable } : {}) };
    const keys = Object.keys(this.#origins);
    if (keys.length > ORIGIN_CACHE_LIMIT) {
      for (const stale of keys.slice(0, keys.length - ORIGIN_CACHE_LIMIT)) {
        Reflect.deleteProperty(this.#origins, stale);
      }
    }
    this.#write(PROJECT_ORIGIN_CACHE_KEY, this.#origins);
  }

  #write(key: string, value: unknown): void {
    const raw = JSON.stringify(value);
    try {
      this.#storage.setItem(key, raw);
    } catch {
      // 本地缓存不可用只影响离线分组；当前会话仍按已读取的 origin 工作。
    }
    if (key === PROJECT_SOURCE_RETENTION_KEY)
      this.#retentionMemo = { raw, value: value as Record<string, string> };
    if (key === PROJECT_SOURCE_DEFERRED_KEY)
      this.#deferredMemo = { raw, value: value as Record<string, string> };
  }
}

export type ProjectSourceGroupState = ProjectSourceGroup<ProjectSourceState>;
