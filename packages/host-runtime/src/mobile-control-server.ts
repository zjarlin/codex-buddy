import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { WebSocketServer, type RawData, type WebSocket } from "ws";

import {
  MOBILE_PAIRING_MAX_CLIENTS,
  isMobileServerRequestMethod,
  mobilePairingRequestSchema,
} from "@codexhost/shared-contracts";

import {
  MobilePairingError,
  type MobilePairingSession,
  type MobilePairingStore,
} from "./mobile-pairing.js";
import { lanAddresses } from "./team-usage-http.js";

const MAX_JSON_BYTES = 8 * 1024;
/** Phone JSON-RPC frames stay well below this; thread history is read in responses. */
const MAX_SOCKET_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_PAIR_ATTEMPTS = 8;
const PAIR_WINDOW_MS = 60_000;
/** An unauthenticated socket must send its hello quickly. */
const HELLO_TIMEOUT_MS = 10_000;
/** Frames a phone may send while its hello is still being verified. */
const MAX_HELLO_QUEUE_BYTES = 1024 * 1024;
/** Outstanding Host requests a phone may answer; interactions are short-lived. */
const MAX_PENDING_SERVER_REQUESTS = 512;

/**
 * Phone clients can read Threads, continue a Turn, and answer the interactions that Turn
 * raises. Configuration, deletion, Git writes, file writes, and Host-private methods stay on
 * Desktop and the local console.
 */
