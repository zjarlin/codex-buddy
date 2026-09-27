import {
  MODEL_AVAILABILITY_METHOD,
  type ModelAvailabilityParams,
  type ModelAvailabilitySnapshot,
} from "@codexhost/shared-contracts";
import { describe, expect, it, vi } from "vitest";

import { createRendererModelClient } from "../src/renderer-model-client.js";

const snapshot: ModelAvailabilitySnapshot = {
  provider: "configured-provider",
  checkedAt: "2026-09-27T00:00:00.000Z",
  results: [
    {
      id: "Qwen/Qwen3.6-Max-Preview",
      status: "available",
      checkedAt: "2026-09-27T00:00:00.000Z",
      latencyMs: 42,
    },
    {
      id: "provider/model:exact-version",
      status: "unavailable",
      checkedAt: "2026-09-27T00:00:00.000Z",
      latencyMs: 15_000,
      error: "探测超时（15 秒）。",
    },
  ],
};

describe("Renderer model availability client", () => {
  it("does not read or probe until explicitly requested", async () => {
    const sendRequest = vi.fn().mockResolvedValue(snapshot);
    const client = createRendererModelClient([{ sendRequest }]);

    expect(client?.modelAvailability).toBeTypeOf("function");
    await Promise.resolve();
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("reads the prior snapshot without turning the request into a probe", async () => {
    const sendRequest = vi.fn().mockResolvedValue(snapshot);
    const client = createRendererModelClient([{ sendRequest }]);

    await expect(client?.modelAvailability?.({ action: "read" })).resolves.toEqual(snapshot);
    expect(sendRequest).toHaveBeenCalledExactlyOnceWith(
      MODEL_AVAILABILITY_METHOD,
      { action: "read" },
      { priority: "interactive" },
    );
  });

  it("probes exact model IDs with interactive scheduling metadata outside the params", async () => {
    const sendRequest = vi.fn().mockResolvedValue(snapshot);
    const client = createRendererModelClient([{ sendRequest }]);
    const modelIds = snapshot.results.map(({ id }) => id);

    await expect(client?.modelAvailability?.({ action: "probe", modelIds })).resolves.toEqual(
      snapshot,
    );
    expect(sendRequest).toHaveBeenCalledExactlyOnceWith(
      MODEL_AVAILABILITY_METHOD,
      { action: "probe", modelIds },
      { priority: "interactive" },
    );
  });

  it.each([
    { action: "refresh" },
    { action: "probe", modelIds: [""] },
    { action: "probe", priority: "interactive" },
  ])("rejects invalid request params before dispatch: %j", async (input) => {
    const sendRequest = vi.fn().mockResolvedValue(snapshot);
    const client = createRendererModelClient([{ sendRequest }]);

    await expect(client?.modelAvailability?.(input as ModelAvailabilityParams)).rejects.toThrow();
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "configured-provider", checkedAt: null, results: [{ id: "model" }] },
    { ...snapshot, results: [{ ...snapshot.results[0], status: "healthy" }] },
    { ...snapshot, results: [{ ...snapshot.results[0], latencyMs: -1 }] },
  ])("rejects invalid availability snapshots: %j", async (response) => {
    const sendRequest = vi.fn().mockResolvedValue(response);
    const client = createRendererModelClient([{ sendRequest }]);

    await expect(client?.modelAvailability?.({ action: "read" })).rejects.toThrow();
    expect(sendRequest).toHaveBeenCalledOnce();
  });
});
