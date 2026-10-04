import { describe, expect, it, vi } from "vitest";
import { THREAD_FOLDERS_GET_METHOD, THREAD_FOLDERS_SET_METHOD } from "@codexhost/shared-contracts";

import { createFixture, requestId, stopFixture, writeRequest } from "./app-server-host-fixture.js";

describe("Thread folder Host persistence", () => {
  it("handles validated get and set requests without forwarding them", async () => {
    const fixture = createFixture();
    const officialWrite = vi.fn();
    fixture.official.stdin.on("data", officialWrite);
    const config = {
      version: 1,
      projects: {
        project: {
          folders: [{ id: "todo", name: "待办" }],
          assignments: {},
          selected: "todo",
        },
      },
    };
    try {
      writeRequest(fixture.desktopInput, { id: 1, method: THREAD_FOLDERS_GET_METHOD, params: {} });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ result: { config: null } });

      writeRequest(fixture.desktopInput, {
        id: 2,
        method: THREAD_FOLDERS_SET_METHOD,
        params: config,
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 2)),
      ).resolves.toMatchObject({ result: { config } });

      writeRequest(fixture.desktopInput, { id: 3, method: THREAD_FOLDERS_GET_METHOD, params: {} });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 3)),
      ).resolves.toMatchObject({ result: { config } });
      expect(officialWrite).not.toHaveBeenCalled();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("rejects invalid selected folders", async () => {
    const fixture = createFixture();
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: THREAD_FOLDERS_SET_METHOD,
        params: {
          version: 1,
          projects: { project: { folders: [], assignments: {}, selected: "missing" } },
        },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ error: { code: -32101 } });
    } finally {
      await stopFixture(fixture);
    }
  });
});
