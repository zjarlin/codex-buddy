import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UPDATE_CHECK_NETWORK_TIMEOUT_MS,
  UPDATE_CHECK_REQUEST_TIMEOUT_MS,
  type UpdateCheckResult,
  type UpdateStatus,
} from "@codexhost/shared-contracts";
import { createRendererUpdateController } from "../../src/settings/update-controller.js";
import type { RendererUpdateClient } from "../../src/settings/pages.js";

const status = (phase: UpdateStatus["phase"]): UpdateStatus => ({
  version: "1.2.3",
  installation: "macos-dmg",
  phase,
  updatedAt: 1,
  error: null,
});
const check = (value: UpdateStatus | null = null): UpdateCheckResult => ({
  currentVersion: "1.2.2",
  latestVersion: "1.2.3",
  installation: "macos-dmg",
  updateAvailable: true,
  installationAvailable: true,
  releaseNotes: null,
  releaseNotesUrl: null,
  status: value,
  error: null,
});
const ownerWindow = () =>
  Object.assign(new EventTarget(), {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
  }) as unknown as Window;
function fixture(initial: UpdateStatus | null = null) {
  const client = {
    checkUpdate: vi.fn(async () => check(initial)),
    startUpdate: vi.fn(async () => ({ status: status("downloading") })),
    restartUpdate: vi.fn(async () => ({ status: status("prepared") })),
    readUpdateStatus: vi.fn(async () => ({ status: status("ready-to-restart") })),
  };
  const controller = createRendererUpdateController(() => client, ownerWindow());
  controller.refreshBinding();
  return { controller, client };
}
afterEach(() => {
  vi.useRealTimers();
});

