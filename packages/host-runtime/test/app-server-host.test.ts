import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FakeHarnessAdapter, FakeHarnessSession } from "@codexhost/harness-adapter/testing";
import { type JsonObject } from "@codexhost/protocol-core";
import {
  encodeHarnessPluginRoute,
  harnessPluginRouteSchema,
  harnessIdSchema,
  hostThreadIdSchema,
} from "@codexhost/shared-contracts";

import {
  JsonLineCollector,
  bindOfficialThread,
  messageParams,
  method,
  requestId,
  requiredMessageId,
  turnEvent,
  writeRequest,
  readJsonLine,
  createFixture,
  startExternalThread,
  startPiThread,
  startPiTurn,
  completePiTurn,
  stopFixture,
} from "./app-server-host-fixture.js";

describe("AppServerHost idle resource release", () => {
  it("validates settings locally without forwarding them to the official server", async () => {
    const fixture = createFixture();
    try {
      await fixture.ready;
      writeRequest(fixture.desktopInput, {
        id: 900,
        method: "codexhost/settings/idle-release/set",
        params: { enabled: true, timeoutMinutes: 4 },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 900))).toMatchObject({
        error: { code: -32602 },
      });
      writeRequest(fixture.desktopInput, {
        id: 901,
        method: "codexhost/settings/idle-release/set",
        params: { enabled: false, timeoutMinutes: 30 },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 901))).toMatchObject({
        result: { enabled: false, timeoutMinutes: 30 },
      });
      expect(fixture.official.stdin.read()).toBeNull();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("silently releases an idle session and resumes its history for another Turn", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const fixture = createFixture();
    try {
      const threadId = await startPiThread(fixture);
      const turnId = await completePiTurn(fixture, threadId, 2);
      const source = fixture.adapter.sessions[0];
      if (!source) throw new Error("Missing source Session");
      const snapshot = await source.readSnapshot();
      if (!snapshot.ok) throw new Error(snapshot.error.message);
      const close = vi.spyOn(source, "close");
      const nativeOpen = fixture.adapter.open.bind(fixture.adapter);
      let resumed: FakeHarnessSession | undefined;
      const open = vi.spyOn(fixture.adapter, "open").mockImplementation(async (input) => {
        if (input.kind !== "resume") return nativeOpen(input);
        resumed = new FakeHarnessSession(
          fixture.adapter.harnessId,
          fixture.adapter.catalog,
          undefined,
          input.nativeRef,
          snapshot.value,
        );
        return { ok: true, value: resumed };
      });
      writeRequest(fixture.desktopInput, {
        id: 900,
        method: "codexhost/settings/idle-release/set",
        params: { enabled: true, timeoutMinutes: 10 },
      });
      await fixture.collector.waitFor((message) => requestId(message, 900));
      await vi.advanceTimersByTimeAsync(9 * 60_000);
      writeRequest(fixture.desktopInput, {
        id: 910,
        method: "codexhost/sessions/loaded/list",
        params: {},
      });
      const listing = await fixture.collector.waitFor((message) => requestId(message, 910));
      expect(listing).toMatchObject({
        result: [{ threadId, state: "idle", reason: "timeout", inactiveMs: 9 * 60_000 }],
      });
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(close).toHaveBeenCalledTimes(1);
      writeRequest(fixture.desktopInput, {
        id: 911,
        method: "codexhost/sessions/loaded/list",
        params: {},
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 911))).toMatchObject({
        result: [],
      });
      expect(open).not.toHaveBeenCalled();
      expect(fixture.collector.messages.some((message) => method(message, "thread/closed"))).toBe(
        false,
      );
      writeRequest(fixture.desktopInput, {
        id: 901,
        method: "thread/read",
        params: { threadId, includeTurns: false },
      });
      await fixture.collector.waitFor((message) => requestId(message, 901));
      expect(open).not.toHaveBeenCalled();
      writeRequest(fixture.desktopInput, {
        id: 902,
        method: "thread/read",
        params: { threadId, includeTurns: true },
      });
      const history = await fixture.collector.waitFor((message) => requestId(message, 902));
      expect(history).not.toHaveProperty("error");
      expect(JSON.stringify(history)).toContain(turnId);
      expect(open).toHaveBeenCalledTimes(1);
      const nextTurn = await startPiTurn(fixture, threadId, 903);
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/started", nextTurn));
      if (!resumed) throw new Error("Missing resumed Session");
      resumed.appendText("after idle release");
      resumed.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", nextTurn));
    } finally {
      await stopFixture(fixture);
      vi.useRealTimers();
    }
  });

  it("keeps an active Turn loaded even beyond the configured timeout", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const fixture = createFixture();
    try {
      const threadId = await startPiThread(fixture);
      const turnId = await startPiTurn(fixture, threadId);
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/started", turnId));
      const session = fixture.adapter.sessions[0];
      if (!session) throw new Error("Missing Session");
      const close = vi.spyOn(session, "close");
      writeRequest(fixture.desktopInput, {
        id: 900,
        method: "codexhost/settings/idle-release/set",
        params: { enabled: true, timeoutMinutes: 10 },
      });
      await fixture.collector.waitFor((message) => requestId(message, 900));
      await vi.advanceTimersByTimeAsync(31 * 60_000);
      expect(close).not.toHaveBeenCalled();
      session.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
    } finally {
      await stopFixture(fixture);
      vi.useRealTimers();
    }
  });
});

describe("AppServerHost official forwarding", () => {
  it.each([
    { method: "codexhost/unknown", params: {} },
    {
      method: "thread/start",
      params: { model: "gpt-5", cwd: "/synthetic", unknownParam: "opaque" },
    },
    {
      method: "turn/start",
      params: {
        threadId: "official-thread",
        input: [{ type: "text", text: "synthetic" }],
        unknownParam: "opaque",
      },
    },
  ])("forwards $method unchanged and relays backend errors", async ({ method, params }) => {
    const fixture = createFixture();
    try {
      await fixture.ready;
      const request = { id: 1, method, params };
      writeRequest(fixture.desktopInput, request);
      expect(await readJsonLine(fixture.official.stdin)).toEqual(request);
      const response = { id: 1, error: { code: -32601, message: "Synthetic backend error" } };
      writeRequest(fixture.official.stdout, response);
      expect(await fixture.collector.waitFor((message) => requestId(message, 1))).toEqual(response);
    } finally {
      await stopFixture(fixture);
    }
  });
});

