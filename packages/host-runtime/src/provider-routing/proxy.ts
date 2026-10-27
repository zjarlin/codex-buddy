import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ProviderFailure } from "@codexhost/shared-contracts";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { promisify } from "node:util";
import { gunzip, brotliDecompress, inflate, zstdDecompress } from "node:zlib";
import { createResponsesStreamObserver, type ResponsesStreamFailure } from "./stream-outcome.js";

export interface ProviderTarget {
  id: string;
  name?: string;
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

export interface ProviderRouteEvent {
  requestId: string;
  threadId: string;
  turnId: string;
  requestKind?: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  model?: string;
  fallback: boolean;
  state: "responding" | "completed" | "failed";
  failureKind?: ProviderFailure["kind"];
  httpStatus?: number;
  at: number;
}

interface ProxyOptions {
  targets(provider: string): Promise<ProviderTarget[]>;
  routed(target: ProviderTarget, fallback: boolean): void;
  observed?(event: ProviderRouteEvent): void;
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
  cooldownMs?: number;
}

interface TurnRequestMetadata {
  threadId: string;
  turnId: string;
  requestKind?: string;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestTurnMetadata(request: IncomingMessage): TurnRequestMetadata | null {
  const source = headerValue(request.headers["x-codex-turn-metadata"]);
  if (!source || source.length > 16 * 1024) return null;
  try {
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const threadId = Reflect.get(value, "thread_id");
    const turnId = Reflect.get(value, "turn_id");
    const requestKind = Reflect.get(value, "request_kind");
    if (
      typeof threadId !== "string" ||
      !threadId.trim() ||
      threadId.length > 200 ||
      typeof turnId !== "string" ||
      !turnId.trim() ||
      turnId.length > 200
    ) {
      return null;
    }
    return {
      threadId,
      turnId,
      ...(typeof requestKind === "string" && requestKind.trim() && requestKind.length <= 80
        ? { requestKind }
        : {}),
    };
  } catch {
    return null;
  }
}

const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const hopHeaders = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
]);
const fallbackHeaders = new Set(["content-type", "accept", "user-agent"]);
// 会话标识属于「同一段对话」而不是某个上游的私有状态：换供应商时必须一起带过去。
// OpenCode Go 从 2026-09 起要求每次上游调用带 x-opencode-session，缺了直接回
// 400 MissingSessionID；丢掉其余会话头则会让备用上游退化成每轮新会话、丢失
// prompt cache。这里只放行稳定的会话/缓存键，轮换型 ID 不在其中。
const fallbackSessionHeaders = new Set([
  "x-opencode-session",
  "x-session-id",
  "x-session-affinity",
  "x-conversation-id",
  "session-id",
  "session_id",
  "conversation_id",
]);
const decompress = {
  gzip: promisify(gunzip),
  br: promisify(brotliDecompress),
  deflate: promisify(inflate),
  zstd: promisify(zstdDecompress),
};

class ProviderAttemptError extends Error {
  constructor(
    readonly kind: ProviderFailure["kind"],
    readonly status?: number,
  ) {
    super("Provider request failed");
  }
}

function targetFingerprint(target: ProviderTarget): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([target.baseUrl, target.apiKey, target.model]))
    .digest("hex");
  return `${target.id}:${digest}`;
}

