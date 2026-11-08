import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  UpdateCheckResult,
  UpdateStartResult,
  UpdateStatus,
  UpdateStatusResult,
} from "@codexhost/shared-contracts";

import { HostAutoUpdate } from "../src/host-auto-update.js";
import type { HostUpdateCoordinator } from "../src/update-coordinator.js";

const VERSION = "1.2.3";

function status(phase: UpdateStatus["phase"], version = VERSION): UpdateStatus {
  return {
    version,
    installation: "macos-dmg",
    phase,
    updatedAt: 1,
    error: phase === "failed" ? "download failed" : null,
  };
}

function check(statusValue: UpdateStatus | null = null): UpdateCheckResult {
  return {
    currentVersion: "1.2.2",
    installation: "macos-dmg",
    latestVersion: VERSION,
    updateAvailable: true,
    installationAvailable: true,
    releaseNotes: null,
    releaseNotesUrl: null,
    status: statusValue,
    error: null,
  };
}

function started(phase: UpdateStatus["phase"]): UpdateStartResult {
  return { status: status(phase) };
}

function coordinatorFixture(overrides: Partial<HostUpdateCoordinator> = {}): HostUpdateCoordinator {
  return {
    check: vi.fn(async () => check()),
    start: vi.fn(async () => started("downloading")),
    status: vi.fn(async (): Promise<UpdateStatusResult> => ({
      status: status("ready-to-restart"),
    })),
    restart: vi.fn(async () => started("waiting-for-exit")),
    ...overrides,
  };
}

