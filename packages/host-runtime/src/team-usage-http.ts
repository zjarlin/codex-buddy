import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";

export const MAX_BODY_BYTES = 8 * 1024;

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Pairing codes are eight digits; compare them without an early exit. */
export function sameCode(expected: string, provided: string): boolean {
  const left = Buffer.from(expected.padEnd(8, "0"), "utf8");
  const right = Buffer.from(provided.padEnd(8, "0"), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sameSecret(expectedHash: string, provided: string): boolean {
  const left = Buffer.from(expectedHash, "hex");
  const right = Buffer.from(hashSecret(provided), "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** IPv4 addresses this Host answers on; loopback is not useful to another member. */
export function lanAddresses(): string[] {
  const values: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      values.push(entry.address);
    }
  }
  return [...new Set(values)].sort();
}

export function addressesWithPort(port: number | null): string[] {
  return port === null ? [] : lanAddresses().map((address) => `${address}:${port}`);
}

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

/** A JSON object body within `MAX_BODY_BYTES`, or null when it is too large or not a JSON object. */
export async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function remoteAddress(request: IncomingMessage): string {
  const address = request.socket.remoteAddress ?? "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}
