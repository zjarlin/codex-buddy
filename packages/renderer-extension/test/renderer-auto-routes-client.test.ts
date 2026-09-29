import { describe, expect, it, vi } from "vitest";
import { createRendererModelClient } from "../src/renderer-model-client.js";

const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";

describe("Auto route availability", () => {
  it.each([-32601, -32600])("reports an unsupported Host for native error %s", async (code) => {
    const sendRequest = vi.fn(async () => {
      throw { code, message: "Invalid request: unknown variant `codexhost/auto/routes`" };
    });
    const client = createRendererModelClient([{ sendRequest }]);
    expect(client).not.toBeNull();
    expect(await client?.readAutoModelRoutes?.(threadId)).toEqual({
      supported: false,
      routes: [],
      unavailableReason: "host",
    });
    await client?.readAutoModelRoutes?.(threadId);
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("preserves privacy and Provider reasons, and still accepts older Hosts", async () => {
    for (const unavailableReason of ["private", "provider", undefined]) {
      const result = {
        supported: false,
        routes: [],
        ...(unavailableReason ? { unavailableReason } : {}),
      };
      const client = createRendererModelClient([{ sendRequest: async () => result }]);
      expect(client).not.toBeNull();
      expect(await client?.readAutoModelRoutes?.(threadId)).toEqual(result);
    }
  });

  it("keeps transient failures retryable", async () => {
    const sendRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ supported: true, routes: [] });
    const client = createRendererModelClient([{ sendRequest }]);
    expect(client).not.toBeNull();
    await expect(client?.readAutoModelRoutes?.(threadId)).rejects.toThrow("offline");
    expect(await client?.readAutoModelRoutes?.(threadId)).toEqual({ supported: true, routes: [] });
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });
});
