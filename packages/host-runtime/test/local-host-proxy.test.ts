import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

import { runLocalHostProxy } from "../src/local-host-proxy.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

describe("persistent local Host proxy", () => {
  it("relays Desktop frames to the listener and back", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexhost-local-host-proxy-"));
    roots.push(root);
    const socketPath = path.join(root, "app-server.sock");
    const server = createServer();
    const sockets = new WebSocketServer({ server });
    sockets.on("connection", (socket) => {
      socket.on("message", (data) => socket.send(data.toString("utf8")));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    const input = new PassThrough();
    const output = new PassThrough();
    let received = "";
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      received += chunk;
    });
    const running = runLocalHostProxy({ socketPath, input, output });
    input.write(`${JSON.stringify({ id: 1, method: "ping" })}\n`);
    await vi.waitFor(() => expect(received).toBe(`${JSON.stringify({ id: 1, method: "ping" })}\n`));
    input.end();
    await expect(running).resolves.toBe(0);

    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
});
