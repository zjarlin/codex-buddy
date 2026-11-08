import type { UpdateCheckResult, UpdateStatus } from "@codexhost/shared-contracts";

import type { HostUpdateCoordinator } from "./update-coordinator.js";

/** Startup checks wait for the Desktop window and the official connection to settle. */
const INITIAL_CHECK_DELAY_MS = 2 * 60_000;
const CHECK_INTERVAL_MS = 60 * 60_000;
/** A check that could not reach the Release feed retries before the hourly cadence. */
const CHECK_RETRY_DELAY_MS = 10 * 60_000;
const STATUS_POLL_INTERVAL_MS = 2_000;
/** While a downloaded update waits for work, re-read the Host work state. */
const IDLE_RECHECK_MS = 15_000;
/**
 * A Turn completing is not the same as the user being done. Restart only after
 * this long without any observed work so a follow-up message does not land on an
 * application that is already shutting down.
 */
const IDLE_GRACE_MS = 30_000;
/**
 * A probe reads native state through the official connection. An unresponsive
 * backend must not wedge the restart decision.
 */
const IDLE_PROBE_TIMEOUT_MS = 10_000;
/**
 * After a preparation failure the Host only reads local status. This cadence
 * lets a manual Retry resume the automatic path without contacting GitHub.
 */
const RETRY_WATCH_INTERVAL_MS = 60_000;
/**
 * A preparation that failed before publishing its first status, for example
 * because another process held the operation lock, may publish it a moment
 * later. Bounded status reads still turn a genuine failure into a failure.
 */
const MISSING_STATUS_POLL_LIMIT = 15;

/**
 * Phases owned by the Launcher or the Updater after a restart was confirmed.
 * The Host must not start or poll that operation again; a manual restart may
 * have already handed it off.
 */
const HANDED_OFF_PHASES = new Set<UpdateStatus["phase"]>([
  "waiting-for-exit",
  "installing",
  "restarting",
  "succeeded",
]);
/**
 * Preparation writes `prepared` before the download starts and
 * `ready-to-restart` when verification finishes. Deferred preparation therefore
 * keeps polling both phases; only `ready-to-restart` waits for an idle Desktop.
 */
const UNFINISHED_PHASES = new Set<UpdateStatus["phase"]>(["prepared", "downloading"]);
/** Terminal phases persist locally; they describe history until replaced. */
const TERMINAL_PHASES = new Set<UpdateStatus["phase"]>(["failed", "succeeded"]);

export interface HostAutoUpdateOptions {
  coordinator: Pick<HostUpdateCoordinator, "check" | "start" | "restart" | "status">;
  diagnose(error: unknown): void;
  initialCheckDelayMs?: number;
  checkIntervalMs?: number;
  statusPollIntervalMs?: number;
  retryWatchIntervalMs?: number;
  idleGraceMs?: number;
  idleRecheckMs?: number;
  idleProbeTimeoutMs?: number;
}

/**
 * True when this Host has no running work, false when it does, and null when the
 * Host cannot prove idleness. Any participant reporting work blocks the restart.
 */
export type HostIdleProbe = () => Promise<boolean | null>;

export interface HostIdleRegistration {
  /**
   * A Host that also reads the native Thread list can prove the whole Desktop is
   * idle. An external-only Host contributes only its own running work; without
   * an authority, an empty probe set or local-only success is not enough.
   */
  nativeAuthority?: boolean;
}

/** The part of the shared coordinator an AppServerHost needs. */
export interface HostAutoUpdateParticipant {
  register(probe: HostIdleProbe, registration?: HostIdleRegistration): () => void;
  activityChanged(): void;
  /**
   * A Renderer request observed this status. Reporting it here starts the idle
   * wait as soon as verification finishes, even when the Renderer started the
   * download between two hourly checks.
   */
  statusObserved(status: UpdateStatus | null): void;
}

/**
 * Turns a downloaded Release into an unattended restart. The Host owns this
 * policy because only it can see every kind of running work; the Renderer keeps
 * its manual download and restart actions.
 */
