import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
  type ProviderRoutingParams,
  type ProviderRoutingSnapshot,
} from "@codexhost/shared-contracts";
import { ProviderRoutingStore } from "./store.js";
import { ProviderFailoverProxy, type ProviderTarget } from "./proxy.js";

interface PrimaryProvider {
  id: string;
  name: string;
  baseUrl: string;
}

export class ProviderRouting {
  readonly store: ProviderRoutingStore;
  readonly #proxy: ProviderFailoverProxy;
  #primaries: PrimaryProvider[] = [];
  #starting: Promise<void> | undefined;
  #ready = false;
  #closed = false;
  #lastRoute: ProviderRoutingSnapshot["lastRoute"] = null;

  constructor(home: string) {
    this.store = new ProviderRoutingStore(home);
    this.#proxy = new ProviderFailoverProxy({
      targets: (provider) => this.#targets(provider),
      routed: (target, fallback) => {
        this.#lastRoute = { provider: target.id, fallback, at: Date.now() };
      },
    });
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

  async configure(input: ProviderRoutingParams): Promise<ProviderRoutingSnapshot> {
    const config = await this.store.update(input);
    const primaries = await this.#readPrimaries();
    return {
      enabled: config.enabled,
      providers: config.providers.map(({ apiKey, ...provider }) => ({
        ...provider,
        keyConfigured: Boolean(apiKey),
      })),
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

  async close(): Promise<void> {
    this.#closed = true;
    try {
      await this.#starting;
    } finally {
      this.#ready = false;
      await this.#proxy.close();
    }
  }

  async #targets(id: string): Promise<ProviderTarget[]> {
    const primary = this.#primaries.find((provider) => provider.id === id);
    if (!primary) {
      throw new Error("Unknown primary provider");
    }
    const config = await this.store.read();
    const targets: ProviderTarget[] = [{ id: `primary:${id}`, baseUrl: primary.baseUrl }];
    if (config.enabled) {
      targets.push(
        ...config.providers
          .filter((provider) => provider.enabled && provider.baseUrl !== primary.baseUrl)
          .map((provider) => ({
            id: provider.id,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: provider.model,
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
