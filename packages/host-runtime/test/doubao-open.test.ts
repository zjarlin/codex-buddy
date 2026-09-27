import { afterEach, describe, expect, it, vi } from "vitest";
import { DOUBAO_OPEN_METHOD } from "@codexhost/shared-contracts";

import * as nativeOpener from "../src/launcher-url-opener.js";
import { createFixture, requestId, stopFixture, writeRequest } from "./app-server-host-fixture.js";

afterEach(() => vi.restoreAllMocks());

describe("Doubao Desktop handoff", () => {
  it("handles the local request without forwarding it to the official App Server", async () => {
    const open = vi.fn(async () => undefined);
    vi.spyOn(nativeOpener, "createLauncherDoubaoOpener").mockReturnValue(open);
    const fixture = createFixture();
    const officialWrite = vi.fn();
    fixture.official.stdin.on("data", officialWrite);
    try {
      writeRequest(fixture.desktopInput, { id: 1, method: DOUBAO_OPEN_METHOD, params: {} });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ result: { application: "doubao" } });
      expect(open).toHaveBeenCalledOnce();
      expect(officialWrite).not.toHaveBeenCalled();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("rejects injected parameters and returns native errors to the Renderer", async () => {
    const open = vi.fn(async () => {
      throw new Error("Doubao is unavailable");
    });
    vi.spyOn(nativeOpener, "createLauncherDoubaoOpener").mockReturnValue(open);
    const fixture = createFixture();
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: DOUBAO_OPEN_METHOD,
        params: { url: "https://example.com" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ error: { code: -32098 } });
      expect(open).not.toHaveBeenCalled();

      writeRequest(fixture.desktopInput, { id: 2, method: DOUBAO_OPEN_METHOD, params: {} });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 2)),
      ).resolves.toMatchObject({ error: { code: -32098, message: "Doubao is unavailable" } });
    } finally {
      await stopFixture(fixture);
    }
  });
});