describe("AppServerHost installed Harness plugins", () => {
  // A cold plugin import has a 10s per-plugin loader budget; RPC checks remain 2s.
  it("discovers an unknown plugin, serves its descriptor, routes a Thread, and closes it", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "codexhost-plugin-host-"));
    const location = path.join(directory, "sample-agent");
    mkdirSync(location);
    writeFileSync(
      path.join(directory, "enabled.json"),
      JSON.stringify({ version: 1, enabled: ["sample-agent"] }),
    );
    writeFileSync(
      path.join(location, "manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: "sample-agent",
        name: "Sample Agent",
        version: "1.0.0",
        adapterApiVersion: 1,
        entry: "index.mjs",
      }),
    );
    writeFileSync(
      path.join(location, "index.mjs"),
      `
      import { FakeHarnessAdapter } from ${JSON.stringify(pathToFileURL(path.resolve("packages/harness-adapter/dist/testing.js")).href)};
      import { writeFileSync } from "node:fs";
      let accountInspections = 0;
      export function createHarnessAdapter() {
        const adapter = new FakeHarnessAdapter("sample-agent");
        adapter.inspectAccount = async () => ({ email: "sample@example.com", credits: { usedPercent: ++accountInspections, periodType: "weekly" } });
        const close = adapter.close.bind(adapter);
        adapter.close = async () => { await close(); writeFileSync(new URL("closed", import.meta.url), "yes"); };
        return adapter;
      }
    `,
    );
    const fixture = createFixture({ pluginDirectory: directory, externalAdapters: new Map() });
    try {
      await fixture.ready;
      writeRequest(fixture.desktopInput, {
        id: 901,
        method: "codexhost/harness/plugins/list",
        params: {},
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 901))).toMatchObject({
        result: { plugins: [{ id: "sample-agent", name: "Sample Agent", version: "1.0.0" }] },
      });
      writeRequest(fixture.desktopInput, {
        id: 907,
        method: "codexhost/harness/accounts/sources",
        params: {},
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 907))).toMatchObject({
        result: {
          sources: [{ harnessId: "sample-agent", harnessName: "Sample Agent" }],
        },
      });
      writeRequest(fixture.desktopInput, {
        id: 908,
        method: "codexhost/harness/accounts/inspect",
        params: { harnessId: "sample-agent" },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 908))).toMatchObject({
        result: {
          harnessId: "sample-agent",
          harnessName: "Sample Agent",
          account: {
            email: "sample@example.com",
            credits: { usedPercent: 1 },
          },
        },
      });
      writeRequest(fixture.desktopInput, {
        id: 902,
        method: "codexhost/harness/inspect",
        params: { harnessId: "sample-agent" },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 902))).toMatchObject({
        result: { status: "ready" },
      });
      writeRequest(fixture.desktopInput, {
        id: 905,
        method: "codexhost/harness/accounts/list",
        params: {},
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 905))).toMatchObject({
        result: {
          accounts: [
            {
              harnessId: "sample-agent",
              harnessName: "Sample Agent",
              email: "sample@example.com",
              credits: { usedPercent: 1 },
            },
          ],
        },
      });
      writeRequest(fixture.desktopInput, {
        id: 909,
        method: "codexhost/harness/accounts/inspect",
        params: { harnessId: "sample-agent", refresh: true },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 909))).toMatchObject({
        result: {
          harnessId: "sample-agent",
          account: { credits: { usedPercent: 2 } },
        },
      });
      writeRequest(fixture.desktopInput, {
        id: 906,
        method: "codexhost/harness/accounts/list",
        params: { token: "invalid" },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 906))).toMatchObject({
        error: { code: -32602 },
      });
      const model = encodeHarnessPluginRoute(
        harnessPluginRouteSchema.parse({ harnessId: "sample-agent" }),
      );
      const threadId = await startExternalThread(fixture, model, 903);
      expect(
        await fixture.mappingStore.getThread(hostThreadIdSchema.parse(threadId)),
      ).toMatchObject({ harnessId: "sample-agent" });
      expect(fixture.official.stdin.readableLength).toBe(0);
      writeRequest(fixture.desktopInput, { id: 904, method: "initialize", params: {} });
      const initialize = await readJsonLine(fixture.official.stdin);
      expect(initialize).toMatchObject({ method: "initialize" });
      writeRequest(fixture.official.stdout, {
        id: requiredMessageId(initialize),
        result: { userAgent: "official" },
      });
      expect(await readJsonLine(fixture.official.stdin)).toMatchObject({ method: "initialized" });
      expect(await fixture.collector.waitFor((message) => requestId(message, 904))).toMatchObject({
        result: { userAgent: "official" },
      });
    } finally {
      await stopFixture(fixture);
      try {
        expect(readFileSync(path.join(location, "closed"), "utf8")).toBe("yes");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }, 15_000);

  it("keeps Qoder Global and CN Threads on distinct shared plugin routes", async () => {
    const ids = [harnessIdSchema.parse("qoder"), harnessIdSchema.parse("qoder-cn")];
    const fixture = createFixture({
      externalAdapters: new Map(ids.map((id) => [id, new FakeHarnessAdapter(id)])),
    });
    try {
      await fixture.ready;
      const threads: string[] = [];
      for (const [index, id] of ids.entries()) {
        const model = encodeHarnessPluginRoute({ harnessId: id });
        const threadId = await startExternalThread(fixture, model, 950 + index);
        threads.push(threadId);
        expect(
          await fixture.mappingStore.getThread(hostThreadIdSchema.parse(threadId)),
        ).toMatchObject({ harnessId: id });
      }
      expect(new Set(threads).size).toBe(2);
      expect(fixture.official.stdin.readableLength).toBe(0);
    } finally {
      await stopFixture(fixture);
    }
  });

  const pluginWaitMethods = [
    "codexhost/harness/inspect",
    "codexhost/harness/commands/inspect",
    "thread/start",
    "thread/resume",
  ];
  it.each(pluginWaitMethods)(
    "keeps official requests moving during plugin loading: %s",
    async (blockedMethod) => {
      const directory = mkdtempSync(path.join(tmpdir(), "codexhost-plugin-parallel-"));
      const location = path.join(directory, "slow-agent");
      const release = path.join(directory, "release");
      mkdirSync(location);
      writeFileSync(
        path.join(directory, "enabled.json"),
        JSON.stringify({ version: 1, enabled: ["slow-agent"] }),
      );
      writeFileSync(
        path.join(location, "manifest.json"),
        JSON.stringify({
          manifestVersion: 1,
          id: "slow-agent",
          name: "Slow Agent",
          version: "1.0.0",
          adapterApiVersion: 1,
          entry: "index.mjs",
        }),
      );
      writeFileSync(
        path.join(location, "index.mjs"),
        `
      import { access, writeFile } from "node:fs/promises";
      import { FakeHarnessAdapter } from ${JSON.stringify(pathToFileURL(path.resolve("packages/harness-adapter/dist/testing.js")).href)};
      const release = ${JSON.stringify(pathToFileURL(release).href)};
      async function waitForRelease() {
        for (;;) {
          try {
            await access(new URL(release));
            return;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
      }
      export async function createHarnessAdapter() {
        await writeFile(new URL("started", import.meta.url), "yes");
        await waitForRelease();
        const adapter = new FakeHarnessAdapter("slow-agent");
        await adapter.open({ kind: "create", cwd: "/synthetic" });
        return adapter;
      }
    `,
      );
      const fixture = createFixture({ pluginDirectory: directory, externalAdapters: new Map() });
      try {
        await fixture.ready;
        await vi.waitFor(() => expect(readdirSync(location)).toContain("started"));
        writeRequest(fixture.desktopInput, {
          id: 918,
          method: "initialize",
          params: { clientInfo: { name: "startup-test", version: "1" } },
        });
        const initialize = await readJsonLine(fixture.official.stdin);
        expect(initialize.method).toBe("initialize");
        writeRequest(fixture.official.stdout, {
          id: requiredMessageId(initialize),
          result: { userAgent: "test" },
        });
        expect(await fixture.collector.waitFor((message) => requestId(message, 918))).toMatchObject(
          {
            result: { userAgent: "test" },
          },
        );
        expect((await readJsonLine(fixture.official.stdin)).method).toBe("initialized");
        const model = encodeHarnessPluginRoute(
          harnessPluginRouteSchema.parse({ harnessId: "slow-agent" }),
        );
        for (const id of ["persisted-thread", "other-thread"]) {
          const hostThreadId = hostThreadIdSchema.parse(id);
          await fixture.mappingStore.createProvisional({
            hostThreadId,
            createRequestId: id,
            harnessId: harnessIdSchema.parse("slow-agent"),
            cwd: "/synthetic",
            title: "Persisted",
            transportModelId: model,
            ephemeral: false,
            historyMode: "legacy",
          });
          await fixture.mappingStore.commitReady({
            hostThreadId,
            nativeSessionRef: {
              harnessId: harnessIdSchema.parse("slow-agent"),
              nativeSessionId:
                id === "persisted-thread" ? "fake-session-1" : "other-native-session",
              formatVersion: 1,
            },
          });
        }
        writeRequest(fixture.desktopInput, {
          id: 920,
          method: blockedMethod,
          params:
            blockedMethod === "thread/start"
              ? { model, cwd: "/synthetic" }
              : blockedMethod === "thread/resume"
                ? { threadId: "persisted-thread" }
                : { harnessId: "slow-agent" },
        });
        if (blockedMethod === "thread/resume") {
          writeRequest(fixture.desktopInput, {
            id: 921,
            method: "thread/name/set",
            params: { threadId: "persisted-thread", name: "After resume" },
          });
          writeRequest(fixture.desktopInput, {
            id: 922,
            method: "thread/name/set",
            params: { threadId: "other-thread", name: "Independent" },
          });
          expect(
            await fixture.collector.waitFor((message) => requestId(message, 922)),
          ).toHaveProperty("result");
          expect(fixture.collector.messages.some((message) => requestId(message, 921))).toBe(false);
        }
        writeRequest(fixture.desktopInput, { id: 919, method: "model/list", params: {} });
        const models = await readJsonLine(fixture.official.stdin);
        expect(models.method).toBe("model/list");
        writeRequest(fixture.official.stdout, {
          id: requiredMessageId(models),
          result: { data: [] },
        });
        expect(await fixture.collector.waitFor((message) => requestId(message, 919))).toMatchObject(
          {
            result: { data: [] },
          },
        );
        expect(fixture.collector.messages.some((message) => requestId(message, 920))).toBe(false);
        writeFileSync(release, "ok");
        const completed = await fixture.collector.waitFor((message) => requestId(message, 920));
        expect(completed).toHaveProperty("result");
        if (blockedMethod === "thread/resume") {
          expect(completed).toMatchObject({ result: { thread: { id: "persisted-thread" } } });
          const renamed = await fixture.collector.waitFor((message) => requestId(message, 921));
          expect(renamed).toHaveProperty("result");
          expect(fixture.collector.messages.indexOf(renamed)).toBeGreaterThan(
            fixture.collector.messages.indexOf(completed),
          );
        }
        expect(fixture.official.stdin.readableLength).toBe(0);
      } finally {
        writeFileSync(release, "ok");
        fixture.host.close();
        try {
          await stopFixture(fixture);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }
    },
    10_000,
  );

  it.each(["close", "eof"])(
    "cancels blocked plugin loads on %s",
    async (ending) => {
      const ids = ["a-agent", "b-agent", "c-agent", "d-agent", "e-agent"];
      const directory = mkdtempSync(path.join(tmpdir(), "codexhost-plugin-close-"));
      const started = path.join(directory, "started");
      const finished = path.join(directory, "finished");
      mkdirSync(started);
      mkdirSync(finished);
      const release = path.join(directory, "release");
      writeFileSync(
        path.join(directory, "enabled.json"),
        JSON.stringify({ version: 1, enabled: ids }),
      );
      for (const id of ids) {
        const location = path.join(directory, id);
        mkdirSync(location);
        writeFileSync(
          path.join(location, "manifest.json"),
          JSON.stringify({
            manifestVersion: 1,
            id,
            name: id,
            version: "1.0.0",
            adapterApiVersion: 1,
            entry: "index.mjs",
          }),
        );
        writeFileSync(
          path.join(location, "index.mjs"),
          `
      import { access, writeFile } from "node:fs/promises";
      import { FakeHarnessAdapter } from ${JSON.stringify(pathToFileURL(path.resolve("packages/harness-adapter/dist/testing.js")).href)};
      const started = ${JSON.stringify(pathToFileURL(path.join(started, id)).href)};
      const finished = ${JSON.stringify(pathToFileURL(path.join(finished, id)).href)};
      const release = ${JSON.stringify(pathToFileURL(release).href)};
      export async function createHarnessAdapter() {
        await writeFile(new URL(started), "yes");
        try {
          for (;;) {
            try {
              await access(new URL(release));
              return new FakeHarnessAdapter(${JSON.stringify(id)});
            } catch {
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }
        } finally {
          await writeFile(new URL(finished), "yes");
        }
      }
    `,
        );
      }
      const fixture = createFixture({ pluginDirectory: directory, externalAdapters: new Map() });
      try {
        await fixture.ready;
        await vi.waitFor(() => expect(readdirSync(started)).toHaveLength(4));
        writeRequest(fixture.desktopInput, {
          id: 925,
          method: "codexhost/harness/commands/inspect",
          params: { harnessId: "a-agent" },
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (ending === "close") fixture.host.close();
        else fixture.desktopInput.end();
        let exitCode: number | undefined;
        void fixture.running.then(
          (code) => {
            exitCode = code;
          },
          () => undefined,
        );
        await vi.waitFor(() => expect(exitCode).toBe(0));
        expect(readdirSync(started).sort()).toEqual(["a-agent", "b-agent", "c-agent", "d-agent"]);
      } finally {
        fixture.host.close();
        writeFileSync(release, "ok");
        await vi.waitFor(() =>
          expect(readdirSync(finished).sort()).toEqual(readdirSync(started).sort()),
        );
        try {
          await stopFixture(fixture);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }
    },
    3_000,
  );

  it.each(["thread/start", "thread/resume", "codexhost/thread/command/execute"])(
    "drains an admitted Session open before EOF cleanup: %s",
    async (requestMethod) => {
      const fixture = createFixture();
      const release = Promise.withResolvers<undefined>();
      const opened = Promise.withResolvers<undefined>();
      const closeAdapter = vi.spyOn(fixture.adapter, "close");
      try {
        await fixture.ready;
        if (requestMethod !== "thread/start") {
          const seed = await fixture.adapter.open({ kind: "create", cwd: "/synthetic" });
          if (!seed.ok || !seed.value.initialState.nativeRef) {
            throw new Error("Cannot seed a native Session");
          }
          const hostThreadId = hostThreadIdSchema.parse("persisted-thread");
          await fixture.mappingStore.createProvisional({
            hostThreadId,
            createRequestId: "930",
            harnessId: harnessIdSchema.parse("pi"),
            cwd: "/synthetic",
            title: "Persisted",
            transportModelId: "codexhost/pi-native",
            ephemeral: false,
            historyMode: "legacy",
          });
          await fixture.mappingStore.commitReady({
            hostThreadId,
            nativeSessionRef: seed.value.initialState.nativeRef,
          });
        }
        const open = fixture.adapter.open.bind(fixture.adapter);
        vi.spyOn(fixture.adapter, "open").mockImplementation(async (input) => {
          const result = await open(input);
          opened.resolve(undefined);
          await release.promise;
          return result;
        });
        writeRequest(fixture.desktopInput, {
          id: 930,
          method: requestMethod,
          params:
            requestMethod === "thread/start"
              ? { model: "codexhost/pi-native", cwd: "/synthetic" }
              : { threadId: "persisted-thread", commandId: "compact" },
        });
        await opened.promise;
        writeRequest(fixture.desktopInput, { id: 931, method: "model/list", params: {} });
        expect((await readJsonLine(fixture.official.stdin)).method).toBe("model/list");
        fixture.desktopInput.end();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(closeAdapter).not.toHaveBeenCalled();
        release.resolve(undefined);
        await expect(fixture.running).resolves.toBe(0);
        expect(closeAdapter).toHaveBeenCalledOnce();
        const response = await fixture.collector.waitFor((message) => requestId(message, 930));
        if (requestMethod === "codexhost/thread/command/execute") {
          expect(response).toMatchObject({ error: { code: -32078 } });
        } else {
          expect(response).toHaveProperty("result");
        }
        expect(fixture.diagnosticOutput.read()?.toString() ?? "").not.toContain("closed");
      } finally {
        release.resolve(undefined);
        fixture.host.close();
        await stopFixture(fixture);
      }
    },
  );

  it("binds DeepSeek Session Import after its Adapter has been dynamically loaded", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "codexhost-dynamic-import-"));
    const location = path.join(directory, "deepseek-harness");
    mkdirSync(location);
    writeFileSync(
      path.join(directory, "enabled.json"),
      JSON.stringify({ version: 1, enabled: ["deepseek-harness"] }),
    );
    writeFileSync(
      path.join(location, "manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: "deepseek-harness",
        name: "DeepSeek Harness",
        version: "1",
        adapterApiVersion: 1,
        entry: "plugin.mjs",
      }),
    );
    writeFileSync(
      path.join(location, "plugin.mjs"),
      `
      import { FakeHarnessAdapter } from ${JSON.stringify(pathToFileURL(path.resolve("packages/harness-adapter/dist/testing.js")).href)};
      export function createHarnessAdapter() {
        const adapter = new FakeHarnessAdapter("deepseek-harness");
        adapter.sessionImport = {
          listCandidates: async () => ({ ok: true, value: [] }),
          resolveCandidate: async () => ({ ok: false, error: { code: "sessionNotFound", message: "Missing", retryable: false } }),
        };
        return adapter;
      }
    `,
    );
    const fixture = createFixture({ pluginDirectory: directory, externalAdapters: new Map() });
    try {
      writeRequest(fixture.desktopInput, {
        id: 910,
        method: "codexhost/deepseek/modern-session/list",
        params: {},
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 910))).toMatchObject({
        result: { candidates: [] },
      });
      writeRequest(fixture.desktopInput, {
        id: 911,
        method: "codexhost/harness/session-import/sources",
        params: {},
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 911))).toMatchObject({
        result: { harnesses: [{ harnessId: "deepseek-harness", name: "DeepSeek Harness" }] },
      });
    } finally {
      try {
        await stopFixture(fixture);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("persists launch settings through Host RPC and applies them only to the next plugin factory", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "codexhost-launch-rpc-"));
    const location = path.join(directory, "sample-agent");
    const entrypoint = path.join(directory, "installed-app");
    const received = path.join(directory, "received.json");
    mkdirSync(location);
    mkdirSync(entrypoint);
    writeFileSync(
      path.join(directory, "enabled.json"),
      JSON.stringify({ version: 1, enabled: ["sample-agent"] }),
    );
    writeFileSync(
      path.join(location, "manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: "sample-agent",
        name: "Sample",
        version: "1",
        adapterApiVersion: 1,
        entry: "plugin.mjs",
        launchCommand: true,
      }),
    );
    writeFileSync(
      path.join(location, "plugin.mjs"),
      `
      import { writeFileSync } from "node:fs";
      import { FakeHarnessAdapter } from ${JSON.stringify(pathToFileURL(path.resolve("packages/harness-adapter/dist/testing.js")).href)};
      export function createHarnessAdapter(context) {
        writeFileSync(${JSON.stringify(received)}, JSON.stringify(context.launchCommand ?? null));
        return new FakeHarnessAdapter("sample-agent");
      }
    `,
    );
    const options = {
      pluginDirectory: directory,
      environment: { CODEXHOST_DATA_DIR: path.join(directory, "data") },
    };
    let fixture = createFixture(options);
    let id = 960;
    const request = async (method: string, params: JsonObject) => {
      const requestIdValue = id++;
      writeRequest(fixture.desktopInput, { id: requestIdValue, method, params });
      return fixture.collector.waitFor((message) => requestId(message, requestIdValue));
    };
    try {
      const get = "codexhost/harness/launch-settings/get",
        set = "codexhost/harness/launch-settings/set";
      expect(await request(get, { harnessId: "sample-agent" })).toMatchObject({
        result: { path: null, restartRequired: false },
      });
      expect(await request(set, { harnessId: "sample-agent", path: entrypoint })).toMatchObject({
        result: { path: entrypoint, restartRequired: true },
      });
      expect(JSON.parse(readFileSync(received, "utf8"))).toBeNull();
      for (const params of [
        { harnessId: "pi", path: entrypoint },
        { harnessId: "missing-agent", path: entrypoint },
        { harnessId: "../escape", path: entrypoint },
        { harnessId: "sample-agent", path: "relative.cjs" },
        { harnessId: "sample-agent", path: entrypoint, extra: true },
      ])
        expect(await request(set, params)).toMatchObject({ error: { code: -32602 } });
      expect(fixture.official.stdin.readableLength).toBe(0);
      await stopFixture(fixture);
      fixture = createFixture(options);
      expect(await request(get, { harnessId: "sample-agent" })).toMatchObject({
        result: { path: entrypoint, restartRequired: false },
      });
      expect(JSON.parse(readFileSync(received, "utf8"))).toBe(entrypoint);
      expect(await request(set, { harnessId: "sample-agent", path: null })).toMatchObject({
        result: { path: null, restartRequired: true },
      });
    } finally {
      await stopFixture(fixture);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("validates catalog parameters and leaves uninstalled routes out of the official stream", async () => {
    const fixture = createFixture();
    try {
      writeRequest(fixture.desktopInput, {
        id: 911,
        method: "codexhost/harness/plugins/list",
        params: { directory: "/untrusted" },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 911))).toMatchObject({
        error: { code: -32602 },
      });
      writeRequest(fixture.desktopInput, {
        id: 912,
        method: "thread/start",
        params: {
          model: encodeHarnessPluginRoute(
            harnessPluginRouteSchema.parse({ harnessId: "missing-agent" }),
          ),
          cwd: "/synthetic",
        },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 912))).toHaveProperty(
        "error",
      );
      writeRequest(fixture.desktopInput, {
        id: 913,
        method: "thread/start",
        params: { model: "codexhost/plugin-v1@invalid", cwd: "/synthetic" },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 913))).toHaveProperty(
        "error",
      );
      expect(fixture.official.stdin.readableLength).toBe(0);
    } finally {
      await stopFixture(fixture);
    }
  });
});

