import type { JsonObject } from "@codexhost/protocol-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostAutoUpdateParticipant } from "../src/host-auto-update.js";
import {
  createFixture,
  startPiThread,
  startPiTurn,
  stopFixture,
  turnEvent,
  writeRequest,
} from "./app-server-host-fixture.js";

type Fixture = ReturnType<typeof createFixture>;
type Probe = () => Promise<boolean | null>;

function autoUpdateParticipant(): {
  participant: HostAutoUpdateParticipant;
  probes: Probe[];
  registrations: ({ nativeAuthority?: boolean } | undefined)[];
  unregister: ReturnType<typeof vi.fn>;
  activityChanged: ReturnType<typeof vi.fn>;
  statusObserved: ReturnType<typeof vi.fn>;
} {
  const probes: Probe[] = [];
  const registrations: ({ nativeAuthority?: boolean } | undefined)[] = [];
  const unregister = vi.fn();
  const activityChanged = vi.fn();
  const statusObserved = vi.fn();
  return {
    probes,
    registrations,
    unregister,
    activityChanged,
    statusObserved,
    participant: {
      register(probe, registration) {
        probes.push(probe);
        registrations.push(registration);
        return unregister;
      },
      activityChanged,
      statusObserved,
    },
  };
}

/** Answers the Host's own `thread/list` probes; every other request gets `{}`. */
function answerOfficialLists(fixture: Fixture, answer: (params: JsonObject) => JsonObject): void {
  let buffer = "";
  fixture.official.stdin.setEncoding("utf8");
  fixture.official.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline)) as JsonObject;
      buffer = buffer.slice(newline + 1);
      if (request.id === undefined) continue;
      const params = (request.params ?? {}) as JsonObject;
      fixture.official.stdout.write(
        `${JSON.stringify({
          id: request.id,
          result: request.method === "thread/list" ? answer(params) : {},
        })}\n`,
      );
    }
  });
}

/** Answers every `thread/list` with an explicit null error, as some clients do on success. */
function answerOfficialNullError(fixture: Fixture, result: JsonObject): void {
  let buffer = "";
  fixture.official.stdin.setEncoding("utf8");
  fixture.official.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline)) as JsonObject;
      buffer = buffer.slice(newline + 1);
      if (request.id === undefined) continue;
      fixture.official.stdout.write(
        `${JSON.stringify(
          request.method === "thread/list"
            ? { id: request.id, result, error: null }
            : { id: request.id, result: {} },
        )}\n`,
      );
    }
  });
}

function answerOfficialThreadListError(fixture: Fixture): void {
  let buffer = "";
  fixture.official.stdin.setEncoding("utf8");
  fixture.official.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline)) as JsonObject;
      buffer = buffer.slice(newline + 1);
      if (request.id === undefined) continue;
      fixture.official.stdout.write(
        `${JSON.stringify(
          request.method === "thread/list"
            ? { id: request.id, error: { code: -32000, message: "synthetic" } }
            : { id: request.id, result: {} },
        )}\n`,
      );
    }
  });
}

function probeOf(probes: Probe[]): Probe {
  const probe = probes.at(-1);
  if (!probe) throw new Error("Host did not register an idle probe");
  return probe;
}

afterEach(() => vi.useRealTimers());

