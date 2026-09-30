import { buddySnapshotSchema } from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  refreshNativeModelCatalog,
  refreshNativeModels,
} from "../src/renderer-native-model-refresh.js";
import { RendererMethodUnavailableError } from "../src/renderer-request-sender.js";

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

function catalogFixture(before = ["kept", "removed"], after = ["kept", "added"]) {
  const { trigger, refetchQueries } = fixture();
  const queryFiber = Reflect.get(trigger, "__reactFiber$fixture");
  const props = {
    model: "kept",
    modelOptions: before.map((id) => ({ model: { model: id, displayName: id } })),
    onSelectModel: vi.fn(),
  };
  Reflect.set(trigger, "__reactFiber$fixture", { memoizedProps: props, return: queryFiber });
  const snapshot = buddySnapshotSchema.parse({ settings: {}, models: [], decisions: [] });
  const sync = { provider: "fixture", returned: after.length, ids: after };
  const client = {
    buddyStatus: vi.fn(async () => snapshot),
    syncCodexCatalog: vi.fn(async () => sync),
  };
  const options = {
    client,
    hostId: "local",
    trigger: vi.fn(() => trigger),
    isCurrent: vi.fn(() => true),
  };
  return {
    options,
    snapshot,
    props,
    refetchQueries,
    commit() {
      props.modelOptions = after.map((id) => ({ model: { model: id, displayName: id } }));
    },
  };
}

describe("provider catalog refresh", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for a delayed React commit after refetch before reporting the full 26 models", async () => {
    vi.useFakeTimers();
    const ids = Array.from({ length: 26 }, (_, index) => `model-${index}`);
    const { options, props, refetchQueries, commit } = catalogFixture(["model-0"], ids);
    const completed = vi.fn();
    const pending = refreshNativeModelCatalog(options).then(completed);
    await vi.advanceTimersByTimeAsync(100);
    expect(refetchQueries).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    expect(props.onSelectModel).not.toHaveBeenCalled();
    commit();
    await vi.advanceTimersByTimeAsync(25);
    await pending;
    expect(completed).toHaveBeenCalledExactlyOnceWith({ returned: 26, synchronized: 26 });
    expect(props.model).toBe("kept");
  });

  it.each([{ after: ["kept"] }, { after: [] }])(
    "waits for removed models to disappear, including an empty list: %j",
    async ({ after }) => {
      vi.useFakeTimers();
      const { options, commit } = catalogFixture(undefined, after);
      const completed = vi.fn();
      const pending = refreshNativeModelCatalog(options).then(completed);
      await vi.advanceTimersByTimeAsync(75);
      expect(completed).not.toHaveBeenCalled();
      commit();
      await vi.advanceTimersByTimeAsync(25);
      await pending;
      expect(completed).toHaveBeenCalledExactlyOnceWith({
        returned: after.length,
        synchronized: after.length,
      });
    },
  );

  it("reports the actual loaded count with a bounded retry error if React never updates", async () => {
    vi.useFakeTimers();
    const { options, props } = catalogFixture(["kept"], ["kept", "added"]);
    const pending = refreshNativeModelCatalog(options);
    const failed = expect(pending).rejects.toThrow(
      "目录已同步但界面尚未更新，请重试刷新（供应商返回 2 个模型，界面已载入 1 个）。",
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await failed;
    expect(props.modelOptions).toHaveLength(1);
    expect(props.onSelectModel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the prior list and does not refetch when provider synchronization fails", async () => {
    const { options, refetchQueries, props } = catalogFixture();
    options.client.syncCodexCatalog.mockRejectedValueOnce(new Error("Provider sync unavailable"));
    await expect(refreshNativeModelCatalog(options)).rejects.toThrow("Provider sync unavailable");
    expect(refetchQueries).not.toHaveBeenCalled();
    expect(options.trigger).not.toHaveBeenCalled();
    expect(props.modelOptions.map(({ model }) => model.model)).toEqual(["kept", "removed"]);
  });

  it("rejects online synchronization in privacy mode", async () => {
    const { options, snapshot, refetchQueries } = catalogFixture();
    snapshot.settings.privateMode = true;
    await expect(refreshNativeModelCatalog(options)).rejects.toThrow("隐私模式");
    expect(options.client.syncCodexCatalog).not.toHaveBeenCalled();
    expect(refetchQueries).not.toHaveBeenCalled();
  });

  it("refreshes the native catalog when the Host has no Buddy Router", async () => {
    const { options, refetchQueries } = catalogFixture();
    options.client.buddyStatus.mockRejectedValueOnce(
      new RendererMethodUnavailableError("codexhost/buddy/status", null),
    );
    await expect(refreshNativeModelCatalog(options)).resolves.toBeUndefined();
    expect(refetchQueries).toHaveBeenCalledExactlyOnceWith(
      { queryKey: ["models", "list", "local"], type: "active" },
      { throwOnError: true, cancelRefetch: false },
    );
    expect(options.client.syncCodexCatalog).not.toHaveBeenCalled();
  });

  it("refreshes the native catalog when the connection exposes no Buddy status", async () => {
    const { options, refetchQueries } = catalogFixture();
    const client = {
      syncCodexCatalog: options.client.syncCodexCatalog,
    };
    await expect(refreshNativeModelCatalog({ ...options, client })).resolves.toBeUndefined();
    expect(refetchQueries).toHaveBeenCalledOnce();
    expect(client.syncCodexCatalog).not.toHaveBeenCalled();
  });

  it("propagates a real Buddy status failure instead of silently refreshing", async () => {
    const { options, refetchQueries } = catalogFixture();
    options.client.buddyStatus.mockRejectedValueOnce(new Error("connection reset"));
    await expect(refreshNativeModelCatalog(options)).rejects.toThrow("connection reset");
    expect(refetchQueries).not.toHaveBeenCalled();
  });

  it.each(["status", "sync", "refetch", "commit"] as const)(
    "stops reading the native control if the context changes during %s",
    async (stage) => {
      vi.useFakeTimers();
      const { options, snapshot, refetchQueries } = catalogFixture();
      const invalidate = () => options.isCurrent.mockReturnValue(false);
      if (stage === "status") {
        options.client.buddyStatus.mockImplementationOnce(async () => {
          invalidate();
          return snapshot;
        });
      } else if (stage === "sync") {
        options.client.syncCodexCatalog.mockImplementationOnce(async () => {
          invalidate();
          return { provider: "fixture", returned: 0, ids: [] };
        });
      } else if (stage === "refetch") {
        refetchQueries.mockImplementationOnce(async () => {
          invalidate();
        });
      }
      const pending = refreshNativeModelCatalog(options);
      await vi.advanceTimersByTimeAsync(0);
      const reads = options.trigger.mock.calls.length;
      invalidate();
      await vi.advanceTimersByTimeAsync(25);
      await expect(pending).resolves.toBeUndefined();
      expect(options.trigger).toHaveBeenCalledTimes(reads);
      if (stage === "status") expect(options.client.syncCodexCatalog).not.toHaveBeenCalled();
      if (stage === "status" || stage === "sync") expect(refetchQueries).not.toHaveBeenCalled();
      if (stage === "refetch") expect(reads).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("suppresses an old refetch rejection after a target change", async () => {
    const { options, refetchQueries } = catalogFixture();
    refetchQueries.mockImplementationOnce(async () => {
      options.isCurrent.mockReturnValue(false);
      throw new Error("Old host disconnected");
    });
    await expect(refreshNativeModelCatalog(options)).resolves.toBeUndefined();
    expect(options.trigger).toHaveBeenCalledOnce();
  });
});
