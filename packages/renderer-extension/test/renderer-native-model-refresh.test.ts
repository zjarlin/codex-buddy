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

  it("reports the upstream count and the overlap with the native menu", async () => {
    const ids = Array.from({ length: 26 }, (_, index) => `model-${index}`);
    const { options, props, refetchQueries } = catalogFixture(["model-0"], ids);
    // 原生菜单当前已载入 model-0，供应商返回 26 个模型，交集为 1。
    const outcome = await refreshNativeModelCatalog(options);
    expect(refetchQueries).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ returned: 26, synchronized: 1 });
    expect(props.model).toBe("kept");
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

  it.each([{ after: ["kept"] }, { after: ["kept", "removed", "new"] }])(
    "counts synchronized models against the current native list: %j",
    async ({ after }) => {
      const { options } = catalogFixture(undefined, after);
      const outcome = await refreshNativeModelCatalog(options);
      // 原生菜单保持 before=["kept","removed"]；与上游列表求交集。
      const overlap = after.filter((id) => ["kept", "removed"].includes(id)).length;
      expect(outcome).toEqual({ returned: after.length, synchronized: overlap });
    },
  );

  it("asks for a restart when upstream returns an empty list", async () => {
    const { options } = catalogFixture(undefined, []);
    await expect(refreshNativeModelCatalog(options)).rejects.toThrow(
      "供应商返回 0 个模型，但客户端目录尚未包含任何匹配项；如需运行时切换，请重启客户端以加载最新 catalog.json。",
    );
  });

  it("reports the overlap without waiting for React when lists partially match", async () => {
    const { options, props } = catalogFixture(["kept"], ["kept", "added"]);
    const outcome = await refreshNativeModelCatalog(options);
    expect(outcome).toEqual({ returned: 2, synchronized: 1 });
    expect(props.modelOptions).toHaveLength(1);
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

  it("asks for a restart when the native catalog shares no model with upstream", async () => {
    const { options } = catalogFixture(["kept"], ["added", "other"]);
    await expect(refreshNativeModelCatalog(options)).rejects.toThrow(
      "供应商返回 2 个模型，但客户端目录尚未包含任何匹配项；如需运行时切换，请重启客户端以加载最新 catalog.json。",
    );
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

  it.each(["status", "sync", "refetch"] as const)(
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
