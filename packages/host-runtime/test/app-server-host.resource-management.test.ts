import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonObject } from "@codexhost/protocol-core";
import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import {
  completePiTurn,
  createFixture,
  requestId,
  startExternalThread,
  startPiThread,
  stopFixture,
  writeRequest,
} from "./app-server-host-fixture.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
type Fixture = ReturnType<typeof createFixture>;

function answerOfficialLists(fixture: Fixture): void {
  let buffer = "";
  fixture.official.stdin.setEncoding("utf8");
  fixture.official.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline)) as JsonObject;
      buffer = buffer.slice(newline + 1);
      if (request.id === undefined) continue;
      writeRequest(fixture.official.stdout, {
        id: request.id,
        result: request.method === "thread/list" ? { data: [], nextCursor: null } : {},
      });
    }
  });
}

async function request(fixture: Fixture, id: number, method: string, params: JsonObject) {
  writeRequest(fixture.desktopInput, { id, method, params });
  const response = await fixture.collector.waitFor((message) => requestId(message, id));
  expect(response).not.toHaveProperty("error");
  return response;
}

async function oldThread(fixture: Fixture) {
  const threadId = await startPiThread(fixture);
  await completePiTurn(fixture, threadId, 2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  vi.setSystemTime(Date.now() + 60 * DAY);
  return hostThreadIdSchema.parse(threadId);
}

afterEach(() => vi.useRealTimers());

describe("resource management through Host requests", () => {
  it("releases a session despite repeated passive usage reads and does not reopen it for polling", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const fixture = createFixture();
    try {
      const threadId = await startPiThread(fixture);
      await completePiTurn(fixture, threadId, 2);
      const session = fixture.adapter.sessions[0];
      if (!session) throw new Error("Missing session");
      const close = vi.spyOn(session, "close");
      const open = vi.spyOn(fixture.adapter, "open");
      await request(fixture, 10, "codexhost/settings/idle-release/set", {
        enabled: true,
        timeoutMinutes: 5,
      });
      for (let index = 0; index < 6; index++) {
        await vi.advanceTimersByTimeAsync(MINUTE);
        await request(fixture, 20 + index, "codexhost/thread/usage/inspect", { threadId });
      }
      expect(close).toHaveBeenCalledOnce();
      expect(open).not.toHaveBeenCalled();
      expect(await request(fixture, 30, "codexhost/sessions/loaded/list", {})).toMatchObject({
        result: [],
      });
    } finally {
      await stopFixture(fixture);
    }
  });

  it("keeps a recently viewed old thread out of auto archive after idle release", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const fixture = createFixture();
    answerOfficialLists(fixture);
    try {
      const threadId = hostThreadIdSchema.parse(await startPiThread(fixture));
      await completePiTurn(fixture, threadId, 2);
      const untouchedId = await startExternalThread(fixture, "codexhost/pi-native", 3);
      await completePiTurn(fixture, untouchedId, 4, 1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      vi.setSystemTime(Date.now() + 60 * DAY);
      const before = await fixture.mappingStore.getThread(threadId);
      await request(fixture, 10, "thread/resume", { threadId });
      const after = await fixture.mappingStore.getThread(threadId);
      expect(Date.parse(after?.updatedAt ?? "")).toBeGreaterThan(
        Date.parse(before?.updatedAt ?? ""),
      );
      expect(after?.turnMappings).toEqual(before?.turnMappings);
      await request(fixture, 11, "codexhost/settings/idle-release/set", {
        enabled: true,
        timeoutMinutes: 5,
      });
      await vi.advanceTimersByTimeAsync(6 * MINUTE);
      expect(await request(fixture, 12, "codexhost/sessions/loaded/list", {})).toMatchObject({
        result: [],
      });

      await request(fixture, 13, "codexhost/settings/thread-auto-archive/set", {
        enabled: true,
        inactiveDays: 30,
      });
      await fixture.collector.waitFor(
        (message) =>
          message.method === "thread/archived" &&
          (message.params as JsonObject)?.threadId === untouchedId,
      );
      await request(fixture, 14, "codexhost/settings/thread-auto-archive/set", {
        enabled: false,
        inactiveDays: 30,
      });
      expect((await fixture.mappingStore.getThread(threadId))?.archived).toBe(false);
    } finally {
      await stopFixture(fixture);
    }
  });

  it("does not archive native background work and archives after it ends", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const fixture = createFixture();
    answerOfficialLists(fixture);
    try {
      const threadId = await oldThread(fixture);
      const session = fixture.adapter.sessions[0];
      if (!session) throw new Error("Missing session");
      const background = vi.fn(() => true);
      Object.defineProperty(session, "hasBackgroundWork", { value: background });
      const archived = vi.spyOn(fixture.mappingStore, "setArchived");
      await request(fixture, 10, "codexhost/settings/thread-auto-archive/set", {
        enabled: true,
        inactiveDays: 30,
      });
      await vi.waitFor(() => expect(background).toHaveBeenCalled());
      expect(archived).not.toHaveBeenCalled();
      background.mockReturnValue(false);
      await vi.advanceTimersByTimeAsync(60 * MINUTE);
      await fixture.collector.waitFor((message) => message.method === "thread/archived");
      expect((await fixture.mappingStore.getThread(threadId))?.archived).toBe(true);
    } finally {
      await stopFixture(fixture);
    }
  });

  it("holds new thread requests until an admitted archive has committed", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const fixture = createFixture();
    answerOfficialLists(fixture);
    const release = Promise.withResolvers<undefined>();
    try {
      const threadId = await oldThread(fixture);
      const entered = Promise.withResolvers<undefined>();
      const setArchived = fixture.mappingStore.setArchived.bind(fixture.mappingStore);
      vi.spyOn(fixture.mappingStore, "setArchived").mockImplementation(async (id, archived) => {
        entered.resolve(undefined);
        await release.promise;
        return setArchived(id, archived);
      });
      await request(fixture, 10, "codexhost/settings/thread-auto-archive/set", {
        enabled: true,
        inactiveDays: 30,
      });
      await entered.promise;
      writeRequest(fixture.desktopInput, {
        id: 11,
        method: "thread/read",
        params: { threadId, includeTurns: false },
      });
      await request(fixture, 12, "codexhost/sessions/loaded/list", {});
      expect(fixture.collector.messages.some((message) => message.id === 11)).toBe(false);
      release.resolve(undefined);
      const response = await fixture.collector.waitFor((message) => message.id === 11);
      expect(response).not.toHaveProperty("error");
      const archivedIndex = fixture.collector.messages.findIndex(
        (message) => message.method === "thread/archived",
      );
      expect(archivedIndex).toBeGreaterThanOrEqual(0);
      expect(fixture.collector.messages.indexOf(response)).toBeGreaterThan(archivedIndex);
    } finally {
      release.resolve(undefined);
      await stopFixture(fixture);
    }
  });
});
