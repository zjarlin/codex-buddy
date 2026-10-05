import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";

export interface EmergencyProviderProxyOptions {
  readPrimaryUrl(): Promise<string>;
  emergencyBaseUrl: string;
  emergencyApiKey: string;
  diagnosticOutput?: Writable;
}

interface UpstreamTarget {
  url: URL;
  authHeader: string | null;
  label: "primary" | "emergency";
}

const PROXY_TIMEOUT_MS = 120_000;
const PRIMARY_CONNECT_TIMEOUT_MS = 4_000;

function resolveUpstream(
  baseUrl: string,
  path: string,
  authHeader: string | null,
  label: "primary" | "emergency",
): UpstreamTarget {
  const url = new URL(path, baseUrl);
  return { url, authHeader, label };
}

function sendUpstream(
  target: UpstreamTarget,
  req: IncomingMessage,
  res: ServerResponse,
  signal: AbortSignal,
  body: Buffer,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _diagnosticOutput: Writable | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const send = target.url.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (name === "host") continue;
      headers[name] = value;
    }
    if (target.authHeader) {
      headers["authorization"] = target.authHeader;
    }
    if (body.length > 0 && !headers["content-length"]) {
      headers["content-length"] = String(body.length);
    }
    let responded = false;
    const upstream = send(
      target.url,
      { method: req.method ?? "GET", headers, signal, timeout: PROXY_TIMEOUT_MS },
      (upstreamRes) => {
        responded = true;
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res, { end: true });
        upstreamRes.on("end", () => resolve());
        upstreamRes.on("error", (err) => {
          if (!res.writableEnded) res.end();
          reject(err);
        });
      },
    );
    upstream.on("error", (err) => {
      if (!responded && !res.headersSent && !res.writableEnded) {
        reject(err);
        return;
      }
      if (!res.writableEnded) {
        try { res.end(); } catch { /* ignore */ }
      }
      reject(err);
    });
    upstream.on("timeout", () => { upstream.destroy(new Error("upstream timeout")); });
    if (body.length > 0) upstream.write(body);
    upstream.end();
  });
}

async function collectBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export class EmergencyProviderProxy {
  readonly #server: Server;
  readonly #options: EmergencyProviderProxyOptions;
  #port: number | null = null;
  #closed = false;

  constructor(options: EmergencyProviderProxyOptions) {
    this.#options = options;
    this.#server = createServer((req, res) => void this.#handle(req, res));
  }

  get port(): number | null { return this.#port; }
  get endpoint(): string | null { return this.#port !== null ? `http://127.0.0.1:${this.#port}` : null; }

  async start(): Promise<number> {
    if (this.#closed) throw new Error("Emergency provider proxy is closed");
    return new Promise((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", () => {
        const address = this.#server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Emergency provider proxy failed to bind"));
          return;
        }
        this.#port = address.port;
        resolve(address.port);
      });
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#port = null;
    return new Promise((resolve) => { this.#server.close(() => resolve()); });
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = randomUUID().slice(0, 8);
    const reqPath = req.url ?? "/";
    let body: Buffer;
    try { body = await collectBody(req); } catch {
      res.writeHead(400); res.end("Emergency provider proxy: failed to read request body"); return;
    }

    let primaryBase: string;
    try { primaryBase = await this.#options.readPrimaryUrl(); } catch {
      this.#diagnose(requestId, "failed to read primary upstream URL"); primaryBase = "";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    if (primaryBase) {
      const primaryAuth = req.headers.authorization ?? null;
      const primary = resolveUpstream(primaryBase, reqPath, primaryAuth, "primary");
      const primarySignal = AbortSignal.any([controller.signal, AbortSignal.timeout(PRIMARY_CONNECT_TIMEOUT_MS)]);
      try {
        await sendUpstream(primary, req, res, primarySignal, body, this.#options.diagnosticOutput);
        clearTimeout(timeout); return;
      } catch (error) {
        this.#diagnose(requestId, `primary failed (${(error as Error)?.message ?? "unknown"}), trying emergency`);
      }
    }

    if (res.headersSent || res.writableEnded) { clearTimeout(timeout); return; }
    const emergency = resolveUpstream(
      this.#options.emergencyBaseUrl, reqPath,
      `Bearer ${this.#options.emergencyApiKey}`, "emergency",
    );
    try {
      await sendUpstream(emergency, req, res, controller.signal, body, this.#options.diagnosticOutput);
    } catch (error) {
      this.#diagnose(requestId, `emergency also failed (${(error as Error)?.message ?? "unknown"})`);
      if (!res.headersSent && !res.writableEnded) {
        try { res.writeHead(502); res.end("Emergency provider proxy: all upstreams failed"); } catch { /* ended */ }
      }
    } finally { clearTimeout(timeout); }
  }

  #diagnose(requestId: string, message: string): void {
    this.#options.diagnosticOutput?.write(`codexhost emergency-proxy [${requestId}]: ${message}\n`);
  }
}
