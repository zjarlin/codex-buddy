import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadAutoArchive, type ThreadAutoArchiveCandidate } from "../src/thread-auto-archive.js";

function fixture(
  input: {
    official?: ThreadAutoArchiveCandidate[];
    external?: ThreadAutoArchiveCandidate[];
    canOfficial?: boolean;
    canExternal?: boolean;
    allowed?: boolean;
  } = {},
) {
  const listOfficial = vi.fn<(cutoffSeconds: number) => Promise<ThreadAutoArchiveCandidate[]>>(
    async () => input.official ?? [],
  );
  const listExternal = vi.fn<(cutoffSeconds: number) => Promise<ThreadAutoArchiveCandidate[]>>(
    async () => input.external ?? [],
  );
  const canArchiveOfficial = vi.fn<(threadId: string, cutoffSeconds: number) => Promise<boolean>>(
    async () => input.canOfficial ?? true,
  );
  const canArchiveExternal = vi.fn<(threadId: string, cutoffSeconds: number) => Promise<boolean>>(
    async () => input.canExternal ?? true,
  );
  const archiveOfficial = vi.fn<(threadId: string, cutoffSeconds: number) => Promise<void>>(
    async () => undefined,
  );
  const archiveExternal = vi.fn<(threadId: string, cutoffSeconds: number) => Promise<void>>(
    async () => undefined,
  );
  const diagnose = vi.fn();
  const service = new ThreadAutoArchive({
    listOfficial,
    listExternal,
    canArchiveOfficial,
    canArchiveExternal,
    archiveOfficial,
    archiveExternal,
    allowed: async () => input.allowed ?? true,
    diagnose,
  });
  return {
    service,
    listOfficial,
    listExternal,
    canArchiveOfficial,
    canArchiveExternal,
    archiveOfficial,
    archiveExternal,
    diagnose,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Thread auto archive", () => {
  it("is disabled by default and validates settings before scheduling", () => {
    vi.useFakeTimers();
    const f = fixture();
    f.service.check();
    expect(f.listOfficial).not.toHaveBeenCalled();
    for (const inactiveDays of [0, 3651, 10.5, NaN, Infinity]) {
      expect(() => f.service.configure({ enabled: true, inactiveDays })).toThrow();
    }
    expect(vi.getTimerCount()).toBe(0);
    f.service.stop();
  });

  it("archives only eligible official and external candidates in separate ownership lanes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T00:00:00.000Z"));
    const f = fixture({
      official: [{ threadId: "official-old", recencyAt: 1 }],
      external: [{ threadId: "external-old", recencyAt: 2 }],
    });
    f.service.configure({ enabled: true, inactiveDays: 30 });
    await f.service.drain();

    const cutoff = Math.floor(Date.parse("2026-09-30T00:00:00.000Z") / 1_000) - 30 * 86_400;
    expect(f.listOfficial).toHaveBeenCalledWith(cutoff);
    expect(f.listExternal).toHaveBeenCalledWith(cutoff);
    expect(f.archiveOfficial).toHaveBeenCalledWith("official-old", cutoff);
    expect(f.archiveExternal).toHaveBeenCalledWith("external-old", cutoff);
    expect(f.archiveOfficial).not.toHaveBeenCalledWith("external-old", cutoff);
    expect(f.archiveExternal).not.toHaveBeenCalledWith("official-old", cutoff);
    f.service.stop();
  });

  it("rechecks eligibility immediately before archiving and isolates failures", async () => {
    vi.useFakeTimers();
    const f = fixture({
      official: [
        { threadId: "skip", recencyAt: 1 },
        { threadId: "fail", recencyAt: 1 },
        { threadId: "archive", recencyAt: 1 },
      ],
      canOfficial: true,
    });
    f.canArchiveOfficial.mockImplementation(async (threadId: string) => threadId !== "skip");
    f.archiveOfficial.mockImplementation(async (threadId: string) => {
      if (threadId === "fail") throw new Error("archive failed");
    });
    f.service.configure({ enabled: true, inactiveDays: 30 });
    await f.service.drain();
    expect(f.archiveOfficial).toHaveBeenCalledTimes(2);
    expect(f.archiveOfficial).toHaveBeenCalledWith("archive", expect.any(Number));
    expect(f.diagnose).toHaveBeenCalledTimes(1);
    f.service.stop();
  });

  it("does not perform background work in privacy mode", async () => {
    const f = fixture({ allowed: false });
    f.service.configure({ enabled: true, inactiveDays: 30 });
    await f.service.drain();
    expect(f.listOfficial).not.toHaveBeenCalled();
    expect(f.listExternal).not.toHaveBeenCalled();
    f.service.stop();
  });
});
