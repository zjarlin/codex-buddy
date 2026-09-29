import { describe, expect, it } from "vitest";
import {
  JsonLineCollector,
  bindOfficialThread,
  createFixture,
  requestId,
  requiredMessageId,
  startPiThread,
  stopFixture,
  writeRequest,
} from "./app-server-host-fixture.js";

describe("remote thread open target", () => {
  it("resolves the owning native thread and exposes paths without credentials", async () => {
    const fixture = createFixture({ environment: { CODEX_HOME: "/remote/codex-home" } });
    const native = new JsonLineCollector(fixture.official.stdin);
    try {
      await bindOfficialThread(fixture, "target");
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: "codexhost/thread/open-target",
        params: { threadId: "target" },
      });
      const request = await native.waitFor((message) => message.method === "thread/read");
      expect(request.params).toEqual({ threadId: "target", includeTurns: false });
      fixture.official.stdout.write(
        `${JSON.stringify({
          id: requiredMessageId(request),
          result: { thread: { id: "target", cwd: "/remote/workspace" } },
        })}\n`,
      );
      expect(await fixture.collector.waitFor((message) => requestId(message, 1))).toEqual({
        id: 1,
        result: {
          workspace: "/remote/workspace",
          codexPath: "/synthetic/codex",
          codexHome: "/remote/codex-home",
        },
      });
    } finally {
      await stopFixture(fixture);
    }
  });

  it("does not treat an external Harness session as a native Codex session", async () => {
    const fixture = createFixture();
    try {
      const threadId = await startPiThread(fixture);
      writeRequest(fixture.desktopInput, {
        id: 2,
        method: "codexhost/thread/open-target",
        params: { threadId },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 2))).toMatchObject({
        error: { code: -32095 },
      });
      expect(fixture.official.stdin.read()).toBeNull();
    } finally {
      await stopFixture(fixture);
    }
  });
});