async function fallbackInput(
  request: IncomingMessage,
  body: Buffer,
): Promise<Record<string, unknown> | null> {
  if (!body.length) {
    return {};
  }
  const encoding = request.headers["content-encoding"];
  const decode =
    typeof encoding === "string" ? decompress[encoding as keyof typeof decompress] : undefined;
  if (encoding && encoding !== "identity" && !decode) {
    return null;
  }
  try {
    const decoded = decode ? await decode(body, { maxOutputLength: 32 * 1024 * 1024 }) : body;
    const value: unknown = JSON.parse(decoded.toString("utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Reflect.get(value, "previous_response_id")
    ) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    // 无法安全重建完整上下文时只交由原供应商处理，保留其原始错误。
    return null;
  }
}

export class ProviderFailoverProxy {
  readonly #token = randomBytes(32).toString("hex");
  readonly #failures = new Map<string, ProviderFailure>();
  readonly #server = createServer((request, response) => {
    void this.#handle(request, response).catch(() => {
      if (response.headersSent) {
        response.destroy();
      } else {
        response.writeHead(502).end("Provider routing failed");
      }
    });
  });
  #endpoint: string | null = null;
  constructor(private readonly options: ProxyOptions) {}

  async start(): Promise<void> {
    if (this.#endpoint) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", () => {
        this.#server.off("error", reject);
        resolve();
      });
    });
    const address = this.#server.address();
    if (!address || typeof address === "string") {
      throw new Error("Provider proxy failed to bind");
    }
    this.#endpoint = `http://127.0.0.1:${address.port}/${this.#token}`;
  }

  endpoint(provider: string): string {
    if (!this.#endpoint) {
      throw new Error("Provider proxy is not running");
    }
    return `${this.#endpoint}/${encodeURIComponent(provider)}`;
  }

  failures(targets: ProviderTarget[]): ProviderFailure[] {
    return targets.flatMap((target) => {
      const entry = this.#failure(target);
      return entry ? [{ ...entry }] : [];
    });
  }

  #failure(target: ProviderTarget): ProviderFailure | undefined {
    return this.#failures.get(targetFingerprint(target));
  }

  #recordFailure(
    target: ProviderTarget,
    kind: ProviderFailure["kind"],
    status?: number,
    retryable = true,
  ): void {
    const at = Date.now();
    const key = targetFingerprint(target);
    this.#failures.delete(key);
    this.#failures.set(key, {
      provider: target.id,
      kind,
      ...(status === undefined ? {} : { status }),
      at,
      retryAt: retryable ? at + (this.options.cooldownMs ?? 30_000) : 0,
    });
    // 热编辑期间旧请求仍可结束；各配置独立记录，并限制历史配置占用。
    if (this.#failures.size > 256) {
      const oldest = this.#failures.keys().next().value;
      if (oldest) this.#failures.delete(oldest);
    }
  }

  async close(): Promise<void> {
    if (!this.#endpoint) {
      return;
    }
    this.#endpoint = null;
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? "/", "http://127.0.0.1");
    const [, token, provider, ...suffix] = path.pathname.split("/");
    const route = suffix.join("/");
    if (
      token !== this.#token ||
      !provider ||
      !["responses", "responses/compact", "models"].includes(route)
    ) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.origin || !["GET", "POST"].includes(request.method ?? "")) {
      response.writeHead(403).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 32 * 1024 * 1024) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(bytes);
    }
    const body = Buffer.concat(chunks);
    const requestId = randomUUID();
    const turnMetadata = requestTurnMetadata(request);
    const observe = (
      target: ProviderTarget,
      fallback: boolean,
      state: ProviderRouteEvent["state"],
      details: Pick<ProviderRouteEvent, "failureKind" | "httpStatus"> = {},
    ) => {
      if (!turnMetadata) return;
      this.options.observed?.({
        requestId,
        threadId: turnMetadata.threadId,
        turnId: turnMetadata.turnId,
        ...(turnMetadata.requestKind ? { requestKind: turnMetadata.requestKind } : {}),
        providerId: target.id,
        providerName: target.name ?? target.id,
        baseUrl: target.baseUrl,
        ...(target.model ? { model: target.model } : {}),
        fallback,
        state,
        ...details,
        at: Date.now(),
      });
    };
    const targets = await this.options.targets(decodeURIComponent(provider));
    const input = targets.length > 1 ? await fallbackInput(request, body) : null;
    // 上游私有响应 ID 不能跨供应商。先排除不兼容候选，再决定是否跳过冷却中的主供应商。
    const eligible = input ? targets : targets.slice(0, 1);
    const available = eligible.filter(
      (target) => (this.#failure(target)?.retryAt ?? 0) <= Date.now(),
    );
    // 所有候选仍在冷却时只探测首选，避免把每次原生重试扩散到所有上游。
    const candidates = available.length ? available : eligible.slice(0, 1);
    const controller = new AbortController();
    if (response.destroyed) {
      return;
    }
    const onClose = () => {
      if (!response.writableEnded) {
        controller.abort();
      }
    };
    response.once("close", onClose);
    try {
      for (const target of candidates) {
        if (controller.signal.aborted) {
          return;
        }
        const fallback = target.id !== targets[0]?.id;
        let payload = body;
        if (fallback && body.length && input) {
          const value = { ...input, ...(target.model ? { model: target.model } : {}) };
          payload = Buffer.from(JSON.stringify(value));
        }
        try {
          const result = await this.#send(
            target,
            route,
            path.search,
            request,
            response,
            payload,
            fallback,
            controller.signal,
            target !== candidates.at(-1),
            () => observe(target, fallback, "responding"),
          );
          if (result.failure) {
            observe(target, fallback, "failed", {
              failureKind: result.failure.kind,
              ...(result.failure.status === undefined ? {} : { httpStatus: result.failure.status }),
            });
            this.#recordFailure(
              target,
              result.failure.kind,
              result.failure.status,
              result.failure.retryable,
            );
          } else if (result.status >= 200 && result.status < 300) {
            this.#failures.delete(targetFingerprint(target));
            this.options.routed(target, fallback);
            observe(target, fallback, "completed", { httpStatus: result.status });
          } else {
            observe(target, fallback, "failed", {
              failureKind: "http",
              httpStatus: result.status,
            });
            this.#recordFailure(
              target,
              "http",
              result.status,
              transientStatuses.has(result.status),
            );
          }
          return;
        } catch (error) {
          const kind =
            error instanceof ProviderAttemptError
              ? error.kind
              : response.headersSent
                ? "stream"
                : "network";
          const status = error instanceof ProviderAttemptError ? error.status : undefined;
          observe(target, fallback, "failed", {
            failureKind: kind,
            ...(status === undefined ? {} : { httpStatus: status }),
          });
          if (controller.signal.aborted) {
            return;
          }
          this.#recordFailure(target, kind, status);
          // 已交付的流不能在同一 HTTP 响应里拼接或重放。原生重试将优先使用其他上游。
          if (response.headersSent) {
            response.destroy();
            return;
          }
        }
      }
      response.writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" });
      response.end(
        JSON.stringify({
          error: { message: "All configured providers are unavailable", type: "server_error" },
        }),
      );
    } finally {
      response.off("close", onClose);
    }
  }

  #send(
    target: ProviderTarget,
    route: string,
    search: string,
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    fallback: boolean,
    signal: AbortSignal,
    hasFallback: boolean,
    onFirstByte: () => void,
  ): Promise<{ status: number; failure: ResponsesStreamFailure | null }> {
    const url = new URL(`${target.baseUrl.replace(/\/+$/u, "")}/${route}`);
    if (!fallback) {
      url.search = search;
    }
    const headers: Record<string, string | string[]> = {};
    const connectionHeaders = new Set(
      String(request.headers.connection ?? "")
        .toLowerCase()
        .split(",")
        .map((value) => value.trim()),
    );
    for (const [name, value] of Object.entries(request.headers)) {
      if (
        value === undefined ||
        hopHeaders.has(name) ||
        connectionHeaders.has(name) ||
        name === "content-length"
      ) {
        continue;
      }
      if (!fallback || fallbackHeaders.has(name) || fallbackSessionHeaders.has(name)) {
        headers[name] = value;
      }
    }
    if (fallback) {
      headers.authorization = `Bearer ${target.apiKey}`;
    }
    if (body.length) {
      headers["content-length"] = String(body.length);
    }
    return new Promise((resolve, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const upstream = send(url, { method: request.method, headers, signal }, (incoming) => {
        const status = incoming.statusCode ?? 502;
        if (hasFallback && transientStatuses.has(status)) {
          incoming.destroy();
          reject(new ProviderAttemptError("http", status));
          return;
        }
        const observer =
          status >= 200 && status < 300 ? createResponsesStreamObserver(incoming.headers) : null;
        // 首字节前保留响应头，连接关闭或超时仍可切换；长思考和流式回复用空闲超时。
        const commit = () => {
          clearTimeout(firstByte);
          if (response.headersSent) {
            return;
          }
          const outgoing = Object.fromEntries(
            Object.entries(incoming.headers).filter(
              ([name]) => !hopHeaders.has(name) && name !== "set-cookie",
            ),
          );
          response.writeHead(status, outgoing);
          if (status >= 200 && status < 300) onFirstByte();
        };
        incoming.once("data", commit);
        if (observer) {
          incoming.on("data", (chunk: Buffer) => observer.write(chunk));
        }
        incoming.once("end", () => {
          commit();
          resolve({ status, failure: observer?.end() ?? null });
        });
        incoming.once("error", reject);
        incoming.pipe(response, { end: true });
      });
      const firstByte = setTimeout(
        () => upstream.destroy(new ProviderAttemptError("timeout")),
        hasFallback
          ? (this.options.firstByteTimeoutMs ?? 20_000)
          : (this.options.idleTimeoutMs ?? 120_000),
      );
      firstByte.unref();
      upstream.setTimeout(this.options.idleTimeoutMs ?? 120_000, () =>
        upstream.destroy(new ProviderAttemptError("timeout")),
      );
      upstream.once("error", reject);
      upstream.once("close", () => clearTimeout(firstByte));
      upstream.end(body);
    });
  }
}
