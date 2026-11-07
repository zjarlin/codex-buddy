import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
  type ProviderRoutingParams,
  type ProviderRoutingSnapshot,
  type ProviderSyncResult,
  type HostThreadId,
  type ProviderHealth,
} from "@codexhost/shared-contracts";
import { probeProviderHealth, type ProviderRequestHeaders } from "../provider-health.js";
import { GatewayProjectAttribution } from "./project-attribution.js";
import { ProviderRoutingStore } from "./store.js";
import { mergeProviderModels, syncProviderModels } from "./models.js";
import { ProviderFailoverProxy, type ProviderTarget } from "./proxy.js";

interface PrimaryProvider {
  id: string;
  name: string;
  baseUrl: string;
}

export class ProviderRouting {
  readonly store: ProviderRoutingStore;
  readonly #proxy: ProviderFailoverProxy;
  readonly #projects = new GatewayProjectAttribution();
  #primaries: PrimaryProvider[] = [];
  #starting: Promise<void> | undefined;
  #ready = false;
  #closed = false;
  #lastRoute: ProviderRoutingSnapshot["lastRoute"] = null;

  constructor(home: string) {
    this.store = new ProviderRoutingStore(home);
    this.#proxy = new ProviderFailoverProxy({
      targets: (provider, threadId) => this.#targets(provider, threadId),
      projectCode: (baseUrl, authorization, threadId) =>
        this.#projects.project(baseUrl, authorization, threadId),
      routed: (target, fallback) => {
        this.#lastRoute = { provider: target.id, fallback, at: Date.now() };
      },
    });
  }

  setProjectRepositoryResolver(resolve: (threadId: string) => Promise<string | null>): void {
    this.#projects.setRepositoryResolver(resolve);
  }

  start(): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new Error("Provider routing is closed"));
    }
    if (this.#starting) {
      return this.#starting;
    }
    this.#starting = (async () => {
      this.#primaries = await this.#readPrimaries();
      await this.#proxy.start();
      this.#ready = true;
    })().catch((error: unknown) => {
      this.#starting = undefined;
      throw error;
    });
    return this.#starting;
  }

  arguments(args: readonly string[]): string[] {
    if (!this.#ready) {
      return [...args];
    }
    const overrides = this.#primaries.flatMap((provider) => {
      if (!/^[a-zA-Z0-9_-]+$/u.test(provider.id)) {
        return [];
      }
      const key = `model_providers.${provider.id}`;
      return [
        "-c",
        `${key}.base_url=${JSON.stringify(this.#proxy.endpoint(provider.id))}`,
        "-c",
        `${key}.supports_websockets=false`,
      ];
    });
    // 全局 -c 放在子命令前，覆盖配置文件而不持久化短生命周期代理地址。
    return [...overrides, ...args];
  }

  async configure(
    input: ProviderRoutingParams,
    thread?: { threadId: HostThreadId; primaryProviderId: string | null },
  ): Promise<ProviderRoutingSnapshot> {
    const primaries = await this.#readPrimaries();
    const covered = Boolean(
      this.#ready &&
      thread?.primaryProviderId &&
      /^[a-zA-Z0-9_-]+$/u.test(thread.primaryProviderId) &&
      primaries.some(
        (provider) =>
          provider.id === thread.primaryProviderId &&
          this.#primaries.some(
            (active) => active.id === provider.id && active.baseUrl === provider.baseUrl,
          ),
      ),
    );
    if (input.action === "select") {
      if (!thread || thread.threadId !== input.threadId || !covered) {
        throw new Error("This thread is not connected to the provider proxy on this Host");
      }
      const config = await this.store.read();
      if (
        input.providerId !== null &&
        input.providerId !== `primary:${thread.primaryProviderId}` &&
        !config.providers.some((provider) => provider.id === input.providerId && provider.apiKey)
      ) {
        throw new Error("Unknown thread provider");
      }
    }
    const syncResults = input.action === "sync" ? await this.#sync(input.id) : undefined;
    const config = await this.store.update(input);
    return {
      enabled: config.enabled,
      providers: config.providers.map(({ apiKey, ...provider }) => ({
        ...provider,
        keyConfigured: Boolean(apiKey),
      })),
      modelCatalog: mergeProviderModels(config.providers),
      ...(syncResults ? { syncResults } : {}),
      primaryProviders: primaries.map((provider) => ({
        ...provider,
        covered:
          this.#ready &&
          /^[a-zA-Z0-9_-]+$/u.test(provider.id) &&
          this.#primaries.some(
            (active) => active.id === provider.id && active.baseUrl === provider.baseUrl,
          ),
      })),
      ready: this.#ready,
      ...(thread
        ? {
            thread: {
              ...thread,
              covered,
              providerId: config.threadProviders[thread.threadId] ?? null,
            },
          }
        : {}),
      lastRoute: this.#lastRoute,
      failures: this.#proxy.failures([
        ...this.#primaries.map((provider) => ({
          id: `primary:${provider.id}`,
          baseUrl: provider.baseUrl,
        })),
        ...config.providers,
      ]),
    };
  }

  /**
   * 检查当前会话会用到的主供应商与备用供应商。显式选择会话供应商时只看该目标；
   * 自动模式按现有顺序返回主供应商和已启用且有密钥的备用项。
   */
  async health(input: {
    primaryProviderId: string;
    threadId?: string;
    primaryHeaders?: ProviderRequestHeaders;
    fetch?: typeof fetch;
    timeoutMs?: number;
  }): Promise<ProviderHealth[]> {
    const targets = await this.#targets(input.primaryProviderId, input.threadId);
    return Promise.all(
      targets.map(async (target) => {
        const headers = target.apiKey
          ? { Authorization: `Bearer ${target.apiKey}` }
          : target.fallback
            ? undefined
            : input.primaryHeaders;
        const result = await probeProviderHealth(target.baseUrl, headers, {
          ...(input.fetch ? { fetch: input.fetch } : {}),
          ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        });
        return {
          id: target.id,
          name: target.name ?? target.id,
          baseUrl: target.baseUrl,
          fallback: Boolean(target.fallback),
          healthy: result.healthy,
          status: result.status,
          reason: result.reason,
        };
      }),
    );
  }

  // 直接从各网关的 `/v1/models` 拉取模型目录：只同步已保存密钥的网关，
  // 省略 id 时同步全部已启用的网关。失败按网关独立记录，不整体失败。
  async #sync(id: string | undefined): Promise<ProviderSyncResult[]> {
    if (!this.#ready) {
      throw new Error("Provider routing is not ready");
    }
    const config = await this.store.read();
    const targets = config.providers.filter(
      (provider) => (id ? provider.id === id : provider.enabled) && Boolean(provider.apiKey),
    );
    const results = await Promise.all(targets.map((provider) => syncProviderModels(provider)));
    const syncedAt = Date.now();
    await this.store.recordModelSync(
      results.flatMap((result) =>
        result.error === undefined
          ? [{ id: result.provider, models: result.models ?? [], syncedAt }]
          : [{ id: result.provider }],
      ),
    );
    return results.map(({ provider, models, error }) => ({
      provider,
      modelCount: models?.length ?? 0,
      ...(error ? { error } : {}),
    }));
  }

  async close(): Promise<void> {
    this.#closed = true;
    try {
      await this.#starting;
    } finally {
      this.#ready = false;
      await this.#proxy.close();
    }
  }

  async #targets(id: string, threadId?: string): Promise<ProviderTarget[]> {
    const primary = this.#primaries.find((provider) => provider.id === id);
    if (!primary) {
      throw new Error("Unknown primary provider");
    }
    const config = await this.store.read();
    const targets: ProviderTarget[] = [{ id: `primary:${id}`, baseUrl: primary.baseUrl }];
    const selected = threadId ? config.threadProviders[threadId] : undefined;
    if (selected === `primary:${id}`) return targets;
    if (selected) {
      const provider = config.providers.find((provider) => provider.id === selected);
      if (!provider) throw new Error("Selected thread provider is unavailable");
      return [{ ...provider, fallback: true }];
    }
    if (config.enabled) {
      targets.push(
        ...config.providers
          .filter((provider) => provider.enabled && provider.baseUrl !== primary.baseUrl)
          .map((provider) => ({
            id: provider.id,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: provider.model,
            fallback: true,
          })),
      );
    }
    return targets;
  }

  async #readPrimaries(): Promise<PrimaryProvider[]> {
    let source: string;
    try {
      source = await readFile(join(this.store.home, "config.toml"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw new Error("Cannot read native provider configuration");
    }
    const config = parse(source);
    const providers = config.model_providers;
    if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
      return [];
    }
    return Object.entries(providers).flatMap(([id, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
        return [];
      }
      const baseUrl = value.base_url;
      if (typeof baseUrl !== "string" || (value.wire_api && value.wire_api !== "responses")) {
        return [];
      }
      if (!URL.canParse(baseUrl)) {
        return [];
      }
      const url = new URL(baseUrl);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        return [];
      }
      return [{ id, name: typeof value.name === "string" ? value.name : id, baseUrl }];
    });
  }
}
