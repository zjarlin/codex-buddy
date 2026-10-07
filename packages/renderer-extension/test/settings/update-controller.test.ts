import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateCheckResult, UpdateStatus } from "@codexhost/shared-contracts";
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
const ownerWindow = () => ({ setTimeout, clearTimeout }) as unknown as Window;
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
    expect((await controller.checkUpdate()).status?.phase).toBe("downloading");
    await controller.readUpdateStatus();
    client.checkUpdate.mockResolvedValue(check(null));
    expect((await controller.checkUpdate()).status?.phase).toBe("ready-to-restart");
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

  it("ignores stale successful operations before a newer update", async () => {
    const { controller } = fixture(status("succeeded"));
    expect((await controller.checkUpdate()).status).toBeNull();
    controller.dispose();
  });
});