export class HostAutoUpdate implements HostAutoUpdateParticipant {
  readonly #coordinator: HostAutoUpdateOptions["coordinator"];
  readonly #diagnose: (error: unknown) => void;
  readonly #probes = new Map<HostIdleProbe, boolean>();
  /** Reads that outlived their timeout; a later pass must not stack another. */
  readonly #probeReads = new Set<HostIdleProbe>();
  readonly #abort = new AbortController();
  /** Versions whose automatic preparation failed; a manual retry clears them. */
  readonly #failedPreparations = new Set<string>();
  /** Versions whose automatic restart failed; never retried on a timer. */
  readonly #failedRestarts = new Set<string>();
  /** Versions this process already handed to the Launcher or Updater. */
  readonly #handedOffVersions = new Set<string>();
  readonly #initialCheckDelayMs: number;
  readonly #checkIntervalMs: number;
  readonly #statusPollIntervalMs: number;
  readonly #retryWatchIntervalMs: number;
  readonly #idleGraceMs: number;
  readonly #idleRecheckMs: number;
  readonly #idleProbeTimeoutMs: number;
  #checkTimer: NodeJS.Timeout | undefined;
  #pollTimer: NodeJS.Timeout | undefined;
  #retryTimer: NodeJS.Timeout | undefined;
  #idleTimer: NodeJS.Timeout | undefined;
  #recheckTimer: NodeJS.Timeout | undefined;
  #checking = false;
  #evaluating = false;
  #evaluateAgain = false;
  #restarting = false;
  #waitingForIdle = false;
  #handedOff = false;
  #disposed = false;
  #targetVersion: string | null = null;
  /** Whether the current target ever published an unfinished status. */
  #sawOperation = false;
  /** Consecutive status reads without any operation, before declaring a failure. */
  #missingStatusPolls = 0;
  #readingStatus = false;

  constructor(options: HostAutoUpdateOptions) {
    this.#coordinator = options.coordinator;
    this.#diagnose = options.diagnose;
    this.#initialCheckDelayMs = options.initialCheckDelayMs ?? INITIAL_CHECK_DELAY_MS;
    this.#checkIntervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS;
    this.#statusPollIntervalMs = options.statusPollIntervalMs ?? STATUS_POLL_INTERVAL_MS;
    this.#retryWatchIntervalMs = options.retryWatchIntervalMs ?? RETRY_WATCH_INTERVAL_MS;
    this.#idleGraceMs = options.idleGraceMs ?? IDLE_GRACE_MS;
    this.#idleRecheckMs = options.idleRecheckMs ?? IDLE_RECHECK_MS;
    this.#idleProbeTimeoutMs = options.idleProbeTimeoutMs ?? IDLE_PROBE_TIMEOUT_MS;
  }

