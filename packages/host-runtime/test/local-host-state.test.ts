import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import {
  clearLocalHostListenerState,
  disableLocalHost,
  enableLocalHost,
  localHostEnabled,
  localHostPaths,
  probeLocalHost,
  localHostRuntimeIdentity,
  readLocalHostListenerState,
  writeLocalHostListenerState,
} from "../src/local-host-state.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexhost-local-host-state-"));
  roots.push(root);
  const environment = { HOME: root, CODEXHOST_DATA_DIR: path.join(root, "data") };
  return { root, environment, paths: localHostPaths(environment) };
}

describe.skipIf(process.platform === "win32")("persistent local Host state", () => {
  it("enables, reports, and disables persistence through the marker file", async () => {
    const { paths } = await fixture();
    expect(await localHostEnabled(paths)).toBe(false);
    await enableLocalHost(paths);
    expect(await localHostEnabled(paths)).toBe(true);
    await disableLocalHost(paths);
    expect(await localHostEnabled(paths)).toBe(false);
  });

  it("records listener identity and clears only its own state", async () => {
    const { root, paths } = await fixture();
    const runtime = path.join(root, "host-runtime.mjs");
    await writeFile(runtime, "console.log('first runtime');\n");
    await enableLocalHost(paths);
    await writeLocalHostListenerState(paths, runtime);
    const identity = await localHostRuntimeIdentity(runtime);
    await expect(readLocalHostListenerState(paths)).resolves.toEqual({
      pid: process.pid,
      runtimePath: runtime,
      runtimeIdentity: identity,
    });
    await clearLocalHostListenerState(paths);
    await expect(readLocalHostListenerState(paths)).resolves.toEqual({
      pid: null,
      runtimePath: null,
      runtimeIdentity: null,
    });
  });

  it("fingerprints Host Runtime contents so upgrades invalidate a listener", async () => {
    const { root } = await fixture();
    const runtime = path.join(root, "host-runtime.mjs");
    await writeFile(runtime, "export const version = 1;\n");
    const first = await localHostRuntimeIdentity(runtime);
    await expect(localHostRuntimeIdentity(runtime)).resolves.toBe(first);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/u);

    // A rewrite at the same path must change the identity, otherwise an upgraded
    // Desktop would keep reusing the previous listener.
    await writeFile(runtime, "export const version = 2;\n");
    await expect(localHostRuntimeIdentity(runtime)).resolves.not.toBe(first);
  });

  it("probes a running listener and reports a missing socket as stopped", async () => {
    const { paths } = await fixture();
    await expect(probeLocalHost(paths)).resolves.toMatchObject({ state: "stopped" });
    await enableLocalHost(paths);

    const server = createServer();
    const sockets = new WebSocketServer({ server });
    sockets.on("connection", (socket) => {
      socket.on("message", () => {
        socket.send(JSON.stringify({ id: 1, result: { status: null } }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(paths.socketPath, resolve);
    });
    try {
      await expect(probeLocalHost(paths)).resolves.toMatchObject({ state: "running" });
    } finally {
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("treats a socket owned by another app-server as unknown", async () => {
    const { paths } = await fixture();
    await enableLocalHost(paths);
    const server = createServer();
    const sockets = new WebSocketServer({ server });
    sockets.on("connection", (socket) => {
      socket.on("message", () => {
        socket.send(
          JSON.stringify({
            id: 1,
            error: { code: -32601, message: "unknown variant `codexhost/update/status`" },
          }),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(paths.socketPath, resolve);
    });
    try {
      await expect(probeLocalHost(paths)).resolves.toMatchObject({
        state: "unknown",
        message: "Socket belongs to a different app-server",
      });
    } finally {
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
