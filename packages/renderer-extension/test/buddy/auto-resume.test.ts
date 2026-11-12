import type { BuddyHealth } from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_RESUME_PROBE_INTERVAL_MS,
  createAutoResume,
  type AutoResumeState,
} from "../../src/buddy/auto-resume.js";
import {
  AUTO_RESUME_MAX_ATTEMPTS,
  type InterruptedQueueEntry,
} from "../../src/buddy/interrupted-queue.js";

const entry = (
  threadId: string,
  overrides: Partial<InterruptedQueueEntry> = {},
): InterruptedQueueEntry => ({
  hostId: "local",
  threadId,
  turnId: `${threadId}-turn`,
  title: threadId,
  status: "failed",
  ...overrides,
});

const health = (healthy: boolean): BuddyHealth => ({
  supported: true,
  healthy,
  checkedAt: Date.now(),
  status: healthy ? 200 : 503,
  reason: healthy ? null : "HTTP 503",
  providers: [],
});

function fixture(candidates: InterruptedQueueEntry[]) {
  const states: AutoResumeState[] = [];
  const probe = vi.fn(async () => health(false));
  const resume = vi.fn<(entries: InterruptedQueueEntry[]) => Promise<void>>(async () => {});
  const auto = createAutoResume({
    enabled: () => true,
    busy: () => false,
    candidates: () => candidates,
    probe,
    resume,
    onChange: (state) => states.push(state),
  });
  return { auto, probe, resume, states };
}

afterEach(() => vi.useRealTimers());

describe("automatic interrupted resume", () => {
  it("waits while the gateway is unhealthy and resumes after it recovers", async () => {
    vi.useFakeTimers();
    const candidates = [entry("one")];
    const f = fixture(candidates);
    f.probe.mockImplementation(async () => health(false));

    f.auto.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.probe).toHaveBeenCalledTimes(1);
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toMatchObject({ health: "unhealthy", pending: 1 });

    await vi.advanceTimersByTimeAsync(AUTO_RESUME_PROBE_INTERVAL_MS);
    expect(f.probe).toHaveBeenCalledTimes(2);
    expect(f.resume).not.toHaveBeenCalled();

    f.probe.mockImplementation(async () => health(true));
    f.resume.mockImplementation(async () => {
      candidates.splice(0, candidates.length);
    });
    await vi.advanceTimersByTimeAsync(AUTO_RESUME_PROBE_INTERVAL_MS);
    expect(f.probe).toHaveBeenCalledTimes(3);
    expect(f.resume).toHaveBeenCalledTimes(1);
    expect(f.resume.mock.calls[0]?.[0]?.map((value) => value.threadId)).toEqual(["one"]);
    expect(f.states.at(-1)).toMatchObject({ health: "healthy", pending: 0 });
    f.auto.dispose();
  });

  it("retries a still-pending turn while health remains healthy", async () => {
    vi.useFakeTimers();
    const candidates = [entry("one")];
    const f = fixture(candidates);
    f.probe.mockImplementation(async () => health(true));
    let attempts = 0;
    f.resume.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 3) candidates.splice(0, candidates.length);
    });

    f.auto.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.resume).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTO_RESUME_PROBE_INTERVAL_MS);
    expect(f.resume).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(AUTO_RESUME_PROBE_INTERVAL_MS);
    expect(f.resume).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(AUTO_RESUME_PROBE_INTERVAL_MS);
    expect(f.resume).toHaveBeenCalledTimes(3);
    f.auto.dispose();
  });

  it("ignores cancelled turns and turns that exhausted automatic attempts", async () => {
    vi.useFakeTimers();
    const candidates = [
      entry("cancelled", { status: "cancelled" }),
      entry("exhausted", { autoResumeAttempts: AUTO_RESUME_MAX_ATTEMPTS }),
    ];
    const f = fixture(candidates);

    f.auto.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toMatchObject({ pending: 0, exhausted: 1 });
    f.auto.dispose();
  });

  it("keeps the exhausted budget across the turns created by continuation", async () => {
    vi.useFakeTimers();
    const candidates = [entry("limited", { autoResumeAttempts: AUTO_RESUME_MAX_ATTEMPTS - 1 })];
    const f = fixture(candidates);
    f.probe.mockImplementation(async () => health(true));
    f.resume.mockImplementation(async () => {
      // 续接提交会换一个 turnId，并在新一轮里再次失败；预算继续累计。
      candidates.splice(
        0,
        1,
        entry("limited", {
          turnId: "continued-turn",
          autoResumeAttempts: AUTO_RESUME_MAX_ATTEMPTS,
        }),
      );
    });

    f.auto.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.resume).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTO_RESUME_PROBE_INTERVAL_MS);
    expect(f.resume).toHaveBeenCalledTimes(1);
    expect(f.states.at(-1)).toMatchObject({ pending: 0, exhausted: 1 });
    f.auto.dispose();
  });

  it("does not renew the budget just because time passed", async () => {
    vi.useFakeTimers();
    const candidates = [entry("limited", { autoResumeAttempts: AUTO_RESUME_MAX_ATTEMPTS })];
    const f = fixture(candidates);
    f.probe.mockImplementation(async () => health(true));

    f.auto.update();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    f.auto.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.resume).not.toHaveBeenCalled();
    f.auto.dispose();
  });

  it("never auto-resumes a turn whose history cannot be decrypted", async () => {
    vi.useFakeTimers();
    const f = fixture([entry("broken", { autoResumeBlocked: "undecryptable-history" })]);
    f.probe.mockImplementation(async () => health(true));

    f.auto.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toMatchObject({ pending: 0, exhausted: 1 });
    f.auto.dispose();
  });

  it("stops polling when the Host reports no health support", async () => {
    vi.useFakeTimers();
    const f = fixture([entry("one")]);
    f.probe.mockResolvedValue({ ...health(false), supported: false });

    f.auto.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.states.at(-1)).toMatchObject({ supported: false, health: "unknown" });
    await vi.advanceTimersByTimeAsync(AUTO_RESUME_PROBE_INTERVAL_MS);
    expect(f.probe).toHaveBeenCalledTimes(1);
    f.auto.dispose();
  });
});
