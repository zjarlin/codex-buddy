import type { BuddyHealth, ProviderHealth } from "@codexhost/shared-contracts";
import { AUTO_RESUME_MAX_ATTEMPTS, type InterruptedQueueEntry } from "./interrupted-queue.js";

/** 只探测网关，不扫描会话历史；队列变化和页面存活才会触发。 */
export const AUTO_RESUME_PROBE_INTERVAL_MS = 15_000;

export interface AutoResumeState {
  enabled: boolean;
  supported: boolean;
  health: "unknown" | "healthy" | "unhealthy";
  running: boolean;
  checkedAt: number | null;
  reason: string | null;
  providers: ProviderHealth[];
  pending: number;
  exhausted: number;
}

export interface AutoResumeOptions {
  enabled(): boolean;
  busy(): boolean;
  candidates(): InterruptedQueueEntry[];
  probe(): Promise<BuddyHealth>;
  resume(entries: InterruptedQueueEntry[]): Promise<void>;
  onChange(state: AutoResumeState): void;
  intervalMs?: number;
  maxAttempts?: number;
}

const signature = (entries: InterruptedQueueEntry[]): string =>
  entries
    .map((entry) => `${entry.threadId}:${entry.turnId}`)
    .sort()
    .join("|");

export function createAutoResume(options: AutoResumeOptions) {
  const intervalMs = options.intervalMs ?? AUTO_RESUME_PROBE_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? AUTO_RESUME_MAX_ATTEMPTS;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let probing = false;
  let running = false;
  let supported = true;
  let health: AutoResumeState["health"] = "unknown";
  let checkedAt: number | null = null;
  let reason: string | null = null;
  let providers: ProviderHealth[] = [];
  let lastSignature = "";
  let retry = false;

  // 续接提交本身会创建新回合；预算跟着会话累计，不进队列的候选也不能绕过上限。
  const eligible = (): InterruptedQueueEntry[] =>
    options
      .candidates()
      .filter(
        (entry) =>
          entry.status !== "cancelled" &&
          entry.autoResumeBlocked === undefined &&
          (entry.autoResumeAttempts ?? 0) < maxAttempts,
      );
  const exhausted = (): number =>
    options
      .candidates()
      .filter(
        (entry) =>
          entry.status !== "cancelled" &&
          (entry.autoResumeBlocked !== undefined || (entry.autoResumeAttempts ?? 0) >= maxAttempts),
      ).length;
  const snapshot = (): AutoResumeState => ({
    enabled: supported && options.enabled(),
    supported,
    health,
    running,
    checkedAt,
    reason,
    providers,
    pending: eligible().length,
    exhausted: exhausted(),
  });
  const emit = () => {
    if (!disposed) options.onChange(snapshot());
  };

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(delay = intervalMs): void {
    clearTimer();
    if (disposed || !supported || !options.enabled() || eligible().length === 0 || running) return;
    timer = setTimeout(() => {
      timer = null;
      void probe();
    }, delay);
  }

  async function run(entries: InterruptedQueueEntry[], currentSignature: string): Promise<void> {
    if (disposed || running || entries.length === 0) return;
    running = true;
    retry = false;
    lastSignature = currentSignature;
    emit();
    try {
      await options.resume(entries);
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    } finally {
      running = false;
      retry = !disposed && eligible().length > 0;
      emit();
    }
  }

  async function probe(): Promise<void> {
    if (disposed || probing || running || !supported || !options.enabled()) return;
    if (eligible().length === 0) return;
    if (options.busy()) {
      schedule();
      return;
    }
    probing = true;
    try {
      const result = await options.probe();
      if (disposed) return;
      if (!result.supported) {
        supported = false;
        retry = false;
        clearTimer();
        emit();
        return;
      }
      supported = true;
      const previous = health;
      health = result.healthy ? "healthy" : "unhealthy";
      checkedAt = result.checkedAt;
      reason = result.reason;
      providers = result.providers ?? [];
      emit();
      const entries = eligible();
      const currentSignature = signature(entries);
      if (
        health === "healthy" &&
        currentSignature &&
        (previous !== "healthy" || currentSignature !== lastSignature || retry) &&
        options.enabled() &&
        !options.busy()
      ) {
        await run(entries, currentSignature);
      }
    } catch (error) {
      if (!disposed) {
        health = "unhealthy";
        checkedAt = Date.now();
        reason = error instanceof Error ? error.message : String(error);
        providers = [];
        retry = false;
        emit();
      }
    } finally {
      probing = false;
      if (disposed) return;
      if (supported && options.enabled() && eligible().length > 0) schedule();
    }
  }

  return {
    /** 队列、连接或忙碌状态变化后调用；会按当前候选立即探测一次。 */
    update(): void {
      if (disposed) return;
      if (!supported || !options.enabled() || eligible().length === 0) {
        retry = false;
        lastSignature = "";
        clearTimer();
        emit();
        return;
      }
      emit();
      if (probing || running || options.busy()) return;
      schedule(0);
    },
    /** 切换 Host、连接或用户重新打开自动续接时丢弃上一轮健康结论。 */
    reset(): void {
      clearTimer();
      supported = true;
      health = "unknown";
      checkedAt = null;
      reason = null;
      providers = [];
      lastSignature = "";
      retry = false;
      emit();
    },
    dispose(): void {
      disposed = true;
      clearTimer();
    },
  };
}