describe("Buddy completed conversations", () => {
  it("archives completed conversations through the Host method", async () => {
    const fixture = createFixture();
    const native = new JsonLineCollector(fixture.official.stdin);
    await bindOfficialThread(fixture, "target");
    native
      .waitFor(
        (message) =>
          message.method === "thread/read" && messageParams(message).threadId === "target",
      )
      .then((request) => {
        fixture.official.stdout.write(
          `${JSON.stringify({
            id: requiredMessageId(request),
            result: {
              thread: { id: "target", cwd: "/project", status: { type: "idle" }, turns: [] },
            },
          })}\n`,
        );
      });
    native
      .waitFor((message) => message.method === "thread/list")
      .then((request) => {
        fixture.official.stdout.write(
          `${JSON.stringify({
            id: requiredMessageId(request),
            result: {
              data: [{ id: "target" }, { id: "done" }, { id: "running" }],
              nextCursor: null,
            },
          })}\n`,
        );
      });
    native
      .waitFor(
        (message) => message.method === "thread/read" && messageParams(message).threadId === "done",
      )
      .then((request) => {
        fixture.official.stdout.write(
          `${JSON.stringify({
            id: requiredMessageId(request),
            result: {
              thread: {
                id: "done",
                cwd: "/project",
                status: { type: "idle" },
                turns: [{ id: "turn", status: "completed" }],
              },
            },
          })}\n`,
        );
      });
    native
      .waitFor(
        (message) =>
          message.method === "thread/read" && messageParams(message).threadId === "running",
      )
      .then((request) => {
        fixture.official.stdout.write(
          `${JSON.stringify({
            id: requiredMessageId(request),
            result: {
              thread: { id: "running", cwd: "/project", status: { type: "active" }, turns: [] },
            },
          })}\n`,
        );
      });
    native
      .waitFor(
        (message) =>
          message.method === "thread/archive" && messageParams(message).threadId === "done",
      )
      .then((request) => {
        fixture.official.stdout.write(
          `${JSON.stringify({ id: requiredMessageId(request), result: {} })}\n`,
        );
      });
    try {
      writeRequest(fixture.desktopInput, {
        id: 59,
        method: "codexhost/thread/archive-completed",
        params: { threadId: "target" },
      });
      await expect(fixture.collector.waitFor((message) => requestId(message, 59))).resolves.toEqual(
        {
          id: 59,
          result: { archived: 1, skipped: 1, failed: 0 },
        },
      );
    } finally {
      await stopFixture(fixture);
    }
  });
});

