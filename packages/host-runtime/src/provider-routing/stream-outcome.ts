import type { IncomingHttpHeaders } from "node:http";

export interface ResponsesStreamFailure {
  kind: "http" | "stream";
  retryable: boolean;
  status?: number;
}

export interface ResponsesStreamObserver {
  write(chunk: Uint8Array): void;
  end(): ResponsesStreamFailure | null;
}

const maxEventLength = 64 * 1024;
const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const errorStatuses: Record<string, number> = {
  rate_limit_exceeded: 429,
  rate_limit_error: 429,
  server_error: 500,
  internal_server_error: 500,
  internal_error: 500,
  api_error: 500,
  service_unavailable: 503,
  authentication_error: 401,
  invalid_api_key: 401,
  invalid_authentication: 401,
  permission_denied: 403,
  permission_error: 403,
  invalid_request_error: 400,
  invalid_request: 400,
  invalid_prompt: 400,
  context_length_exceeded: 400,
  model_not_found: 404,
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function failure(value: Record<string, unknown> | undefined): ResponsesStreamFailure {
  const response = object(value?.response);
  const error = object(response?.error) ?? object(value?.error) ?? value;
  for (const label of [error?.code, error?.type]) {
    const status =
      typeof label === "string" && Object.hasOwn(errorStatuses, label)
        ? errorStatuses[label]
        : undefined;
    if (status !== undefined) {
      return { kind: "http", status, retryable: transientStatuses.has(status) };
    }
  }
  // 未知错误仍显示为失败；没有明确的瞬时错误依据时不自动换供应商。
  return { kind: "stream", retryable: false };
}

class StreamObserver implements ResponsesStreamObserver {
  readonly #decoder = new TextDecoder();
  #line = "";
  #event = "";
  #data = "";
  #oversized = false;
  #skipLf = false;
  #terminal = false;
  #failure: ResponsesStreamFailure | null = null;
  #ended = false;

  write(chunk: Uint8Array): void {
    if (!this.#ended) {
      this.#consume(this.#decoder.decode(chunk, { stream: true }));
    }
  }

  end(): ResponsesStreamFailure | null {
    if (!this.#ended) {
      this.#consume(this.#decoder.decode());
      this.#ended = true;
    }
    return this.#failure ?? (this.#terminal ? null : { kind: "stream", retryable: true });
  }

  #consume(text: string): void {
    if (!text) {
      return;
    }
    let start = this.#skipLf && text.startsWith("\n") ? 1 : 0;
    this.#skipLf = false;
    const newlines = /\r\n|\r|\n/gu;
    newlines.lastIndex = start;
    for (let match = newlines.exec(text); match; match = newlines.exec(text)) {
      this.#append(text.slice(start, match.index));
      this.#consumeLine();
      start = newlines.lastIndex;
      this.#skipLf = match[0] === "\r" && start === text.length;
    }
    this.#append(text.slice(start));
  }

  #append(text: string): void {
    const remaining = maxEventLength - this.#line.length;
    this.#line += text.slice(0, remaining);
    if (text.length > remaining) {
      this.#oversized = true;
    }
  }

  #consumeLine(): void {
    const line = this.#line;
    this.#line = "";
    if (!line) {
      this.#dispatch();
      this.#event = "";
      this.#data = "";
      this.#oversized = false;
      return;
    }
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const raw = colon < 0 ? "" : line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "event") {
      this.#event = value;
    }
    if (field === "data") {
      const remaining = maxEventLength - this.#data.length;
      this.#data += (value + "\n").slice(0, remaining);
      this.#oversized ||= value.length + 1 > remaining;
    }
  }

  #dispatch(): void {
    if (!this.#data || this.#data.trim() === "[DONE]") {
      return;
    }
    let value: Record<string, unknown> | undefined;
    if (!this.#oversized) {
      try {
        value = object(JSON.parse(this.#data));
      } catch {
        return;
      }
      if (!value) {
        return;
      }
    }
    // 完整响应事件可能含很大的输出，只保留有上限的前缀并使用事件类型。
    const prefixType = /^\s*\{\s*"type"\s*:\s*"([^"]+)"/u.exec(this.#data)?.[1];
    const type = typeof value?.type === "string" ? value.type : this.#event || prefixType;
    if (type === "response.completed" || type === "response.incomplete") {
      this.#terminal = true;
    }
    if (type === "response.failed" || type === "error") {
      this.#failure ??= failure(value);
    }
  }
}

export function createResponsesStreamObserver(
  headers: IncomingHttpHeaders,
): ResponsesStreamObserver | null {
  const contentType = headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  const encoding = headers["content-encoding"]?.trim().toLowerCase();
  if (contentType !== "text/event-stream" || (encoding && encoding !== "identity")) {
    return null;
  }
  return new StreamObserver();
}