function autoUpdate(
  coordinator: HostUpdateCoordinator,
  options: {
    initialCheckDelayMs?: number;
    checkIntervalMs?: number;
    statusPollIntervalMs?: number;
    idleGraceMs?: number;
    idleRecheckMs?: number;
    retryWatchIntervalMs?: number;
    idleProbeTimeoutMs?: number;
  } = {},
): HostAutoUpdate {
  return new HostAutoUpdate({
    coordinator,
    diagnose: vi.fn(),
    initialCheckDelayMs: options.initialCheckDelayMs ?? 0,
    checkIntervalMs: options.checkIntervalMs ?? 3_600_000,
    statusPollIntervalMs: options.statusPollIntervalMs ?? 1,
    idleGraceMs: options.idleGraceMs ?? 10,
    idleRecheckMs: options.idleRecheckMs ?? 5,
    retryWatchIntervalMs: options.retryWatchIntervalMs ?? 60_000,
    idleProbeTimeoutMs: options.idleProbeTimeoutMs ?? 10,
  });
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("automatic update when idle", () => {
  it("starts a download after discovery and restarts once after idle grace", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator);
    update.register(async () => true);
    update.start();

    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(coordinator.check).toHaveBeenCalledOnce();
    expect(coordinator.start).toHaveBeenCalledOnce();

    // Poll reaches ready-to-restart, then the 10 ms idle grace elapses.
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.restart).toHaveBeenCalledOnce();

    // Handoff stops polling and the hourly check; the next version waits for a
    // new HostAutoUpdate instance after the application relaunches.
    await vi.advanceTimersByTimeAsync(3_600_000);
    await settle();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    expect(coordinator.check).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("does not restart while any registered Host reports work", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator);
    let idle = false;
    update.register(async () => idle);
    update.start();

    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(coordinator.restart).not.toHaveBeenCalled();

    idle = true;
    update.activityChanged();
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("never restarts while a Host cannot prove idleness", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator, { idleRecheckMs: 60_000 });
    update.register(async () => null);
    update.start();

    await vi.advanceTimersByTimeAsync(3_600_000);
    await settle();
    expect(coordinator.restart).not.toHaveBeenCalled();
    update.dispose();
  });

  it("never restarts without a registered Host", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator, { idleRecheckMs: 60_000 });
    update.start();

    await vi.advanceTimersByTimeAsync(3_600_000);
    await settle();
    expect(coordinator.restart).not.toHaveBeenCalled();
    update.dispose();
  });

  it("does not automatically retry a failed version", async () => {
    vi.useFakeTimers();
    const failed = status("failed");
    const coordinator = coordinatorFixture({
      check: vi.fn(async () => check(failed)),
    });
    const update = autoUpdate(coordinator, { checkIntervalMs: 10 });
    update.register(async () => true);
    update.start();

    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(vi.mocked(coordinator.check).mock.calls.length).toBeGreaterThan(1);
    expect(coordinator.start).not.toHaveBeenCalled();
    expect(coordinator.restart).not.toHaveBeenCalled();
    update.dispose();
  });

  it("resumes automatically after the user retries a failed preparation", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture({
      check: vi.fn(async () => check(status("failed"))),
    });
    const update = autoUpdate(coordinator, { checkIntervalMs: 10 });
    update.register(async () => true);
    update.start();

    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.start).not.toHaveBeenCalled();

    // The Renderer retry starts the operation; the next automatic check sees
    // its progress and follows it to the idle restart.
    coordinator.check = vi.fn(async () => check(status("downloading")));
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(coordinator.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("continues an operation that already reports downloading", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture({
      check: vi.fn(async () => check(status("downloading"))),
    });
    const update = autoUpdate(coordinator);
    update.register(async () => true);
    update.start();

    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.start).not.toHaveBeenCalled();
    expect(coordinator.status).toHaveBeenCalled();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("keeps polling after preparation reports the initial prepared phase", async () => {
    vi.useFakeTimers();
    let downloads = 0;
    const coordinator = coordinatorFixture({
      start: vi.fn(async () => started(downloads === 0 ? "prepared" : "downloading")),
      status: vi.fn(async (): Promise<UpdateStatusResult> => {
        downloads += 1;
        return { status: status(downloads < 3 ? "prepared" : "ready-to-restart") };
      }),
    });
    const update = autoUpdate(coordinator);
    update.register(async () => true);
    update.start();

    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(coordinator.check).toHaveBeenCalledOnce();
    expect(coordinator.start).toHaveBeenCalledOnce();
    // `prepared` is written before the download finishes, so it must not be
    // mistaken for a Launcher handoff.
    expect(coordinator.restart).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("never starts a second operation after the Launcher takes over the restart", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture({
      start: vi.fn(async () => started("waiting-for-exit")),
    });
    const update = autoUpdate(coordinator, { checkIntervalMs: 10 });
    update.register(async () => true);
    update.start();

    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(coordinator.start).toHaveBeenCalledOnce();

    // A later check sees the operation the Launcher now owns.
    coordinator.check = vi.fn(async () => check(status("waiting-for-exit")));
    await vi.advanceTimersByTimeAsync(50);
    await settle();
    expect(coordinator.start).toHaveBeenCalledOnce();
    expect(coordinator.restart).not.toHaveBeenCalled();

    // Even after the active status disappears, the version this process
    // handed off is never started a second time.
    coordinator.check = vi.fn(async () => check());
    await vi.advanceTimersByTimeAsync(50);
    await settle();
    expect(coordinator.start).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("stops waiting when the user confirms the restart while the Desktop is busy", async () => {
    vi.useFakeTimers();
    let busy = true;
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator, { checkIntervalMs: 10 });
    update.register(async () => !busy);
    update.start();

    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.restart).not.toHaveBeenCalled();

    // The panel's manual restart moves the status out of ready-to-restart.
    coordinator.check = vi.fn(async () => check(status("waiting-for-exit")));
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    busy = false;
    update.activityChanged();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(coordinator.restart).not.toHaveBeenCalled();
    update.dispose();
  });

  it("restarts a downloaded update even when the Release check itself fails", async () => {
    vi.useFakeTimers();
    const ready = status("ready-to-restart");
    const coordinator = coordinatorFixture({
      check: vi.fn(async () => ({
        ...check(ready),
        latestVersion: null,
        updateAvailable: false,
        installationAvailable: false,
        error: "synthetic offline",
      })),
    });
    const update = autoUpdate(coordinator);
    update.register(async () => true);
    update.start();

    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.start).not.toHaveBeenCalled();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("treats a start failure without any published status as a failed preparation", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture({
      start: vi.fn(async () => {
        throw new Error("synthetic operation lock");
      }),
      status: vi.fn(async (): Promise<UpdateStatusResult> => ({ status: null })),
    });
    const update = autoUpdate(coordinator, { checkIntervalMs: 100_000 });
    update.register(async () => true);
    update.start();

    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.start).toHaveBeenCalledOnce();

    // The next automatic check must not start the same version again, even
    // after the failure was recorded.
    await vi.advanceTimersByTimeAsync(200_000);
    await settle();
    expect(coordinator.start).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("does not retry the same readiness after an automatic restart failure", async () => {
    vi.useFakeTimers();
    const ready = status("ready-to-restart");
    const coordinator = coordinatorFixture({
      // confirmRestart failed, so the downloaded status stays ready.
      check: vi.fn(async () => check(ready)),
      status: vi.fn(async (): Promise<UpdateStatusResult> => ({ status: ready })),
      restart: vi.fn(async () => {
        throw new Error("synthetic restart failure");
      }),
    });
    const update = autoUpdate(coordinator, { checkIntervalMs: 10 });
    update.register(async () => true);
    update.start();

    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    expect(coordinator.start).not.toHaveBeenCalled();
    update.dispose();
  });

  it("resumes the idle watch when the final read cannot prove idleness", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator, { idleGraceMs: 10, idleRecheckMs: 60_000 });
    let state: boolean | null = true;
    update.register(async () => state);
    update.start();

    // The grace starts; work appears before its timer fires.
    await vi.advanceTimersByTimeAsync(5);
    await settle();
    state = null;
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(coordinator.restart).not.toHaveBeenCalled();

    // The same downloaded update still waits: no new status or network check is
    // needed for the idle watch to recover.
    state = true;
    update.activityChanged();
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("waits for the last unreadable Host before it can prove idleness", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator, { idleRecheckMs: 60_000 });
    const unregister = update.register(async () => null, { nativeAuthority: true });
    update.register(async () => true);
    update.start();

    await vi.advanceTimersByTimeAsync(50);
    await settle();
    expect(coordinator.restart).not.toHaveBeenCalled();

    // A closed Remote Control session stops contributing its unknown state.
    unregister();
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("does not stack a new native read while a timed-out probe is still running", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator, { idleProbeTimeoutMs: 10, idleRecheckMs: 15 });
    const probe = vi.fn(() => new Promise<boolean | null>(() => undefined));
    update.register(probe);
    update.start();

    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(probe).toHaveBeenCalledOnce();
    expect(coordinator.restart).not.toHaveBeenCalled();
    update.dispose();
  });

  it("re-evaluates a late Host that joins after the update is ready", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator);
    update.start();

    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.restart).not.toHaveBeenCalled();

    update.register(async () => true, { nativeAuthority: true });
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("waits for idle as soon as the Renderer observes a finished download", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator, {
      initialCheckDelayMs: 60 * 60_000,
      checkIntervalMs: 60 * 60_000,
    });
    update.register(async () => true);
    update.start();

    // The user started the download from the panel, so the Host's own hourly
    // check has not seen the operation yet.
    update.statusObserved(status("ready-to-restart"));
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.check).not.toHaveBeenCalled();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    update.dispose();
  });

  it("restarts the idle grace when work appears or finishes", async () => {
    vi.useFakeTimers();
    const coordinator = coordinatorFixture();
    const update = autoUpdate(coordinator, { idleGraceMs: 20, idleRecheckMs: 1_000 });
    let idle = true;
    update.register(async () => idle);
    update.start();

    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(coordinator.restart).not.toHaveBeenCalled();
    idle = false;
    update.activityChanged();
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.restart).not.toHaveBeenCalled();

    idle = true;
    update.activityChanged();
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(coordinator.restart).toHaveBeenCalledOnce();
    update.dispose();
  });
});