describe("Buddy catalog synchronization boundary", () => {
  it("hot updates model/list without restarting, preserves a good catalog on failure and accepts zero models", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "buddy-catalog-host-"));
    const directory = path.join(home, "model-sync");
    mkdirSync(directory);
    writeFileSync(
      path.join(directory, "runtime.mjs"),
      `
      import { readFileSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      const home = process.argv[process.argv.indexOf("--home") + 1];
      const source = JSON.parse(readFileSync(join(home, "fixture.json"), "utf8"));
      const catalogPath = join(home, "model-sync", "catalog.json");
      writeFileSync(catalogPath, JSON.stringify({models:source.ids.map((slug, priority) => ({
        slug, display_name: slug, description: "fixture", priority,
        visibility: "list", supported_in_api: true, input_modalities: ["text"],
        default_reasoning_level: "low",
        supported_reasoning_levels: [{effort: "low", description: "Low"}]
      }))}));
      console.log(JSON.stringify({ok:true,provider:"fixture",visibleCount:source.ids.length,catalogPath}));
    `,
    );
    const fixture = createFixture({ buddyRouting: true, environment: { CODEX_HOME: home } });
    await fixture.ready;
    const answerNativeModels = async () => {
      const request = await readJsonLine(fixture.official.stdin);
      expect(request.method).toBe("model/list");
      writeRequest(fixture.official.stdout, {
        id: requiredMessageId(request),
        result: { data: [{ model: "stale" }], nextCursor: null },
      });
    };
    const refresh = async (id: number, ids: string[], provider = "fixture") => {
      writeFileSync(path.join(home, "fixture.json"), JSON.stringify({ ids }));
      writeRequest(fixture.desktopInput, {
        id,
        method: "codexhost/buddy/catalog-sync",
        params: {},
      });
      const configRead = await readJsonLine(fixture.official.stdin);
      expect(configRead.method).toBe("config/read");
      if (id === 7001) {
        writeRequest(fixture.desktopInput, {
          id: 70011,
          method: "codexhost/buddy/catalog-sync",
          params: {},
        });
        writeRequest(fixture.desktopInput, { id: 70012, method: "model/list", params: {} });
        await answerNativeModels();
        expect(await fixture.collector.waitFor((message) => message.id === 70012)).toMatchObject({
          result: { data: [{ model: "stale" }] },
        });
      }
      writeRequest(fixture.official.stdout, {
        id: requiredMessageId(configRead),
        result: { config: { model_provider: provider } },
      });
      if (provider === "fixture") await answerNativeModels();
      return fixture.collector.waitFor((message) => message.id === id);
    };
    const models = async (id: number) => {
      writeRequest(fixture.desktopInput, { id, method: "model/list", params: {} });
      await answerNativeModels();
      const reply = await fixture.collector.waitFor((message) => message.id === id);
      return (reply.result as JsonObject).data as JsonObject[];
    };
    try {
      writeRequest(fixture.desktopInput, { id: 7000, method: "model/list", params: {} });
      const original = await readJsonLine(fixture.official.stdin);
      expect(original.method).toBe("model/list");
      writeRequest(fixture.official.stdout, {
        id: requiredMessageId(original),
        result: { data: [{ model: "stale" }], nextCursor: null },
      });
      await fixture.collector.waitFor((message) => message.id === 7000);
      const ids = Array.from({ length: 26 }, (_, index) => `recovered-${index}`);
      expect(await refresh(7001, ids)).toMatchObject({
        result: { provider: "fixture", returned: 26, ids },
      });
      expect(await fixture.collector.waitFor((message) => message.id === 70011)).toMatchObject({
        result: { provider: "fixture", returned: 26, ids },
      });
      expect((await models(7002)).map((model) => model.model)).toEqual(ids);
      expect(await refresh(7003, ["wrong-provider"], "another-provider")).toMatchObject({
        error: { code: -32602 },
      });
      expect((await models(7004)).map((model) => model.model)).toEqual(ids);
      writeFileSync(
        path.join(home, "fixture.json"),
        JSON.stringify({ ids: ["duplicate", "duplicate"] }),
      );
      writeRequest(fixture.desktopInput, {
        id: 7005,
        method: "codexhost/buddy/catalog-sync",
        params: {},
      });
      expect(await fixture.collector.waitFor((message) => message.id === 7005)).toMatchObject({
        error: { code: -32602 },
      });
      expect((await models(7006)).map((model) => model.model)).toEqual(ids);
      expect(await refresh(7007, ["recovered-0"])).toMatchObject({ result: { returned: 1 } });
      expect((await models(7008)).map((model) => model.model)).toEqual(["recovered-0"]);
      expect(await refresh(7009, [])).toMatchObject({ result: { returned: 0, ids: [] } });
      expect(await models(7010)).toEqual([]);
      writeRequest(fixture.desktopInput, { id: 7011, method: "model/list", params: {} });
      const blocked = await readJsonLine(fixture.official.stdin);
      writeRequest(fixture.official.stdout, {
        id: requiredMessageId(blocked),
        error: { code: -32099, message: "Provider restricted" },
      });
      expect(await fixture.collector.waitFor((message) => message.id === 7011)).toMatchObject({
        error: { code: -32099, message: "Provider restricted" },
      });
      for (const [id, keyPath] of [
        [7012, "model"],
        [7014, "model_provider"],
      ] as const) {
        writeRequest(fixture.desktopInput, {
          id,
          method: "config/value/write",
          params: { keyPath, value: "fixture", mergeStrategy: "replace" },
        });
        const update = await readJsonLine(fixture.official.stdin);
        expect(update.method).toBe("config/value/write");
        writeRequest(fixture.official.stdout, { id: requiredMessageId(update), result: {} });
        await fixture.collector.waitFor((message) => message.id === id);
        expect(await models(id + 1)).toEqual(keyPath === "model" ? [] : [{ model: "stale" }]);
      }
      expect(fixture.spawnOfficial).toHaveBeenCalledTimes(1);
      expect(fixture.adapter.sessions).toHaveLength(0);
    } finally {
      await stopFixture(fixture);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects a refresh in private mode before invoking the synchronizer", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "buddy-catalog-private-"));
    writeFileSync(path.join(home, "buddy-router.json"), JSON.stringify({ privateMode: true }));
    const fixture = createFixture({ buddyRouting: true, environment: { CODEX_HOME: home } });
    await fixture.ready;
    try {
      writeRequest(fixture.desktopInput, {
        id: 7001,
        method: "codexhost/buddy/catalog-sync",
        params: {},
      });
      const reply = await fixture.collector.waitFor((message) => message.id === 7001);
      expect(reply).toMatchObject({ error: { code: -32602 } });
      expect(JSON.stringify(reply)).toContain("隐私模式");
    } finally {
      await stopFixture(fixture);
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("Buddy privacy send boundary", () => {
  async function startModelCatalog(ids: string[]) {
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/models") {
        res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("fixture address missing");
    }
    return {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  it("keeps startup metadata available while privacy mode stays enabled", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "buddy-private-startup-"));
    writeFileSync(path.join(home, "buddy-router.json"), JSON.stringify({ privateMode: true }));
    const fixture = createFixture({ buddyRouting: true, environment: { CODEX_HOME: home } });
    await fixture.ready;
    try {
      for (const [index, method] of [
        "configRequirements/read",
        "experimentalFeature/list",
        "skills/list",
        "permissionProfile/list",
      ].entries()) {
        const request = readJsonLine(fixture.official.stdin);
        writeRequest(fixture.desktopInput, { id: 650 + index, method, params: {} });
        const forwarded = await request;
        expect(forwarded.method).toBe(method);
        fixture.official.stdout.write(
          JSON.stringify({ id: requiredMessageId(forwarded), result: { available: true } }) + "\n",
        );
        await expect(
          fixture.collector.waitFor((message) => message.id === 650 + index),
        ).resolves.toMatchObject({ result: { available: true } });
      }
      writeRequest(fixture.desktopInput, {
        id: 660,
        method: "turn/start",
        params: { threadId: "synthetic", input: [{ type: "text", text: "SYNTHETIC_PRIVATE" }] },
      });
      const modelList = await readJsonLine(fixture.official.stdin);
      fixture.official.stdout.write(
        `${JSON.stringify({ id: modelList.id, error: { code: -1, message: "catalog unavailable" } })}\n`,
      );
      await expect(
        fixture.collector.waitFor((message) => message.id === 660),
      ).resolves.toMatchObject({ error: { code: -32090 } });
    } finally {
      await stopFixture(fixture);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("blocks private input when no deployed q3 model is available", async () => {
    const catalog = await startModelCatalog(["gpt-6", "q3-4b-online"]);
    const home = mkdtempSync(path.join(tmpdir(), "buddy-private-host-"));
    writeFileSync(
      path.join(home, "config.toml"),
      `model_provider = "gateway"\n[model_providers.gateway]\nbase_url = ${JSON.stringify(catalog.baseUrl)}\nexperimental_bearer_token = "fixture-token"\n`,
    );
    writeFileSync(path.join(home, "buddy-router.json"), JSON.stringify({ privateMode: true }));
    const fixture = createFixture({ buddyRouting: true, environment: { CODEX_HOME: home } });
    const native = new JsonLineCollector(fixture.official.stdin);
    await fixture.ready;
    try {
      fixture.desktopInput.write(
        JSON.stringify({
          id: 700,
          method: "turn/start",
          params: {
            threadId: "synthetic-thread",
            input: [{ type: "text", text: "SYNTHETIC_PRIVATE_CANARY" }],
          },
        }) + "\n",
      );
      const threadRead = await native.waitFor((message) => message.method === "thread/read");
      fixture.official.stdout.write(
        `${JSON.stringify({
          id: threadRead.id,
          result: {
            thread: {
              id: "synthetic-thread",
              modelProvider: "gateway",
              cwd: "/synthetic",
              ephemeral: false,
            },
          },
        })}\n`,
      );
      const modelList = await native.waitFor((message) => message.method === "model/list");
      fixture.official.stdout.write(
        `${JSON.stringify({ id: modelList.id, result: { data: [{ model: "gpt-6" }, { model: "q3-4b-online" }] } })}\n`,
      );
      await expect(
        fixture.collector.waitFor((message) => message.id === 700),
      ).resolves.toMatchObject({ id: 700, error: { code: -32090 } });
      expect(JSON.stringify(native.messages)).not.toContain("SYNTHETIC_PRIVATE_CANARY");
      expect(fixture.adapter.sessions).toHaveLength(0);
      expect(fixture.diagnosticOutput.read()?.toString() ?? "").not.toContain(
        "SYNTHETIC_PRIVATE_CANARY",
      );
    } finally {
      await stopFixture(fixture);
      await catalog.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it.each([null, "gpt-6", "q3-4b"])(
    "automatically forwards private input with preference %s without leaking the internal marker",
    async (executorModel) => {
      const catalog = await startModelCatalog(["gpt-6", "q3-4b", "q3-14b"]);
      const home = mkdtempSync(path.join(tmpdir(), "buddy-private-native-"));
      writeFileSync(
        path.join(home, "config.toml"),
        `model_provider = "gateway"\n[model_providers.gateway]\nbase_url = ${JSON.stringify(catalog.baseUrl)}\nexperimental_bearer_token = "fixture-token"\n`,
      );
      writeFileSync(
        path.join(home, "buddy-router.json"),
        JSON.stringify({ privateMode: true, executorModel }),
      );
      const fixture = createFixture({ buddyRouting: true, environment: { CODEX_HOME: home } });
      await fixture.ready;
      try {
        fixture.desktopInput.write(
          JSON.stringify({
            id: 710,
            method: "turn/start",
            params: {
              threadId: "official-thread",
              cwd: "/synthetic",
              input: [{ type: "text", text: "SYNTHETIC_PRIVATE_NATIVE" }],
              collaborationMode: { mode: "default", settings: {} },
            },
          }) + "\n",
        );
        const threadRead = await readJsonLine(fixture.official.stdin);
        expect(threadRead).toMatchObject({ method: "thread/read" });
        fixture.official.stdout.write(
          `${JSON.stringify({
            id: threadRead.id,
            result: {
              thread: {
                id: "official-thread",
                modelProvider: "gateway",
                cwd: "/synthetic",
                ephemeral: false,
              },
            },
          })}\n`,
        );
        const modelList = await readJsonLine(fixture.official.stdin);
        expect(modelList).toMatchObject({ method: "model/list" });
        fixture.official.stdout.write(
          `${JSON.stringify({
            id: modelList.id,
            result: { data: [{ model: "gpt-6" }, { model: "q3-4b" }, { model: "q3-14b" }] },
          })}\n`,
        );
        const turnStart = await readJsonLine(fixture.official.stdin);
        expect(turnStart).toMatchObject({
          id: 710,
          method: "turn/start",
          params: {
            threadId: "official-thread",
            model: executorModel === "q3-4b" ? "q3-4b" : "q3-14b",
            effort: null,
          },
        });
        expect(JSON.stringify(turnStart)).not.toContain("codexhostBuddyPrivateTurn");
        fixture.official.stdout.write(
          `${JSON.stringify({ id: 710, result: { turn: { id: "private-turn" } } })}\n`,
        );
        await expect(
          fixture.collector.waitFor((message) => message.id === 710),
        ).resolves.toMatchObject({ result: { turn: { id: "private-turn" } } });
      } finally {
        await stopFixture(fixture);
        await catalog.close();
        rmSync(home, { recursive: true, force: true });
      }
    },
  );

  it("blocks non-turn task entry points before any private text is forwarded", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "buddy-private-host-"));
    writeFileSync(path.join(home, "buddy-router.json"), JSON.stringify({ privateMode: true }));
    const fixture = createFixture({ buddyRouting: true, environment: { CODEX_HOME: home } });
    const native = new JsonLineCollector(fixture.official.stdin);
    await fixture.ready;
    try {
      const methods = [
        "turn/steer",
        "thread/start",
        "thread/resume",
        "thread/fork",
        "review/start",
        "thread/compact/start",
        "thread/name/set",
        "codexhost/thread/command/execute",
        "codexhost/thread/fork",
      ];
      for (const [index, method] of methods.entries()) {
        const id = 720 + index;
        fixture.desktopInput.write(
          JSON.stringify({
            id,
            method,
            params: {
              threadId: "synthetic-thread",
              input: [{ type: "text", text: "SYNTHETIC_PRIVATE_CANARY" }],
            },
          }) + "\n",
        );
        await expect(
          fixture.collector.waitFor((message) => message.id === id),
        ).resolves.toMatchObject({ id, error: { code: -32091 } });
      }
      expect(JSON.stringify(native.messages)).not.toContain("SYNTHETIC_PRIVATE_CANARY");
      expect(fixture.adapter.sessions).toHaveLength(0);
      expect(fixture.diagnosticOutput.read()?.toString() ?? "").not.toContain(
        "SYNTHETIC_PRIVATE_CANARY",
      );
    } finally {
      await stopFixture(fixture);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("intercepts an explicit private marker even when ordinary routing is disabled", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "buddy-private-host-"));
    writeFileSync(
      path.join(home, "buddy-router.json"),
      JSON.stringify({ enabled: false, privateMode: false }),
    );
    const fixture = createFixture({ buddyRouting: true, environment: { CODEX_HOME: home } });
    const native = new JsonLineCollector(fixture.official.stdin);
    await fixture.ready;
    try {
      fixture.desktopInput.write(
        JSON.stringify({
          id: 800,
          method: "turn/start",
          params: {
            threadId: "synthetic-thread",
            input: [{ type: "text", text: "【隐私】SYNTHETIC_PRIVATE_CANARY" }],
          },
        }) + "\n",
      );
      await expect(
        fixture.collector.waitFor((message) => message.id === 800),
      ).resolves.toMatchObject({ error: { code: -32091 } });
      expect(JSON.stringify(native.messages)).not.toContain("SYNTHETIC_PRIVATE_CANARY");
    } finally {
      await stopFixture(fixture);
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("AppServerHost linked Git repositories", () => {
  it("edits, commits and pushes the linked frontend while preserving the backend", async () => {
    const directory = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "codexhost-linked-rpc-")),
    );
    const backend = path.join(directory, "backend");
    const frontend = path.join(directory, "frontend");
    const remote = path.join(directory, "remote.git");
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    for (const repository of [backend, frontend]) {
      execFileSync("git", ["init", "-q", "-b", "main", repository]);
      git(repository, "config", "user.name", "Test");
      git(repository, "config", "user.email", "test@example.com");
      git(repository, "config", "commit.gpgsign", "false");
      mkdirSync(path.join(repository, "src"));
      writeFileSync(path.join(repository, "app.txt"), "original\n");
      git(repository, "add", "app.txt");
      git(repository, "commit", "-qm", "init");
      writeFileSync(path.join(repository, "app.txt"), `${path.basename(repository)} draft\n`);
    }
    execFileSync("git", ["init", "-q", "--bare", remote]);
    git(frontend, "remote", "add", "origin", remote);
    git(frontend, "push", "-qu", "origin", "main");
    const backendHead = git(backend, "rev-parse", "HEAD");
    const fixture = createFixture({ environment: { CODEX_HOME: path.join(directory, "home") } });
    try {
      const threadId = await startExternalThread(fixture, "codexhost/pi-native", 1, {
        cwd: path.join(backend, "src"),
      });
      let id = 100;
      const rpc = async (method: string, params: JsonObject = {}) => {
        const request = ++id;
        writeRequest(fixture.desktopInput, {
          id: request,
          method,
          params: { threadId, ...params },
        });
        return fixture.collector.waitFor((message) => requestId(message, request));
      };
      const ok = async (method: string, params: JsonObject = {}) => {
        const response = await rpc(method, params);
        expect(response).not.toHaveProperty("error");
        return response.result as JsonObject;
      };
      expect(await ok("codexhost/git/repositories")).toMatchObject({
        project: backend,
        repositories: [{ path: backend, primary: true }],
      });
      expect(await rpc("codexhost/git/status", { repository: frontend })).toHaveProperty("error");
      expect(
        await rpc("codexhost/workspace/files/write", {
          repository: frontend,
          path: "app.txt",
          content: "unauthorized",
          expectedRevision: "a".repeat(64),
        }),
      ).toHaveProperty("error");
      await ok("codexhost/git/repository/link", { repository: path.join(frontend, "src") });
      expect(await ok("codexhost/git/status", { repository: frontend })).toMatchObject({
        workspace: frontend,
      });
      const content = await ok("codexhost/git/content", { repository: frontend, path: "app.txt" });
      expect(content.working).toBe("frontend draft\n");
      if (typeof content.revision !== "string") throw new Error("Missing content revision");
      await ok("codexhost/workspace/files/write", {
        repository: frontend,
        path: "app.txt",
        content: "frontend saved\n",
        expectedRevision: content.revision,
      });
      await ok("codexhost/git/stage", { repository: frontend, paths: ["app.txt"] });
      await ok("codexhost/git/unstage", { repository: frontend, paths: ["app.txt"] });
      expect(git(frontend, "diff", "--cached", "--name-only")).toBe("");
      await ok("codexhost/git/stage", { repository: frontend, paths: ["app.txt"] });
      expect(
        await ok("codexhost/git/commit", {
          repository: frontend,
          message: "feat: frontend only",
          paths: [],
          push: true,
        }),
      ).toMatchObject({ pushed: true, status: { workspace: frontend, changes: [], ahead: 0 } });
      await ok("codexhost/git/push", { repository: frontend });
      expect(git(remote, "rev-parse", "main")).toBe(git(frontend, "rev-parse", "HEAD"));
      expect(git(remote, "show", "main:app.txt")).toBe("frontend saved");
      expect(git(backend, "rev-parse", "HEAD")).toBe(backendHead);
      expect(git(backend, "diff", "--cached", "--name-only")).toBe("");
      expect(readFileSync(path.join(backend, "app.txt"), "utf8")).toBe("backend draft\n");
      expect(await ok("codexhost/git/status")).toMatchObject({ workspace: backend });
      // 自动工作流不接受手动面板选择的关联仓库。
      expect(await rpc("codexhost/git/workflow/run", { repository: frontend })).toHaveProperty(
        "error",
      );
      await ok("codexhost/git/repository/unlink", { repository: frontend });
      expect(await rpc("codexhost/git/push", { repository: frontend })).toHaveProperty("error");
      expect(readFileSync(path.join(frontend, "app.txt"), "utf8")).toBe("frontend saved\n");
    } finally {
      await stopFixture(fixture);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("AppServerHost project Git workflow", () => {
  it("resolves the repository root from a task cwd inside the worktree", async () => {
    const directory = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "codexhost-project-workflow-subdir-")),
    );
    execFileSync("git", ["init", "-q", directory]);
    const subdirectory = path.join(directory, "packages", "host-runtime");
    mkdirSync(subdirectory, { recursive: true });
    writeFileSync(path.join(directory, "work.txt"), "pending change\n");
    const fixture = createFixture({ environment: { CODEXHOST_GIT_AUTO_PUSH: "1" } });
    try {
      const threadId = await startExternalThread(fixture, "codexhost/pi-native", 1, {
        cwd: subdirectory,
      });
      writeRequest(fixture.desktopInput, {
        id: 2,
        method: "codexhost/git/workflow/status",
        params: { threadId },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 2)),
      ).resolves.toMatchObject({ result: { workspace: directory, phase: "idle" } });
    } finally {
      await stopFixture(fixture);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(["native", "external"])(
    "waits for project tasks and shares automatic/manual execution through %s",
    async (executor) => {
      const directory = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), "codexhost-project-workflow-")),
      );
      execFileSync("git", ["init", "-q", directory]);
      writeFileSync(path.join(directory, "work.txt"), "pending change\n");
      const fixture = createFixture({ environment: { CODEXHOST_GIT_AUTO_PUSH: "1" } });
      let nativeActive = true;
      const nativeRequests: JsonObject[] = [];
      const answer = (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
          const request = JSON.parse(line) as JsonObject;
          nativeRequests.push(request);
          if (request.method === "thread/list") {
            writeRequest(fixture.official.stdout, {
              id: requiredMessageId(request),
              result: {
                data: [
                  {
                    id: "native-peer",
                    cwd: directory,
                    status: { type: nativeActive ? "active" : "idle" },
                  },
                ],
                nextCursor: null,
              },
            });
          } else if (request.method === "thread/read") {
            writeRequest(fixture.official.stdout, {
              id: requiredMessageId(request),
              result: {
                thread: {
                  id: (request.params as JsonObject).threadId ?? "native-peer",
                  cwd: directory,
                  status: { type: nativeActive ? "active" : "idle" },
                  turns: [],
                },
              },
            });
          } else if (request.method === "turn/start") {
            writeRequest(fixture.official.stdout, {
              id: requiredMessageId(request),
              result: { turn: { id: "native-workflow" } },
            });
            writeRequest(fixture.official.stdout, {
              method: "turn/started",
              params: { threadId: "native-peer", turn: { id: "native-workflow" } },
            });
          }
        }
      };
      fixture.official.stdin.on("data", answer);
      try {
        const threadId = await startExternalThread(fixture, "codexhost/pi-native", 1, {
          cwd: directory,
        });
        const session = fixture.adapter.sessions[0];
        if (!session) throw new Error("外部 Harness 会话未创建");
        const execute = vi.spyOn(session, "execute");
        await completePiTurn(fixture, threadId, 2);
        await vi.waitFor(
          () => expect(nativeRequests.some((entry) => entry.method === "thread/list")).toBe(true),
          { timeout: 3000 },
        );
        expect(execute.mock.calls).toMatchObject([[{ type: "turn.start" }]]);
        nativeActive = false;
        if (executor === "native") {
          writeRequest(fixture.official.stdout, {
            method: "turn/completed",
            params: {
              threadId: "native-peer",
              turn: { id: "native-finished", status: "completed" },
            },
          });
        } else {
          await completePiTurn(fixture, threadId, 3);
        }
        const starts = () =>
          executor === "native"
            ? nativeRequests.filter((entry) => entry.method === "turn/start").length
            : execute.mock.calls.length - 2;
        await vi.waitFor(() => expect(starts()).toBe(1), { timeout: 3000 });
        writeRequest(fixture.desktopInput, {
          id: 10,
          method: "codexhost/git/workflow/run",
          params: { threadId },
        });
        expect(await fixture.collector.waitFor((message) => requestId(message, 10))).toMatchObject({
          result: { phase: "running", threadId: executor === "native" ? "native-peer" : threadId },
        });
        expect(starts()).toBe(1);
        if (executor === "native") {
          writeRequest(fixture.official.stdout, {
            method: "turn/completed",
            params: {
              threadId: "native-peer",
              turn: { id: "native-workflow", status: "completed" },
            },
          });
        } else {
          session.succeedTurn();
        }
        let queryId = 10;
        await vi.waitFor(
          async () => {
            queryId++;
            writeRequest(fixture.desktopInput, {
              id: queryId,
              method: "codexhost/git/workflow/status",
              params: { threadId },
            });
            const response = await fixture.collector.waitFor((message) =>
              requestId(message, queryId),
            );
            expect(response).toMatchObject({ result: { phase: "failed" } });
          },
          { timeout: 10_000 },
        );
        expect(starts()).toBe(1);
      } finally {
        await stopFixture(fixture);
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