const MOBILE_METHODS = new Set([
  "initialize",
  "initialized",
  "thread/list",
  "thread/start",
  "thread/read",
  "thread/resume",
  "thread/turns/list",
  "thread/items/list",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "model/list",
  "account/read",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mobileMethodAllowed(value: Record<string, unknown>): boolean {
  const message = value;
  return typeof message.method === "string" && MOBILE_METHODS.has(message.method);
}

function mobileServerRequestAllowed(value: Record<string, unknown>): boolean {
  return (
    typeof value.method === "string" &&
    (typeof value.id === "string" || typeof value.id === "number") &&
    isMobileServerRequestMethod(value.method)
  );
}

function requestIdKey(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? JSON.stringify(value) : null;
}

function serverRequestId(message: Record<string, unknown>): string | null {
  return requestIdKey(message.id);
}

function resolvedServerRequestId(message: Record<string, unknown>): string | null {
  const params = isRecord(message.params) ? message.params : null;
  return params ? requestIdKey(params.requestId) : null;
}

function securityHeaders(origin: string): Record<string, string> {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    // Safari does not reliably treat ws:// as 'self'; name this listener's own origin instead.
    "content-security-policy": `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ws://${origin}; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Codex Host · 手机控制</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script src="/app.js"></script>
</body>
</html>
`;

export interface MobileControlSession {
  run(): Promise<number>;
  /** Stops accepting this client's input without cancelling an active Turn. */
  disconnect(): void;
  /** Requests hard cancellation for listener shutdown. */
  close(): void;
}

export interface MobileControlSessionStreams {
  clientId: string;
  label: string;
  input: PassThrough;
  output: PassThrough;
}

export interface MobileControlServer {
  port(): number;
  invite(): Promise<{ url: string; expiresAt: number }>;
  /** Drops every authenticated socket of one revoked device. */
  disconnectClient(clientId: string): void;
  close(): Promise<void>;
}

export interface MobileControlServerOptions {
  pairing: MobilePairingStore;
  /** Builds one AppServerHost session for an authenticated phone. */
  createSession(streams: MobileControlSessionStreams): MobileControlSession;
  environment?: NodeJS.ProcessEnv;
  port?: number;
  /** Overrides the built mobile page; tests and source checkouts can provide it directly. */
  asset?: Buffer;
  /** Overrides the built mobile stylesheet. */
  styleAsset?: Buffer;
  /** Directory containing `mobile-web.js` in a release, or the source checkout root. */
  appDirectory?: string;
  diagnosticOutput?: NodeJS.WritableStream;
  now?: () => number;
}

function send(
  origin: string,
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
): void {
  response.writeHead(status, {
    ...securityHeaders(origin),
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendJson(origin: string, response: ServerResponse, status: number, value: unknown): void {
  send(origin, response, status, "application/json; charset=utf-8", `${JSON.stringify(value)}\n`);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_JSON_BYTES) return null;
    chunks.push(buffer);
  }
  if (size === 0) return null;
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function remoteAddress(request: IncomingMessage): string {
  const address = request.socket.remoteAddress ?? "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  throw new Error("Unsupported WebSocket frame payload");
}

function assetCandidates(appDirectory: string, extension: "js" | "css"): string[] {
  return [
    path.join(appDirectory, `mobile-web.${extension}`),
    path.resolve(appDirectory, "..", "..", "renderer-extension", "dist", `mobile.${extension}`),
  ];
}

/**
 * Picks the address a phone is most likely to reach. Container bridges and VPN tunnels sort
 * before Wi-Fi on some machines, so ordering by address alone can put an unreachable URL in the QR.
 */
function mobileLanAddresses(): string[] {
  const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|utun|tun|tap|zt|tailscale|wg)/u;
  const physical = /^(en|eth|wl|wlan)/u;
  const ranked: Array<{ address: string; score: number }> = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const score =
        (virtual.test(name.toLowerCase()) ? -100 : 0) +
        (physical.test(name.toLowerCase()) ? 10 : 0) +
        (entry.address.startsWith("192.168.") ? 5 : entry.address.startsWith("10.") ? 3 : 1);
      ranked.push({ address: entry.address, score });
    }
  }
  return ranked.sort((left, right) => right.score - left.score).map(({ address }) => address);
}

async function loadMobileAsset(
  appDirectory: string | undefined,
  extension: "js" | "css",
): Promise<Buffer | null> {
  if (!appDirectory) return null;
  for (const candidate of assetCandidates(appDirectory, extension)) {
    try {
      return await readFile(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

/** LAN access is opt-in; this listener binds all interfaces only when the user asks for it. */
export async function startMobileControlServer(
  options: MobileControlServerOptions,
): Promise<MobileControlServer> {
  const diagnostic = options.diagnosticOutput ?? process.stderr;
  const asset = options.asset ?? (await loadMobileAsset(options.appDirectory, "js"));
  const styleAsset = options.styleAsset ?? (await loadMobileAsset(options.appDirectory, "css"));
  const attempts = new Map<string, { count: number; since: number }>();
  const sessions = new Set<Promise<unknown>>();
  const sessionClosers = new Set<() => void>();
  const authenticated = new Map<MobilePairingSession, { socket: WebSocket; close: () => void }>();
  let port = 0;
  /** The address advertised in the QR; requests may also arrive on another LAN interface. */
  let origin = "";
  let allowedHosts = new Set<string>();
  let closing: Promise<void> | null = null;

  const hostAllowed = (host: string | undefined): host is string =>
    host !== undefined && allowedHosts.has(host);

  const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_SOCKET_FRAME_BYTES });
  const server = createServer((request, response) => {
    void (async () => {
      const host = request.headers.host;
      if (!origin || !hostAllowed(host)) {
        sendJson(origin || "invalid", response, 421, {
          error: "Unexpected Host header",
        });
        return;
      }
      if (request.method === "GET" && (request.url === "/" || request.url?.startsWith("/?"))) {
        send(host, response, 200, "text/html; charset=utf-8", PAGE);
        return;
      }
      if (request.method === "GET" && request.url === "/app.js") {
        if (!asset) {
          sendJson(host, response, 503, {
            error: "Mobile page assets are missing; rebuild codexhost",
          });
          return;
        }
        send(host, response, 200, "text/javascript; charset=utf-8", asset);
        return;
      }
      if (request.method === "GET" && request.url === "/app.css") {
        if (!styleAsset) {
          sendJson(host, response, 503, {
            error: "Mobile page assets are missing; rebuild codexhost",
          });
          return;
        }
        send(host, response, 200, "text/css; charset=utf-8", styleAsset);
        return;
      }
      if (request.method === "GET" && request.url === "/api/health") {
        sendJson(host, response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && request.url === "/api/pair") {
        const requestOrigin = request.headers.origin;
        if (
          requestOrigin !== undefined &&
          !allowedHosts.has(requestOrigin.replace(/^http:\/\//u, ""))
        ) {
          sendJson(host, response, 403, { error: "Cross-origin pairing is not allowed" });
          return;
        }
        const address = remoteAddress(request);
        const now = (options.now ?? Date.now)();
        const bucket = attempts.get(address);
        if (!bucket || bucket.since + PAIR_WINDOW_MS <= now) {
          attempts.set(address, { count: 1, since: now });
        } else if (bucket.count >= MAX_PAIR_ATTEMPTS) {
          sendJson(host, response, 429, { error: "Too many pairing attempts; wait a minute" });
          return;
        } else {
          bucket.count += 1;
        }
        const body = await readJson(request);
        if (!body) {
          sendJson(host, response, 400, { error: "Expected a JSON object" });
          return;
        }
        const parsed = mobilePairingRequestSchema.safeParse(body);
        if (!parsed.success) {
          sendJson(host, response, 400, { error: "Invalid pairing request" });
          return;
        }
        try {
          const credential = await options.pairing.redeem(parsed.data.invite, {
            clientId: parsed.data.clientId,
            label: parsed.data.label,
          });
          sendJson(host, response, 200, {
            schemaVersion: 1,
            clientId: credential.clientId,
            label: credential.label,
            token: credential.token,
            expiresAt: credential.expiresAt,
          });
        } catch (error) {
          if (error instanceof MobilePairingError) {
            sendJson(host, response, error.code === "full" ? 409 : 401, { error: error.message });
          } else {
            throw error;
          }
        }
        return;
      }
      sendJson(host, response, 404, { error: "Not found" });
    })().catch((error: unknown) => {
      diagnostic.write(
        `codexhost mobile control: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      if (!response.headersSent)
        sendJson(origin || "invalid", response, 500, { error: "Mobile control request failed" });
      else response.destroy();
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const host = request.headers.host;
    if (!origin || !hostAllowed(host) || request.url !== "/ws") {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const requestOrigin = request.headers.origin;
    if (!requestOrigin || !allowedHosts.has(requestOrigin.replace(/^http:\/\//u, ""))) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit("connection", webSocket, request);
    });
  });

  webSockets.on("connection", (socket) => {
    const input = new PassThrough();
    const output = new PassThrough();
    let session: MobileControlSession | null = null;
    let pairingSession: MobilePairingSession | null = null;
    let inputTail = Promise.resolve();
    let closingSocket = false;
    let sessionClosed = false;
    let finished = false;
    let startedHello = false;
    let authenticatedSocket = false;
    const serverRequestIds = new Set<string>();
    const queuedFrames: Buffer[] = [];
    let queuedBytes = 0;
    const helloTimer = setTimeout(() => {
      if (!pairingSession) socket.close(1008, "Client hello timed out");
    }, HELLO_TIMEOUT_MS);
    helloTimer.unref?.();

    const releasePairing = (): void => {
      clearTimeout(helloTimer);
      if (pairingSession) {
        authenticated.delete(pairingSession);
        void options.pairing.disconnect(pairingSession).catch(() => undefined);
      }
    };
    /** A transport disconnect stops reading input but lets an active Turn finish on the Host. */
    const disconnectSession = (): void => {
      if (closingSocket || finished) return;
      closingSocket = true;
      releasePairing();
      try {
        session?.disconnect();
      } catch (error) {
        diagnostic.write(
          `codexhost mobile control disconnect: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        input.destroy();
      }
      if (!session) input.destroy();
    };
    /** Listener shutdown and revocation are explicit cancellation; they must not wait for a Turn. */
    const closeSession = (): void => {
      clearTimeout(helloTimer);
      releasePairing();
      if (sessionClosed || finished) return;
      sessionClosed = true;
      closingSocket = true;
      input.destroy();
      try {
        session?.close();
      } catch (error) {
        diagnostic.write(
          `codexhost mobile control close: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    };
    socket.on("close", () => {
      disconnectSession();
    });
    socket.on("error", disconnectSession);

    const forward = (frame: Buffer, binary: boolean): void => {
      if (binary) {
        socket.close(1003, "Mobile control messages must be text");
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(frame.toString("utf8"));
      } catch {
        socket.close(1007, "Mobile control messages must be JSON");
        return;
      }
      if (!isRecord(parsed)) {
        socket.close(1008, "Mobile control messages must be objects");
        return;
      }
      const message = parsed;
      // A phone may answer only interactions this socket actually received. Native
      // responses and notifications remain inaccessible even though the wire shape is valid.
      const response =
        !("method" in message) &&
        (typeof message.id === "string" || typeof message.id === "number");
      const responseId = response ? JSON.stringify(message.id) : null;
      const allowed =
        mobileMethodAllowed(parsed) || (responseId !== null && serverRequestIds.delete(responseId));
      if (!allowed) {
        const request = parsed;
        if (typeof request.id === "string" || typeof request.id === "number") {
          socket.send(
            JSON.stringify({
              id: request.id,
              error: { code: -32601, message: `${request.method ?? "method"} is unavailable` },
            }),
            { binary: false },
          );
        }
        return;
      }
      inputTail = inputTail.then(
        () =>
          new Promise<void>((resolve, reject) => {
            input.write(Buffer.concat([frame, Buffer.from("\n")]), (error) =>
              error ? reject(error) : resolve(),
            );
          }),
      );
      void inputTail.catch(() => socket.close(1011, "Host Runtime input failed"));
    };

    const authenticate = (data: RawData, binary: boolean): void => {
      void (async () => {
        if (binary) {
          socket.close(1003, "Mobile control messages must be text");
          return;
        }
        let hello: unknown;
        try {
          hello = JSON.parse(rawDataBuffer(data).toString("utf8"));
        } catch {
          socket.close(1008, "Invalid client hello");
          return;
        }
        try {
          pairingSession = await options.pairing.hello(hello);
        } catch (error) {
          socket.close(1008, error instanceof Error ? error.message : "Pairing rejected");
          return;
        }
        clearTimeout(helloTimer);
        if (socket.readyState !== socket.OPEN) {
          await options.pairing.disconnect(pairingSession).catch(() => undefined);
          return;
        }
        session = options.createSession({
          clientId: pairingSession.clientId,
          label: pairingSession.label,
          input,
          output,
        });
        authenticated.set(pairingSession, { socket, close: closeSession });
        let pending = Buffer.alloc(0);
        output.on("data", (chunk: Buffer | string) => {
          pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
          let newline = pending.indexOf(0x0a);
          while (newline >= 0) {
            const frame = pending.subarray(0, newline);
            let forward = true;
            try {
              const value: unknown = JSON.parse(frame.toString("utf8"));
              if (value && typeof value === "object" && !Array.isArray(value)) {
                const message = value as Record<string, unknown>;
                const requestId = serverRequestId(message);
                if (
                  requestId !== null &&
                  typeof message.method === "string" &&
                  message.method !== "serverRequest/resolved"
                ) {
                  forward = mobileServerRequestAllowed(message);
                }
                if (
                  forward &&
                  requestId !== null &&
                  typeof message.method === "string" &&
                  message.method !== "serverRequest/resolved"
                ) {
                  if (serverRequestIds.size >= MAX_PENDING_SERVER_REQUESTS) {
                    const oldest = serverRequestIds.values().next().value;
                    if (oldest !== undefined) serverRequestIds.delete(oldest);
                  }
                  serverRequestIds.add(requestId);
                }
                if (message.method === "serverRequest/resolved" && isRecord(message.params)) {
                  const resolved = resolvedServerRequestId(message);
                  if (resolved !== null) serverRequestIds.delete(resolved);
                }
              }
            } catch {
              // The Host writes newline-delimited JSON; an invalid frame cannot be answered.
            }
            if (forward && socket.readyState === socket.OPEN) {
              socket.send(frame, { binary: false });
            }
            pending = pending.subarray(newline + 1);
            newline = pending.indexOf(0x0a);
          }
        });
        output.on("end", () => {
          if (socket.readyState === socket.OPEN) socket.close(1000);
        });
        const running = session
          .run()
          .then((code) => {
            if (code !== 0 && socket.readyState === socket.OPEN) {
              socket.close(1011, "Host Runtime exited");
            }
          })
          .catch((error: unknown) => {
            diagnostic.write(
              `codexhost mobile control: ${error instanceof Error ? error.message : String(error)}\n`,
            );
            if (socket.readyState === socket.OPEN) socket.close(1011, "Host Runtime failed");
          })
          .finally(() => {
            finished = true;
            input.destroy();
            output.end();
            sessions.delete(running);
            sessionClosers.delete(closeSession);
            if (pairingSession) {
              authenticated.delete(pairingSession);
              void options.pairing.disconnect(pairingSession).catch(() => undefined);
            }
          });
        sessions.add(running);
        sessionClosers.add(closeSession);
        authenticatedSocket = true;
        for (const frame of queuedFrames.splice(0)) forward(frame, false);
        queuedBytes = 0;
      })().catch((error: unknown) => {
        diagnostic.write(
          `codexhost mobile control hello: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        socket.close(1011, "Mobile control failed");
      });
    };

    socket.on("message", (data, binary) => {
      if (!startedHello) {
        startedHello = true;
        authenticate(data, binary);
        return;
      }
      if (authenticatedSocket) {
        forward(rawDataBuffer(data), binary);
        return;
      }
      // A phone may pipeline initialize behind its hello; hold those frames in order.
      if (binary) {
        socket.close(1003, "Mobile control messages must be text");
        return;
      }
      const frame = rawDataBuffer(data);
      queuedBytes += frame.length;
      if (queuedBytes > MAX_HELLO_QUEUE_BYTES) {
        socket.close(1009, "Too much data before authentication");
        return;
      }
      queuedFrames.push(frame);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  const address = mobileLanAddresses()[0] ?? lanAddresses()[0];
  if (!address) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("No LAN IPv4 address is available for mobile pairing");
  }
  origin = `${address}:${port}`;
  allowedHosts = new Set(lanAddresses().map((candidate) => `${candidate}:${port}`));
  allowedHosts.add(origin);

  return {
    port: () => port,
    async invite(): Promise<{ url: string; expiresAt: number }> {
      const base = `http://${origin}/`;
      const invite = await options.pairing.invite();
      return { url: `${base}?invite=${invite.secret}`, expiresAt: invite.expiresAt };
    },
    disconnectClient(clientId: string): void {
      for (const [session, connection] of authenticated) {
        if (session.clientId === clientId) {
          connection.socket.close(1008, "This device was unpaired");
          connection.close();
        }
      }
    },
    close(): Promise<void> {
      if (closing) return closing;
      closing = (async () => {
        for (const close of sessionClosers) close();
        for (const socket of webSockets.clients) socket.terminate();
        await new Promise<void>((resolve) => webSockets.close(() => resolve()));
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await Promise.allSettled([...sessions]);
      })();
      return closing;
    },
  };
}

/** Exposed for the Host Console so it can describe the limit without importing Store internals. */
export const MOBILE_CONTROL_MAX_CLIENTS = MOBILE_PAIRING_MAX_CLIENTS;
