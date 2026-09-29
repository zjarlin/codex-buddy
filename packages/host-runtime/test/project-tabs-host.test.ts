import { describe, expect, it, vi } from "vitest";
import { PROJECT_TABS_GET_METHOD, PROJECT_TABS_SET_METHOD } from "@codexhost/shared-contracts";

import { createFixture, requestId, stopFixture, writeRequest } from "./app-server-host-fixture.js";

describe("Project tab Host persistence", () => {
  it("handles validated get and set requests without forwarding them", async () => {
    const fixture = createFixture();
    const officialWrite = vi.fn();
    fixture.official.stdin.on("data", officialWrite);
    const config = {
      version: 2,
      tabs: [{ id: "work", name: "Work", prefixes: ["remote_company"] }],
      assignments: {},
      selected: "work",
    };
    try {
      writeRequest(fixture.desktopInput, { id: 1, method: PROJECT_TABS_GET_METHOD, params: {} });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ result: { config: null } });

      writeRequest(fixture.desktopInput, {
        id: 2,
        method: PROJECT_TABS_SET_METHOD,
        params: config,
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 2)),
      ).resolves.toMatchObject({ result: { config } });

      writeRequest(fixture.desktopInput, { id: 3, method: PROJECT_TABS_GET_METHOD, params: {} });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 3)),
      ).resolves.toMatchObject({ result: { config } });
      expect(officialWrite).not.toHaveBeenCalled();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("rejects invalid configuration", async () => {
    const fixture = createFixture();
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: PROJECT_TABS_SET_METHOD,
        params: { version: 2, tabs: [], assignments: {}, selected: "missing" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ error: { code: -32100 } });
    } finally {
      await stopFixture(fixture);
    }
  });
});