  /** Hosts that share one Desktop process register here; all of them must be idle. */
  register(probe: HostIdleProbe, registration: HostIdleRegistration = {}): () => void {
    this.#probes.set(probe, registration.nativeAuthority !== false);
    // A Host can connect after the update is ready, for example when a Remote
    // Control session attaches later. Its native read may be the first proof.
    if (this.#waitingForIdle) void this.#evaluateIdle();
    return () => {
      this.#probes.delete(probe);
      // The removed Host may have been the only unreadable participant. Its
      // absence can turn "unknown" into a provable idle state, or the reverse.
      if (this.#waitingForIdle) void this.#evaluateIdle();
    };
  }

  start(): void {
    if (this.#disposed || this.#handedOff || this.#checkTimer !== undefined) return;
    this.#scheduleCheck(this.#initialCheckDelayMs);
  }

  /** Work appeared or finished; a pending restart must re-evaluate its idle window. */
  activityChanged(): void {
    if (this.#disposed || !this.#waitingForIdle || this.#restarting) return;
    this.#clearIdleTimer();
    this.#clearRecheckTimer();
    void this.#evaluateIdle();
  }

  statusObserved(status: UpdateStatus | null): void {
    if (this.#disposed || this.#handedOff || this.#restarting || !status) return;
    // The Renderer may have started this operation between two Host checks, so
    // adopt its status now instead of waiting for the hourly check.
    // #followStatus is idempotent for an operation this Host already tracks,
    // and a manual restart or completion ends the idle wait as usual.
    this.#followStatus(status);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#waitingForIdle = false;
    this.#probes.clear();
    this.#probeReads.clear();
    this.#abort.abort();
    this.#clearTimers();
  }

  #clearCheckTimer(): void {
    if (this.#checkTimer === undefined) return;
    clearTimeout(this.#checkTimer);
    this.#checkTimer = undefined;
  }

  #clearPollTimer(): void {
    if (this.#pollTimer === undefined) return;
    clearTimeout(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  #clearRetryTimer(): void {
    if (this.#retryTimer === undefined) return;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer === undefined) return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }

  #clearRecheckTimer(): void {
    if (this.#recheckTimer === undefined) return;
    clearTimeout(this.#recheckTimer);
    this.#recheckTimer = undefined;
  }

  #clearTimers(): void {
    this.#clearCheckTimer();
    this.#clearPollTimer();
    this.#clearRetryTimer();
    this.#clearIdleTimer();
    this.#clearRecheckTimer();
  }

  #scheduleCheck(delayMs: number): void {
    if (this.#disposed || this.#handedOff || this.#checkTimer !== undefined) return;
    this.#checkTimer = setTimeout(() => {
      this.#checkTimer = undefined;
      void this.#check();
    }, delayMs);
  }

  async #check(): Promise<void> {
    if (this.#disposed || this.#handedOff || this.#checking) return;
    this.#checking = true;
    let failed = false;
    try {
      const result = await this.#coordinator.check(this.#abort.signal);
      if (this.#disposed || this.#handedOff) return;
      // An error with no Release means the feed itself was unreachable. A
      // missing asset for a known Release is not retried faster: the next
      // Release, not a retry, can make it installable.
      failed = result === null || (result.error !== null && result.latestVersion === null);
      await this.#consider(result);
    } catch (error) {
      failed = true;
      if (!this.#disposed && !this.#handedOff) this.#diagnose(error);
    } finally {
      this.#checking = false;
      this.#scheduleCheck(failed ? CHECK_RETRY_DELAY_MS : this.#checkIntervalMs);
    }
  }

  async #consider(result: UpdateCheckResult | null): Promise<void> {
    if (!result || this.#restarting) return;
    // An active status belongs to the one operation this process may drive,
    // even when a newer Release appeared meanwhile or the network check failed.
    // Starting another operation would race the existing lock and discard its
    // downloaded artifact. It can also move on while this Host waits for idle,
    // for example when the user confirms the restart from the update panel.
    if (result.status && !TERMINAL_PHASES.has(result.status.phase)) {
      this.#followStatus(result.status);
      return;
    }
    if (!result.updateAvailable || !result.installationAvailable || this.#waitingForIdle) return;
    const version = result.latestVersion;
    if (!version) return;
    // A terminal status persists in local state; only the same version's
    // outcome matters. A newer Release must not be blocked by an older result.
    if (result.status?.version === version) {
      this.#followStatus(result.status);
      return;
    }
    if (this.#failedPreparations.has(version) || this.#failedRestarts.has(version)) return;
    if (this.#handedOffVersions.has(version)) return;
    // One tracked operation is enough; a check must not start another version
    // while the current target is still downloading or waiting for idle.
    if (this.#targetVersion !== null) return;
    try {
      const started = await this.#coordinator.start();
      if (this.#disposed || this.#handedOff) return;
      this.#followStatus(started.status);
    } catch (error) {
      if (!this.#disposed && !this.#handedOff) this.#diagnose(error);
      // Another caller may have won the operation lock, or preparation failed
      // before publishing a status. A failed start counts as observed: if no
      // status follows, this version must not be started again on the next
      // timer. A concurrent operation that is still initializing publishes its
      // status on the next poll and keeps this path alive.
      this.#targetVersion = version;
      // A previous version's terminal status is not evidence that this target
      // was ever observed; give this failure the full bounded status window.
      this.#sawOperation = false;
      this.#missingStatusPolls = 0;
      this.#pollStatus();
    }
  }

  /** Drives an operation from a status the Host already has. */
  #followStatus(status: UpdateStatus): void {
    if (HANDED_OFF_PHASES.has(status.phase)) {
      // The Launcher or the Updater owns this operation. Do not start or poll
      // it again: a manual restart may already be in progress.
      this.#handedOffVersions.add(status.version);
      this.#targetVersion = null;
      this.#clearRetryTimer();
      this.#stopWaitingForIdle();
      return;
    }
    if (status.phase === "ready-to-restart") {
      this.#failedPreparations.delete(status.version);
      this.#sawOperation = true;
      // A manual retry can reach this phase after an automatic failure; only an
      // automatic restart that already failed is skipped.
      if (!this.#failedRestarts.has(status.version)) this.#waitForIdle(status.version);
      return;
    }
    if (status.phase === "failed") {
      this.#failedPreparations.add(status.version);
      this.#targetVersion = null;
      this.#sawOperation = false;
      this.#missingStatusPolls = 0;
      this.#stopWaitingForIdle();
      this.#watchForRetry();
      return;
    }
    if (UNFINISHED_PHASES.has(status.phase)) {
      // The coordinator may already be preparing this version. Its start()
      // would wait for the same operation, so continue from the status. A
      // status that moves back from ready means the operation left the idle
      // path (for example a confirmed restart now waiting for exit).
      this.#stopWaitingForIdle();
      this.#failedPreparations.delete(status.version);
      this.#targetVersion = status.version;
      this.#sawOperation = true;
      this.#missingStatusPolls = 0;
      this.#clearRetryTimer();
      this.#pollStatus();
    }
  }

  #pollStatus(): void {
    if (this.#disposed || this.#handedOff || this.#pollTimer !== undefined) return;
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = undefined;
      void this.#readStatus();
    }, this.#statusPollIntervalMs);
  }

  async #readStatus(): Promise<void> {
    if (this.#disposed || this.#handedOff || this.#readingStatus) return;
    this.#readingStatus = true;
    let status: UpdateStatus | null;
    try {
      status = (await this.#coordinator.status()).status;
    } catch (error) {
      if (!this.#disposed && !this.#handedOff) this.#diagnose(error);
      // Keep polling only while an operation is still tracked; an idle failed
      // version is watched by the slower retry timer instead.
      if (this.#targetVersion !== null) this.#pollStatus();
      return;
    } finally {
      this.#readingStatus = false;
    }
    if (this.#disposed || this.#handedOff) return;
    if (!status) {
      this.#missingStatusPolls += 1;
      // An observed active operation is exposed until it reaches a terminal
      // phase, so losing it means this preparation ended without installing.
      // Before any status existed, a start failure or a concurrent operation may
      // still publish one; give that a bounded window before calling it failed.
      if (
        (this.#sawOperation || this.#missingStatusPolls >= MISSING_STATUS_POLL_LIMIT) &&
        this.#targetVersion
      ) {
        this.#failedPreparations.add(this.#targetVersion);
        this.#targetVersion = null;
        this.#sawOperation = false;
        this.#missingStatusPolls = 0;
        this.#watchForRetry();
        return;
      }
      // The same target may still appear; keep watching briefly. A cleared
      // target has no operation left to watch.
      if (this.#targetVersion !== null) this.#pollStatus();
      return;
    }
    this.#sawOperation = true;
    this.#missingStatusPolls = 0;
    this.#followStatus(status);
  }

  /** Only reads local status; a manual Retry resumes without a network check. */
  #watchForRetry(): void {
    if (this.#disposed || this.#handedOff || this.#failedPreparations.size === 0) return;
    if (this.#retryTimer !== undefined) return;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      void this.#readRetryStatus();
    }, this.#retryWatchIntervalMs);
  }

  async #readRetryStatus(): Promise<void> {
    if (this.#disposed || this.#handedOff || this.#waitingForIdle || this.#restarting) return;
    let status: UpdateStatus | null;
    try {
      status = (await this.#coordinator.status()).status;
    } catch (error) {
      if (!this.#disposed && !this.#handedOff) this.#diagnose(error);
      this.#watchForRetry();
      return;
    }
    if (this.#disposed || this.#handedOff || this.#waitingForIdle || this.#restarting) return;
    if (!status) {
      // No active operation remains: the retry also failed or was abandoned.
      this.#watchForRetry();
      return;
    }
    this.#followStatus(status);
    // A manual retry resumes preparation and gets its own status poller; a
    // manual restart belongs to the Launcher. Only a still-failed status needs
    // this watcher, so it does not poll a ready update forever.
    if (status.phase === "failed") this.#watchForRetry();
  }

  /** A terminal or handed-off status ends this Host's idle wait. */
  #stopWaitingForIdle(): void {
    this.#waitingForIdle = false;
    this.#clearIdleTimer();
    this.#clearRecheckTimer();
  }

  #waitForIdle(version: string): void {
    // An hourly re-check repeats the same ready status; it must not restart
    // the grace window the host already entered.
    if (this.#waitingForIdle && this.#targetVersion === version) return;
    this.#targetVersion = version;
    this.#waitingForIdle = true;
    this.#clearRetryTimer();
    this.#clearIdleTimer();
    this.#clearRecheckTimer();
    void this.#evaluateIdle();
  }

  async #evaluateIdle(): Promise<void> {
    if (this.#disposed || this.#handedOff || !this.#waitingForIdle || this.#restarting) return;
    // Turn lifecycle events arrive in bursts. One read per Host answers them;
    // a requested second pass runs after the first read returns.
    if (this.#evaluating) {
      this.#evaluateAgain = true;
      return;
    }
    this.#evaluating = true;
    try {
      const idle = await this.#readIdle();
      if (this.#disposed || this.#handedOff || !this.#waitingForIdle || this.#restarting) return;
      if (idle === true) {
        if (this.#idleTimer === undefined) {
          this.#idleTimer = setTimeout(() => {
            this.#idleTimer = undefined;
            void this.#restart();
          }, this.#idleGraceMs);
        }
      } else {
        // Running work cancels the grace; an unreadable state must not restart.
        this.#clearIdleTimer();
      }
      // Keep watching during the grace as well: a probe can report work that no
      // lifecycle signal announced.
      if (this.#recheckTimer === undefined) {
        this.#recheckTimer = setTimeout(() => {
          this.#recheckTimer = undefined;
          void this.#evaluateIdle();
        }, this.#idleRecheckMs);
      }
    } finally {
      this.#evaluating = false;
      if (this.#evaluateAgain) {
        this.#evaluateAgain = false;
        if (!this.#disposed && !this.#handedOff && this.#waitingForIdle && !this.#restarting)
          void this.#evaluateIdle();
      }
    }
  }

  async #readIdle(): Promise<boolean | null> {
    const probes = [...this.#probes.entries()];
    // No registered Host means this process cannot prove that the Desktop is
    // idle. Starting a restart from an unobserved process would be unsafe.
    if (probes.length === 0) return null;
    const results = await Promise.all(probes.map(([probe]) => this.#readProbe(probe)));
    if (results.includes(false)) return false;
    if (results.includes(null)) return null;
    // A read from an external-only participant does not inspect the native
    // Thread list, so it cannot authorize the restart by itself.
    return probes.some(([, nativeAuthority]) => nativeAuthority) ? true : null;
  }

  /**
   * One native read per Host at a time. A probe that outlived its timeout is
   * still holding the official connection; starting another read every recheck
   * would only queue more requests. Such a pass is unknown rather than reusing
   * an old answer, because work may have started since that read began.
   */
  async #readProbe(probe: HostIdleProbe): Promise<boolean | null> {
    if (this.#probeReads.has(probe)) return null;
    this.#probeReads.add(probe);
    const read = (async () => {
      try {
        // Only an explicit boolean proves a state; a malformed answer must not
        // be read as idleness.
        const result = await probe();
        return result === true ? true : result === false ? false : null;
      } catch (error) {
        this.#diagnose(error);
        return null;
      } finally {
        this.#probeReads.delete(probe);
      }
    })();
    return this.#withTimeout(read);
  }

  /**
   * A manual restart may already own this operation and moved the status to a
   * Launcher-owned phase, in which case this automatic attempt is a no-op rather
   * than a failure worth recording.
   */
  async #manualHandoffWon(): Promise<boolean> {
    if (this.#disposed || this.#handedOff) return false;
    const current = await this.#coordinator.status().catch(() => null);
    if (!current?.status || !HANDED_OFF_PHASES.has(current.status.phase)) return false;
    this.#handedOffVersions.add(current.status.version);
    this.#targetVersion = null;
    this.#stopWaitingForIdle();
    return true;
  }

  async #withTimeout(read: Promise<boolean | null>): Promise<boolean | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        read,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), this.#idleProbeTimeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async #restart(): Promise<void> {
    if (this.#disposed || this.#handedOff || !this.#waitingForIdle || this.#restarting) return;
    const version = this.#targetVersion;
    this.#restarting = true;
    // A failed final read voids this restart but not the downloaded update.
    // #waitingForIdle stays set so a concurrent status change can still cancel
    // it; the re-evaluation below resumes only while the watch is still wanted.
    let recheck = false;
    try {
      // Work may have appeared during the grace timer or the idle read itself.
      if ((await this.#readIdle()) !== true) {
        recheck = true;
        return;
      }
      if (this.#disposed || this.#handedOff) return;
      await this.#coordinator.restart();
      // The Launcher stops this Host after the Updater is waiting for its exit.
      this.#handedOff = true;
      this.#targetVersion = null;
      this.#waitingForIdle = false;
      this.#clearTimers();
    } catch (error) {
      if (!this.#disposed) this.#diagnose(error);
      if (await this.#manualHandoffWon()) return;
      // Never retry on a timer. The Renderer keeps its explicit restart action.
      if (version) this.#failedRestarts.add(version);
      this.#targetVersion = null;
      this.#stopWaitingForIdle();
    } finally {
      this.#restarting = false;
      if (recheck && !this.#disposed && !this.#handedOff && this.#waitingForIdle)
        void this.#evaluateIdle();
    }
  }
}