describe("shared update controller", () => {
  it("discovers newer releases hourly without rebinding", async () => {
    vi.useFakeTimers();
    const { controller, client } = fixture();
    await controller.checkUpdate();
    client.checkUpdate.mockResolvedValue({ ...check(), latestVersion: "2.0.0" });
    await vi.advanceTimersByTimeAsync(3_599_999);
    expect(client.checkUpdate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.checkUpdate).toHaveBeenCalledTimes(2);
    expect(controller.snapshot.check?.latestVersion).toBe("2.0.0");
    controller.dispose();
  });

  it("throttles foreground and network recovery and deduplicates manual checks", async () => {
    vi.useFakeTimers();
    const window = ownerWindow();
    const pending = Promise.withResolvers<UpdateCheckResult>();
    const client = {
      checkUpdate: vi.fn(async () => check()),
      startUpdate: vi.fn(),
      readUpdateStatus: vi.fn(),
    };
    const controller = createRendererUpdateController(() => client, window);
    controller.refreshBinding();
    await controller.checkUpdate();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    expect(client.checkUpdate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300_000);
    Object.defineProperty(window.document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    window.document.dispatchEvent(new Event("visibilitychange"));
    expect(client.checkUpdate).toHaveBeenCalledOnce();
    Object.defineProperty(window.document, "visibilityState", { value: "visible" });
    client.checkUpdate.mockImplementationOnce(() => pending.promise);
    window.document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    const manual = controller.checkUpdate();
    expect(client.checkUpdate).toHaveBeenCalledTimes(2);
    pending.resolve(check());
    await manual;
    await vi.advanceTimersByTimeAsync(300_000);
    window.dispatchEvent(new Event("online"));
    await controller.checkUpdate();
    expect(client.checkUpdate).toHaveBeenCalledTimes(3);
    controller.dispose();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    window.document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(client.checkUpdate).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limits each automatic retry cycle and starts a fresh cycle next hour", async () => {
    vi.useFakeTimers();
    const { controller, client } = fixture();
    await controller.checkUpdate();
    client.checkUpdate.mockResolvedValue({ ...check(), error: "offline" });
    await vi.advanceTimersByTimeAsync(3_600_000 + 44_000);
    expect(client.checkUpdate).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(3_600_000 - 44_000);
    expect(client.checkUpdate).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(44_000);
    expect(client.checkUpdate).toHaveBeenCalledTimes(11);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["downloading", "ready-to-restart"] as const)(
    "skips automatic checks while %s",
    async (phase) => {
      vi.useFakeTimers();
      const { controller, client } = fixture();
      await controller.checkUpdate();
      client.readUpdateStatus.mockResolvedValue({ status: status(phase) });
      await controller.readUpdateStatus();
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(client.checkUpdate).toHaveBeenCalledOnce();
      expect(controller.snapshot.status?.phase).toBe(phase);
      controller.dispose();
    },
  );

  it("cancels pending retry checks when a download starts", async () => {
    vi.useFakeTimers();
    const { controller, client } = fixture();
    await controller.checkUpdate();
    client.checkUpdate.mockResolvedValue({ ...check(), error: "offline" });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(client.checkUpdate).toHaveBeenCalledTimes(2);
    await controller.startUpdate();
    await vi.advanceTimersByTimeAsync(44_000);
    expect(client.checkUpdate).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("does not check after unbinding or disposing a pending retry", async () => {
    vi.useFakeTimers();
    const window = ownerWindow();
    const client = {
      checkUpdate: vi.fn(async () => ({ ...check(), error: "offline" })),
      startUpdate: vi.fn(),
      readUpdateStatus: vi.fn(),
    };
    let binding: RendererUpdateClient | null = client;
    const controller = createRendererUpdateController(() => binding, window);
    controller.refreshBinding();
    await vi.advanceTimersByTimeAsync(0);
    binding = null;
    controller.refreshBinding();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(client.checkUpdate).toHaveBeenCalledOnce();
    binding = client;
    controller.refreshBinding();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.checkUpdate).toHaveBeenCalledTimes(2);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(client.checkUpdate).toHaveBeenCalledTimes(2);
  });

  it("checks once per binding and backs off failures despite DOM scans", async () => {
    vi.useFakeTimers();
    const client = {
      checkUpdate: vi.fn(async () => ({ ...check(), error: "offline" })),
      startUpdate: vi.fn(),
      readUpdateStatus: vi.fn(),
    };
    const controller = createRendererUpdateController(() => client, ownerWindow());
    controller.refreshBinding();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 50; i++) controller.refreshBinding();
    expect(client.checkUpdate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(client.checkUpdate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.checkUpdate).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("keeps one poller when views close, stops at ready, and only restarts explicitly", async () => {
    vi.useFakeTimers();
    const { client, controller } = fixture();
    await vi.advanceTimersByTimeAsync(0);
    const view = vi.fn();
    const close = controller.subscribeUpdateStatus(view);
    await Promise.all([controller.startUpdate(), controller.startUpdate()]);
    expect(client.startUpdate).toHaveBeenCalledOnce();
    expect(client.restartUpdate).not.toHaveBeenCalled();
    close();
    await vi.advanceTimersByTimeAsync(750);
    expect(controller.snapshot.status?.phase).toBe("ready-to-restart");
    expect(client.readUpdateStatus).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.readUpdateStatus).toHaveBeenCalledOnce();
    await Promise.all([controller.restartUpdate(), controller.restartUpdate()]);
    expect(client.restartUpdate).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("rejects premature restarts and does not redownload a ready update", async () => {
    const { client, controller } = fixture();
    await controller.checkUpdate();
    await expect(controller.restartUpdate()).rejects.toThrow("No downloaded update");
    await controller.readUpdateStatus();
    await controller.startUpdate();
    expect(client.startUpdate).not.toHaveBeenCalled();
    expect(client.restartUpdate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("preserves progress if online discovery returns an older snapshot", async () => {
    vi.useFakeTimers();
    const { controller, client } = fixture();
    await controller.checkUpdate();
    await controller.startUpdate();
    expect((await controller.checkUpdate())?.status?.phase).toBe("downloading");
    await controller.readUpdateStatus();
    client.checkUpdate.mockResolvedValue(check(null));
    expect((await controller.checkUpdate())?.status?.phase).toBe("ready-to-restart");
    controller.dispose();
  });

  it("allows a failed download to be retried", async () => {
    vi.useFakeTimers();
    const { controller, client } = fixture();
    await controller.checkUpdate();
    client.startUpdate.mockRejectedValueOnce(new Error("download failed"));
    await expect(controller.startUpdate()).rejects.toThrow("download failed");
    expect(controller.snapshot.error).toBeInstanceOf(Error);
    await controller.startUpdate();
    expect(controller.snapshot.error).toBeNull();
    expect(client.startUpdate).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("ignores late discovery after the local Host binding changes", async () => {
    const old = Promise.withResolvers<UpdateCheckResult>();
    const initial = {
      checkUpdate: () => old.promise,
      startUpdate: vi.fn(),
      readUpdateStatus: vi.fn(),
    };
    let client: RendererUpdateClient = initial;
    const controller = createRendererUpdateController(() => client, ownerWindow());
    controller.refreshBinding();
    client = { ...initial, checkUpdate: async () => ({ ...check(), latestVersion: "2.0.0" }) };
    controller.refreshBinding();
    await controller.checkUpdate();
    old.resolve(check());
    await Promise.resolve();
    expect(controller.snapshot.check?.latestVersion).toBe("2.0.0");
    controller.dispose();
  });

  it("keeps a check running past the Host network budget", async () => {
    // The Host may legitimately spend its whole network budget on the lookup, so
    // the renderer budget must stay above it; otherwise a slow but successful
    // check is reported as "the update service did not respond".
    expect(UPDATE_CHECK_REQUEST_TIMEOUT_MS).toBeGreaterThan(UPDATE_CHECK_NETWORK_TIMEOUT_MS);
    vi.useFakeTimers();
    const slow = Promise.withResolvers<UpdateCheckResult | null>();
    const client = {
      checkUpdate: vi.fn(() => slow.promise),
      startUpdate: vi.fn(),
      readUpdateStatus: vi.fn(),
    };
    const controller = createRendererUpdateController(() => client, ownerWindow());
    controller.refreshBinding();
    const request = controller.checkUpdate();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_NETWORK_TIMEOUT_MS);
    expect(controller.snapshot.error).toBeNull();
    slow.resolve(check());
    await expect(request).resolves.toMatchObject({ latestVersion: "1.2.3" });
    expect(controller.snapshot.error).toBeNull();
    controller.dispose();
  });

  it("ignores stale successful operations before a newer update", async () => {
    const { controller } = fixture(status("succeeded"));
    expect((await controller.checkUpdate())?.status).toBeNull();
    controller.dispose();
  });
});