describe("AppServerHost idle probing for automatic update", () => {
  it("hands a Renderer-observed ready status to the idle policy", async () => {
    const autoUpdate = autoUpdateParticipant();
    const ready = {
      version: "1.2.3",
      installation: "macos-dmg" as const,
      phase: "ready-to-restart" as const,
      updatedAt: 1,
      error: null,
    };
    const fixture = createFixture({
      autoUpdate: autoUpdate.participant,
      updateCoordinator: {
        check: async () => ({
          currentVersion: "1.2.2",
          installation: "macos-dmg",
          latestVersion: "1.2.3",
          updateAvailable: true,
          installationAvailable: true,
          releaseNotes: null,
          releaseNotesUrl: null,
          status: ready,
          error: null,
        }),
        start: async () => ({ status: ready }),
        restart: async () => ({ status: ready }),
        status: async () => ({ status: ready }),
      },
    });
    answerOfficialLists(fixture, () => ({ data: [], nextCursor: null }));
    try {
      await fixture.ready;
      writeRequest(fixture.desktopInput, {
        id: 41,
        method: "codexhost/update/status",
        params: {},
      });
      await fixture.collector.waitFor((message) => message.id === 41);
      expect(autoUpdate.statusObserved).toHaveBeenCalledWith(ready);
    } finally {
      await stopFixture(fixture);
    }
  });

  it("registers a native authority probe and unregisters it on close", async () => {
    const autoUpdate = autoUpdateParticipant();
    const fixture = createFixture({ autoUpdate: autoUpdate.participant });
    await fixture.ready;
    expect(autoUpdate.probes).toHaveLength(1);
    expect(autoUpdate.registrations).toEqual([{ nativeAuthority: true }]);
    await stopFixture(fixture);
    expect(autoUpdate.unregister).toHaveBeenCalledOnce();
  });

  it("registers an external-only Host without native authority", async () => {
    const autoUpdate = autoUpdateParticipant();
    // An external-only Host never spawns native Codex, so it has no readiness.
    const fixture = createFixture({ autoUpdate: autoUpdate.participant, externalOnly: true });
    try {
      expect(autoUpdate.registrations).toEqual([{ nativeAuthority: false }]);
      // It never reads the native Thread list, so it can only prove its own work.
      expect(await probeOf(autoUpdate.probes)()).toBe(true);
    } finally {
      await stopFixture(fixture);
    }
  });

  it("reports a running external Turn as work and its completion as idle", async () => {
    const autoUpdate = autoUpdateParticipant();
    const fixture = createFixture({ autoUpdate: autoUpdate.participant });
    answerOfficialLists(fixture, () => ({ data: [], nextCursor: null }));
    try {
      await fixture.ready;
      const probe = probeOf(autoUpdate.probes);
      expect(await probe()).toBe(true);

      const threadId = await startPiThread(fixture);
      const turnId = await startPiTurn(fixture, threadId);
      expect(await probe()).toBe(false);
      expect(autoUpdate.activityChanged).toHaveBeenCalled();

      const session = fixture.adapter.sessions[0];
      if (!session) throw new Error("Fake Pi Session was not opened");
      session.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
      expect(await probe()).toBe(true);
    } finally {
      await stopFixture(fixture);
    }
  });

  it("finds an active native Thread on a later page", async () => {
    const autoUpdate = autoUpdateParticipant();
    const fixture = createFixture({ autoUpdate: autoUpdate.participant });
    answerOfficialLists(fixture, (params) =>
      params.cursor === undefined
        ? { data: [{ id: "native", status: { type: "idle" } }], nextCursor: "next" }
        : { data: [{ id: "native-active", status: { type: "active" } }], nextCursor: null },
    );
    try {
      await fixture.ready;
      expect(await probeOf(autoUpdate.probes)()).toBe(false);
    } finally {
      await stopFixture(fixture);
    }
  });

  it("returns null when the official Thread list fails", async () => {
    const autoUpdate = autoUpdateParticipant();
    const fixture = createFixture({ autoUpdate: autoUpdate.participant });
    answerOfficialThreadListError(fixture);
    try {
      await fixture.ready;
      expect(await probeOf(autoUpdate.probes)()).toBeNull();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("returns null for a malformed page", async () => {
    const autoUpdate = autoUpdateParticipant();
    const fixture = createFixture({ autoUpdate: autoUpdate.participant });
    answerOfficialLists(fixture, () => ({ rows: [] }));
    try {
      await fixture.ready;
      expect(await probeOf(autoUpdate.probes)()).toBeNull();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("accepts an explicit null error and a null cursor", async () => {
    const autoUpdate = autoUpdateParticipant();
    const fixture = createFixture({ autoUpdate: autoUpdate.participant });
    answerOfficialNullError(fixture, { data: [], nextCursor: null });
    try {
      await fixture.ready;
      expect(await probeOf(autoUpdate.probes)()).toBe(true);
    } finally {
      await stopFixture(fixture);
    }
  });

  it("returns null for a cursor that is neither a string nor null", async () => {
    const autoUpdate = autoUpdateParticipant();
    const fixture = createFixture({ autoUpdate: autoUpdate.participant });
    answerOfficialLists(fixture, () => ({ data: [], nextCursor: 7 }));
    try {
      await fixture.ready;
      expect(await probeOf(autoUpdate.probes)()).toBeNull();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("returns null when the pagination repeats its cursor", async () => {
    const autoUpdate = autoUpdateParticipant();
    const fixture = createFixture({ autoUpdate: autoUpdate.participant });
    answerOfficialLists(fixture, () => ({ data: [], nextCursor: "same" }));
    try {
      await fixture.ready;
      expect(await probeOf(autoUpdate.probes)()).toBeNull();
    } finally {
      await stopFixture(fixture);
    }
  });
});
