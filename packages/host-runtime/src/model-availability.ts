import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readConnection } from "@codexhost/buddy-engine";
import {
  modelAvailabilityParamsSchema,
  modelAvailabilitySnapshotSchema,
  type ModelAvailabilityResult,
  type ModelAvailabilitySnapshot,
} from "@codexhost/shared-contracts";
import { z } from "zod";
import { parse } from "smol-toml";

const cacheSchema = z.object({
  scope: z.string(),
  snapshot: modelAvailabilitySnapshotSchema,
});
const catalogSchema = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });
const probeTimeoutMs = 15_000;
type Connection = Awaited<ReturnType<typeof readConnection>>;

class ProbeFailure extends Error {}

function emptySnapshot(): ModelAvailabilitySnapshot {
  return { provider: "", checkedAt: null, results: [] };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasCompletion(value: unknown, responses: boolean): boolean {
  const body = record(value);
  if (!body || body.error != null) {
    return false;
  }
  if (responses) {
    if (body.status !== "completed" || !Array.isArray(body.output)) {
      return false;
    }
    return body.output.some((item: unknown) => {
      const message = record(item);
      return (
        message?.type === "message" &&
        message.role === "assistant" &&
        Array.isArray(message.content) &&
        message.content.some((item: unknown) => {
          const content = record(item);
          return (
            content?.type === "output_text" &&
            typeof content.text === "string" &&
            content.text.trim().length > 0
          );
        })
      );
    });
  }
  if (!Array.isArray(body.choices)) {
    return false;
  }
  return body.choices.some((item: unknown) => {
    const choice = record(item);
    const message = record(choice?.message);
    return (
      (choice?.finish_reason === "stop" || choice?.finish_reason === "length") &&
      message?.role === "assistant" &&
      typeof message.content === "string" &&
      message.content.trim().length > 0
    );
  });
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProbeFailure(`供应商返回 HTTP ${response.status}。`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ProbeFailure("供应商返回空响应。");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 1_048_576) {
        await reader.cancel();
        throw new ProbeFailure("供应商响应超过探测大小限制。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProbeFailure("供应商未返回有效 JSON。");
  }
}

export interface ModelAvailabilityOptions {
  home: string;
  environment: NodeJS.ProcessEnv;
  privateMode(): Promise<boolean>;
}

// 只有手动 probe 产生请求；读取和应用重启始终复用上次完成的快照。
export class ModelAvailability {
  readonly #file: string;
  #pending: Promise<ModelAvailabilitySnapshot> | undefined;
  #controller: AbortController | undefined;

  constructor(private readonly options: ModelAvailabilityOptions) {
    this.#file = join(options.home, "model-availability.json");
  }

  async handle(value: unknown): Promise<ModelAvailabilitySnapshot> {
    const params = modelAvailabilityParamsSchema.parse(value);
    if (params.action === "read") {
      return this.#read();
    }
    if (this.#pending) {
      return this.#pending;
    }
    const pending = this.#probe(params.modelIds ?? []);
    this.#pending = pending;
    try {
      return await pending;
    } catch (error) {
      this.#controller?.abort();
      throw error;
    } finally {
      if (this.#pending === pending) {
        this.#pending = undefined;
        this.#controller = undefined;
      }
    }
  }

  close(): void {
    this.#controller?.abort();
  }

  async #localFile(name: string): Promise<string> {
    try {
      return await readFile(join(this.options.home, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw new Error("无法读取本地供应商配置或凭据。");
    }
  }

  async #scope(): Promise<string> {
    const [configSource, authSource] = await Promise.all([
      this.#localFile("config.toml"),
      this.#localFile("auth.json"),
    ]);
    let config: Record<string, unknown>;
    let auth: Record<string, unknown> | null;
    try {
      config = parse(configSource);
      auth = authSource ? record(JSON.parse(authSource)) : null;
    } catch {
      throw new Error("本地供应商配置或凭据格式无效。");
    }
    const providerId = config.model_provider ?? "openai";
    const selected = record(record(config.model_providers)?.[String(providerId)]) ?? {};
    const provider = Object.fromEntries(
      [
        "base_url",
        "wire_api",
        "env_key",
        "env_http_headers",
        "http_headers",
        "query_params",
        "auth",
        "experimental_bearer_token",
        "requires_openai_auth",
      ].map((key) => [key, selected[key]]),
    );
    // 仅读本地连接材料，不执行 auth.command；默认模型、目录和其他 Provider 不影响快照。
    const variables = new Set(["OPENAI_API_KEY", "OPENAI_BASE_URL"]);
    if (typeof selected.env_key === "string") {
      variables.add(selected.env_key);
    }
    for (const name of Object.values(record(selected.env_http_headers) ?? {})) {
      if (typeof name === "string") {
        variables.add(name);
      }
    }
    const environment = [...variables].sort().map((name) => [name, this.options.environment[name]]);
    return hash([providerId, provider, auth?.OPENAI_API_KEY, environment]);
  }

  async #read(): Promise<ModelAvailabilitySnapshot> {
    let source: string;
    try {
      source = await readFile(this.#file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptySnapshot();
      }
      throw new Error("无法读取上次模型探测结果。");
    }
    let cached: z.infer<typeof cacheSchema>;
    try {
      cached = cacheSchema.parse(JSON.parse(source));
    } catch {
      throw new Error("上次模型探测结果无效，请手动重新探测。");
    }
    return cached.scope === (await this.#scope()) ? cached.snapshot : emptySnapshot();
  }

  async #ensureAllowed(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (await this.options.privateMode()) {
      throw new ProbeFailure("隐私模式下不探测在线模型。");
    }
    signal.throwIfAborted();
  }

  async #model(
    connection: Connection,
    id: string,
    responses: boolean,
    signal: AbortSignal,
  ): Promise<ModelAvailabilityResult> {
    const started = Date.now();
    const result = { id, checkedAt: new Date().toISOString() };
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(probeTimeoutMs)]);
    const url = new URL(connection.url);
    url.pathname = url.pathname.replace(
      /\/models$/u,
      responses ? "/responses" : "/chat/completions",
    );
    const body = responses
      ? {
          model: id,
          input: "Reply only with OK.",
          stream: false,
          store: false,
        }
      : {
          model: id,
          messages: [{ role: "user", content: "Reply only with OK." }],
          stream: false,
          store: false,
        };
    try {
      const headers = new Headers(connection.headers);
      headers.set("Content-Type", "application/json");
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "error",
        signal: requestSignal,
      });
      const completion = await responseJson(response);
      requestSignal.throwIfAborted();
      if (!hasCompletion(completion, responses)) {
        throw new ProbeFailure("供应商未返回有效的模型回复。");
      }
      return { ...result, status: "available", latencyMs: Math.max(0, Date.now() - started) };
    } catch (error) {
      signal.throwIfAborted();
      return {
        ...result,
        status: "unavailable",
        latencyMs: Math.max(0, Date.now() - started),
        error: requestSignal.aborted
          ? "探测超时（15 秒）。"
          : error instanceof ProbeFailure
            ? error.message
            : "模型请求失败，未重试或切换模型。",
      };
    }
  }

  async #probe(modelIds: string[]): Promise<ModelAvailabilitySnapshot> {
    const controller = new AbortController();
    this.#controller = controller;
    const signal = controller.signal;
    await this.#ensureAllowed(signal);
    const scope = await this.#scope();
    let connection: Connection;
    try {
      connection = await readConnection(this.options.home, this.options.environment);
    } catch {
      throw new Error("无法读取供应商连接或 API 凭据；当前探测不支持仅有 ChatGPT 登录的账号。");
    }
    const provider = record(record(connection.config.model_providers)?.[connection.providerId]);
    const wireApi = provider?.wire_api ?? "responses";
    if (wireApi !== "responses" && wireApi !== "chat") {
      throw new Error("当前供应商接口不支持模型可用性探测。");
    }
    await this.#ensureAllowed(signal);
    let ids: string[];
    try {
      const response = await fetch(connection.url, {
        headers: connection.headers,
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      const catalog = catalogSchema.parse(await responseJson(response));
      ids = [...new Set([...catalog.data.map((model) => model.id), ...modelIds])];
    } catch (error) {
      throw new Error(
        error instanceof ProbeFailure ? error.message : "无法读取供应商模型目录，请手动重试。",
      );
    }
    let index = 0;
    const results: ModelAvailabilityResult[] = new Array(ids.length);
    const worker = async (): Promise<void> => {
      while (index < ids.length) {
        const position = index++;
        const id = ids[position];
        if (id === undefined) {
          break;
        }
        await this.#ensureAllowed(signal);
        results[position] = await this.#model(connection, id, wireApi === "responses", signal);
      }
    };
    const workers = Array.from({ length: Math.min(4, ids.length) }, worker);
    try {
      await Promise.all(workers);
    } catch (error) {
      controller.abort();
      await Promise.allSettled(workers);
      throw error;
    }
    await this.#ensureAllowed(signal);
    if (scope !== (await this.#scope())) {
      throw new Error("探测期间供应商或账号配置已变化，请重新手动探测。");
    }
    const snapshot: ModelAvailabilitySnapshot = {
      provider: connection.providerId,
      checkedAt: new Date().toISOString(),
      results,
    };
    const cache = {
      scope,
      snapshot,
    };
    await mkdir(this.options.home, { recursive: true });
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(cache, null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, this.#file);
    } catch {
      await rm(temporary, { force: true });
      throw new Error("模型探测已完成，但无法保存结果，请手动重试。");
    }
    return snapshot;
  }
}
