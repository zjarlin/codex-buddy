import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  fallbackProviderSchema,
  providerModelsSchema,
  providerRoutingParamsSchema,
  type ProviderRoutingParams,
} from "@codexhost/shared-contracts";

const storedProvider = fallbackProviderSchema
  .extend({ apiKey: z.string().min(1) })
  .extend(providerModelsSchema.shape);

// 仅由网关拉取结果写入，与用户表单字段分开，避免编辑名称/模型时抹掉已同步目录。
export interface ProviderModelSync {
  id: string;
  models?: string[];
  syncedAt?: number;
}
const fileSchema = z.object({ enabled: z.boolean(), providers: z.array(storedProvider).max(20) });
export type RoutingConfiguration = z.infer<typeof fileSchema>;

export class ProviderRoutingStore {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(readonly home: string) {}

  async read(): Promise<RoutingConfiguration> {
    try {
      return fileSchema.parse(
        JSON.parse(await readFile(join(this.home, "provider-routing.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Cannot read provider routing configuration");
      }
    }
    // 旧应急配置仅作为缺省迁移来源；首次保存后由新文件独占配置所有权。
    try {
      const legacy = JSON.parse(await readFile(join(this.home, "emergency-provider.json"), "utf8"));
      if (!legacy.apiKey || !legacy.baseURL) {
        return { enabled: false, providers: [] };
      }
      return fileSchema.parse({
        enabled: legacy.enabled !== false,
        providers: [
          {
            id: "legacy-emergency",
            name: "Emergency",
            baseUrl: legacy.baseURL,
            apiKey: legacy.apiKey,
            model: "",
            enabled: true,
          },
        ],
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Cannot read legacy emergency provider configuration");
      }
      return { enabled: false, providers: [] };
    }
  }

  /** 写入网关拉取到的模型目录；拉取失败（无 models）的网关保留原有目录。 */
  recordModelSync(results: readonly ProviderModelSync[]): Promise<RoutingConfiguration> {
    return this.#mutate((config) => {
      for (const result of results) {
        const provider = config.providers.find((value) => value.id === result.id);
        if (!provider || !result.models) {
          continue;
        }
        provider.models = [...new Set(result.models)].sort((left, right) =>
          left.localeCompare(right),
        );
        provider.modelsSyncedAt = result.syncedAt ?? Date.now();
      }
    });
  }

  update(input: ProviderRoutingParams): Promise<RoutingConfiguration> {
    const params = providerRoutingParamsSchema.parse(input);
    if (params.action === "read" || params.action === "sync") {
      // 读与拉取不写文件：拉取结果由 recordModelSync 收敛，避免两处各自落盘。
      return this.read();
    }
    return this.#mutate((config) => {
      switch (params.action) {
        case "configure":
          config.enabled = params.enabled;
          break;
        case "save": {
          const index = config.providers.findIndex(
            (provider) => provider.id === params.provider.id,
          );
          const previous = config.providers[index];
          // 更换端点必须显式重新提供凭据，防止把旧供应商密钥发往新地址。
          const apiKey =
            params.apiKey ??
            (previous?.baseUrl === params.provider.baseUrl ? previous.apiKey : undefined);
          if (!apiKey) {
            throw new Error("An API key is required for a new endpoint");
          }
          // 表单不携带模型目录：端点未变时保留上一次拉取结果，端点变了旧目录已失效。
          const sameEndpoint = previous?.baseUrl === params.provider.baseUrl;
          const provider = storedProvider.parse({
            ...params.provider,
            apiKey,
            models: sameEndpoint ? (previous?.models ?? []) : [],
            modelsSyncedAt: sameEndpoint ? (previous?.modelsSyncedAt ?? null) : null,
          });
          if (index < 0) {
            config.providers.push(provider);
          } else {
            config.providers[index] = provider;
          }
          break;
        }
        case "remove":
          config.providers = config.providers.filter((provider) => provider.id !== params.id);
          break;
        case "move": {
          const index = config.providers.findIndex((provider) => provider.id === params.id);
          const target = index + (params.direction === "up" ? -1 : 1);
          if (index >= 0 && target >= 0 && target < config.providers.length) {
            const [provider] = config.providers.splice(index, 1);
            if (provider) {
              config.providers.splice(target, 0, provider);
            }
          }
          break;
        }
      }
    });
  }

  // 所有写操作共用一条队列：读-改-写之间不会被并发的保存/拉取插入。
  #mutate(change: (config: RoutingConfiguration) => void | Promise<void>) {
    const operation = this.#queue.then(async () => {
      const config = await this.read();
      await change(config);
      const next = fileSchema.parse(config);
      await mkdir(this.home, { recursive: true });
      const file = join(this.home, "provider-routing.json");
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
      return next;
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
}
