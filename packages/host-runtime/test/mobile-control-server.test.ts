import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { MobilePairingStore } from "../src/mobile-pairing.js";
import {
  startMobileControlServer,
  type MobileControlSession,
  type MobileControlSessionStreams,
} from "../src/mobile-control-server.js";

const directories: string[] = [];
const closers: Array<() => Promise<void>> = [];

async function fixture(
  createSession?: (streams: MobileControlSessionStreams) => MobileControlSession,
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codexhost-mobile-server-"));
  directories.push(directory);
  const pairing = new MobilePairingStore({ file: path.join(directory, "state.json") });
  const inputFrames: string[] = [];
  const sessions: MobileControlSessionStreams[] = [];
  const server = await startMobileControlServer({
    pairing,
    appDirectory: path.resolve(import.meta.dirname, "../.."),
    asset: Buffer.from("window.mobile = true;\n"),
    styleAsset: Buffer.from("body { color: black; }\n"),
    environment: {},
    createSession: (streams) => {
      const { input } = streams;
      sessions.push(streams);
      let pending = "";
      input.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          inputFrames.push(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          newline = pending.indexOf("\n");
        }
      });
      if (createSession) return createSession(streams);
      const stopped = Promise.withResolvers<undefined>();
      return {
        run: async () => {
          await stopped.promise;
          return 0;
        },
        disconnect: () => stopped.resolve(undefined),
        close: () => stopped.resolve(undefined),
      };
    },
  });
  closers.push(() => server.close());
  return { pairing, server, port: server.port(), inputFrames, sessions };
}

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined)));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("mobile control LAN server", () => {
  it("refuses an unexpected loopback Host header", async () => {
    const { port } = await fixture();
    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.status).toBe(421);
  });

  it("serves built assets with a same-origin script policy", async () => {
    const { server, port } = await fixture();
    const invite = await server.invite();
    const base = new URL(invite.url).origin;
    const response = await fetch(`${base}/app.js`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("mobile");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain(`ws://${new URL(base).host}`);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(new URL(invite.url).searchParams.get("invite")).toMatch(/^[0-9a-f]{64}$/);
    expect(port).toBeGreaterThan(0);
  });

  it("redeems once and rejects an unauthenticated socket", async () => {
    const { server } = await fixture();
    const invite = await server.invite();
    const parsed = new URL(invite.url);
    const response = await fetch(`${parsed.origin}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: parsed.origin },
      body: JSON.stringify({
        invite: parsed.searchParams.get("invite"),
        clientId: "phone-0001",
        label: "Phone",
      }),
    });
    expect(response.status).toBe(200);
    const credential = (await response.json()) as { token: string; clientId: string };
    expect(credential.clientId).toBe("phone-0001");

    const second = await fetch(`${parsed.origin}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: parsed.origin },
      body: JSON.stringify({
        invite: parsed.searchParams.get("invite"),
        clientId: "phone-0002",
        label: "Other",
      }),
    });
    expect(second.status).toBe(401);

    const socket = new WebSocket(`${parsed.origin.replace("http:", "ws:")}/ws`, {
      origin: parsed.origin,
    });
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(
      JSON.stringify({
        schemaVersion: 1,
        kind: "mobile",
        clientId: "phone-0002",
        label: "Other",
        token: "0".repeat(64),
      }),
    );
    await expect(closed).resolves.toBe(1008);
  });

  it("admits mobile-only methods and answers a rejected method without forwarding it", async () => {
    const { pairing, server, inputFrames } = await fixture();
    const invite = await server.invite();
    const parsed = new URL(invite.url);
    const response = await fetch(`${parsed.origin}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: parsed.origin },
      body: JSON.stringify({
        invite: parsed.searchParams.get("invite"),
        clientId: "phone-0003",
        label: "Phone",
      }),
    });
    const credential = (await response.json()) as { token: string; clientId: string };
    expect((await pairing.status()).clients[0]?.connected).toBe(false);

    const socket = new WebSocket(`${parsed.origin.replace("http:", "ws:")}/ws`, {
      origin: parsed.origin,
    });
    const messages: string[] = [];
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.on("message", (data) => messages.push(String(data)));
    // Pipeline initialize behind the hello: the server must preserve both frames in order.
    socket.send(
      JSON.stringify({
        schemaVersion: 1,
        kind: "mobile",
        clientId: credential.clientId,
        label: "Phone",
        token: credential.token,
      }),
    );
    socket.send(JSON.stringify({ id: 0, method: "initialize", params: {} }));
    // The fixture session never emits output, so wait for auth before probing the filter.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await pairing.status()).clients[0]?.connected) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    socket.send(JSON.stringify({ id: 1, method: "thread/archive", params: {} }));
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (messages.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(JSON.parse(messages[0] ?? "{}")).toMatchObject({
      id: 1,
      error: { code: -32601 },
    });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (inputFrames.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(inputFrames.map((frame) => (JSON.parse(frame) as { method?: string }).method)).toEqual([
      "initialize",
    ]);
    socket.close();
  });

  it("forwards an answer only when this socket received that Host request", async () => {
    const requestId = -1_000_001;
    const { server, inputFrames } = await fixture(({ output }) => {
      const stopped = Promise.withResolvers<undefined>();
      return {
        run: async () => {
          output.write(
            `${JSON.stringify({
              id: requestId,
              method: "mcpServer/elicitation/request",
              params: {},
            })}\n`,
          );
          await stopped.promise;
          return 0;
        },
        disconnect: () => stopped.resolve(undefined),
        close: () => stopped.resolve(undefined),
      };
    });
    const invite = await server.invite();
    const parsed = new URL(invite.url);
    const response = await fetch(`${parsed.origin}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: parsed.origin },
      body: JSON.stringify({
        invite: parsed.searchParams.get("invite"),
        clientId: "phone-0004",
        label: "Phone",
      }),
    });
    const credential = (await response.json()) as { token: string; clientId: string };

    const socket = new WebSocket(`${parsed.origin.replace("http:", "ws:")}/ws`, {
      origin: parsed.origin,
    });
    const messages: string[] = [];
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.on("message", (data) => messages.push(String(data)));
    socket.send(
      JSON.stringify({
        schemaVersion: 1,
        kind: "mobile",
        clientId: credential.clientId,
        label: "Phone",
        token: credential.token,
      }),
    );
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (messages.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(JSON.parse(messages[0] ?? "{}")).toMatchObject({ id: requestId });

    socket.send(JSON.stringify({ id: requestId, result: { action: "decline" } }));
    socket.send(JSON.stringify({ id: requestId - 1, result: { action: "accept" } }));
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (inputFrames.length > 0 && messages.length > 1) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(inputFrames.map((frame) => JSON.parse(frame) as { id?: number })).toEqual([
      { id: requestId, result: { action: "decline" } },
    ]);
    expect(JSON.parse(messages[1] ?? "{}")).toMatchObject({
      id: requestId - 1,
      error: { code: -32601 },
    });
    socket.close();
  });

  it("forwards only phone interaction requests and never exposes authentication", async () => {
    const approvalIds = [-1_000_011, -1_000_012, -1_000_013];
    const hiddenId = -1_000_014;
    const { server, inputFrames } = await fixture(({ output }) => {
      const stopped = Promise.withResolvers<undefined>();
      return {
        run: async () => {
          output.write(
            [
              { id: approvalIds[0], method: "item/commandExecution/requestApproval", params: {} },
              { id: approvalIds[1], method: "item/fileChange/requestApproval", params: {} },
              { id: approvalIds[2], method: "item/permissions/requestApproval", params: {} },
              { id: hiddenId, method: "account/chatgptAuthTokens/refresh", params: {} },
            ]
              .map((message) => `${JSON.stringify(message)}\n`)
              .join(""),
          );
          await stopped.promise;
          return 0;
        },
        disconnect: () => stopped.resolve(undefined),
        close: () => stopped.resolve(undefined),
      };
    });
    const invite = await server.invite();
    const parsed = new URL(invite.url);
    const response = await fetch(`${parsed.origin}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: parsed.origin },
      body: JSON.stringify({
        invite: parsed.searchParams.get("invite"),
        clientId: "phone-0005",
        label: "Phone",
      }),
    });
    const credential = (await response.json()) as { token: string; clientId: string };

    const socket = new WebSocket(`${parsed.origin.replace("http:", "ws:")}/ws`, {
      origin: parsed.origin,
    });
    const messages: string[] = [];
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.on("message", (data) => messages.push(String(data)));
    socket.send(
      JSON.stringify({
        schemaVersion: 1,
        kind: "mobile",
        clientId: credential.clientId,
        label: "Phone",
        token: credential.token,
      }),
    );
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (messages.length >= approvalIds.length) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(messages.map((message) => (JSON.parse(message) as { id?: number }).id)).toEqual(
      approvalIds,
    );

    socket.send(JSON.stringify({ id: hiddenId, result: { ok: true } }));
    socket.send(JSON.stringify({ id: approvalIds[0], result: { decision: "accept" } }));
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (inputFrames.length > 0 && messages.length > approvalIds.length) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(inputFrames.map((frame) => JSON.parse(frame) as { id?: number })).toEqual([
      { id: approvalIds[0], result: { decision: "accept" } },
    ]);
    expect(JSON.parse(messages[approvalIds.length] ?? "{}")).toMatchObject({
      id: hiddenId,
      error: { code: -32601 },
    });
    socket.close();
  });
});
