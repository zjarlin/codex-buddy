import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  fallbackProviderSchema,
  providerRoutingParamsSchema,
  type ProviderRoutingParams,
} from "@codexhost/shared-contracts";

const storedProvider = fallbackProviderSchema.extend({ apiKey: z.string().min(1) });
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

  update(input: ProviderRoutingParams): Promise<RoutingConfiguration> {
    const operation = this.#queue.then(async () => {
      const params = providerRoutingParamsSchema.parse(input);
      const config = await this.read();
      switch (params.action) {
        case "read":
          return config;
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
          const provider = storedProvider.parse({ ...params.provider, apiKey });
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
