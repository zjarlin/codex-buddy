import { describe, expect, it, vi } from "vitest";
import { refreshNativeModels } from "../src/renderer-native-model-refresh.js";

function fixture(location: "provider" | "scope" | "context" = "provider") {
  const findAll = vi.fn(() => [{}]);
  const refetchQueries = vi.fn(async () => {});
  const client = { getQueryCache: () => ({ findAll }), refetchQueries };
  const fiber =
    location === "context"
      ? { dependencies: { firstContext: { memoizedValue: client } } }
      : { memoizedProps: location === "scope" ? { value: { queryClient: client } } : { client } };
  const trigger = { __reactFiber$fixture: fiber } as unknown as HTMLElement;
  return { trigger, findAll, refetchQueries };
}

describe("native model refresh", () => {
  it.each(["provider", "scope", "context"] as const)(
    "refetches only the current host through %s",
    async (location) => {
      const { trigger, findAll, refetchQueries } = fixture(location);
      await refreshNativeModels(trigger, "remote-host");
      const filters = { queryKey: ["models", "list", "remote-host"], type: "active" };
      expect(findAll).toHaveBeenCalledWith(filters);
      expect(refetchQueries).toHaveBeenCalledExactlyOnceWith(filters, {
        throwOnError: true,
        cancelRefetch: false,
      });
    },
  );

  it("reports missing native bindings instead of pretending the list refreshed", async () => {
    const { trigger, findAll, refetchQueries } = fixture();
    findAll.mockReturnValue([]);
    await expect(refreshNativeModels(trigger, "local")).rejects.toThrow("unavailable");
    await expect(refreshNativeModels(null, "local")).rejects.toThrow("unavailable");
    expect(refetchQueries).not.toHaveBeenCalled();
  });

  it("propagates the native refresh failure for retry", async () => {
    const { trigger, refetchQueries } = fixture();
    refetchQueries.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(refreshNativeModels(trigger, "local")).rejects.toThrow("Provider unavailable");
    await refreshNativeModels(trigger, "local");
    expect(refetchQueries).toHaveBeenCalledTimes(2);
  });
});
