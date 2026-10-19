import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  PROJECT_TOOLS_GET_METHOD,
  PROJECT_TOOLS_RUN_SCRIPT_METHOD,
  PROJECT_TOOLS_SET_METHOD,
} from "@codexhost/shared-contracts";

import { createFixture, requestId, stopFixture, writeRequest } from "./app-server-host-fixture.js";

describe("Project tool Host persistence", () => {
  it("handles validated get and set requests without forwarding them", async () => {
    const fixture = createFixture();
    const officialWrite = vi.fn();
    fixture.official.stdin.on("data", officialWrite);
    const config = {
      version: 1,
      bindings: [
        {
          target: { projectKind: "local", projectId: "project-one" },
          label: "Project One",
          intranetUrl: "http://192.168.31.252:48201/",
          prompt: "Inspect project health.",
        },
      ],
    };
    try {
      writeRequest(fixture.desktopInput, { id: 1, method: PROJECT_TOOLS_GET_METHOD, params: {} });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ result: { config: null } });

      writeRequest(fixture.desktopInput, {
        id: 2,
        method: PROJECT_TOOLS_SET_METHOD,
        params: config,
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 2)),
      ).resolves.toMatchObject({ result: { config } });

      writeRequest(fixture.desktopInput, { id: 3, method: PROJECT_TOOLS_GET_METHOD, params: {} });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 3)),
      ).resolves.toMatchObject({ result: { config } });
      expect(officialWrite).not.toHaveBeenCalled();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("rejects invalid or unsafe URLs", async () => {
    const fixture = createFixture();
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: PROJECT_TOOLS_SET_METHOD,
        params: {
          version: 1,
          bindings: [
            {
              target: { projectKind: "local", projectId: "project-one" },
              label: "Project One",
              intranetUrl: "javascript:alert(1)",
            },
          ],
        },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ error: { code: -32102 } });
    } finally {
      await stopFixture(fixture);
    }
  });

  it("runs only the script bound by the Host configuration", async () => {
    const fixture = createFixture();
    const scriptPath = path.join(fixture.mappingStoreDirectory, "start.sh");
    await writeFile(scriptPath, "#!/usr/bin/env bash\nprintf 'project started'\n", { mode: 0o700 });
    await chmod(scriptPath, 0o700);
    const config = {
      version: 1,
      bindings: [
        {
          target: { projectKind: "local", projectId: "project-one" },
          label: "Project One",
          scripts: { start: scriptPath },
        },
      ],
    };
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: PROJECT_TOOLS_SET_METHOD,
        params: config,
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ result: { config } });

      writeRequest(fixture.desktopInput, {
        id: 2,
        method: PROJECT_TOOLS_RUN_SCRIPT_METHOD,
        params: {
          target: { projectKind: "local", projectId: "project-one" },
          action: "start",
        },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 2)),
      ).resolves.toMatchObject({
        result: { action: "start", state: "completed", exitCode: 0 },
      });
    } finally {
      await stopFixture(fixture);
    }
  });
});
