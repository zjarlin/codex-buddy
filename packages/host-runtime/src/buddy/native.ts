import type { JsonObject } from "@codexhost/protocol-core";

export type NativeRequest = (method: string, params: JsonObject) => Promise<JsonObject>;

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function result(response: JsonObject): JsonObject {
  if (response.error) {
    throw new Error(`App Server 拒绝请求：${String(object(response.error).message ?? "unknown")}`);
  }
  return object(response.result) as JsonObject;
}
