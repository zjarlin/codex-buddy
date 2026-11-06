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
  const archiveOfficial = vi.fn<
    (threadId: string, cutoffSeconds: number, isCurrent: () => boolean) => Promise<void>
  >(async () => undefined);
  const archiveExternal = vi.fn<
    (threadId: string, cutoffSeconds: number, isCurrent: () => boolean) => Promise<void>
  >(async () => undefined);
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
    expect(f.archiveOfficial).toHaveBeenCalledWith("official-old", cutoff, expect.any(Function));
    expect(f.archiveExternal).toHaveBeenCalledWith("external-old", cutoff, expect.any(Function));
    expect(f.archiveOfficial).not.toHaveBeenCalledWith(
      "external-old",
      cutoff,
      expect.any(Function),
    );
    expect(f.archiveExternal).not.toHaveBeenCalledWith(
      "official-old",
      cutoff,
      expect.any(Function),
    );
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
    expect(f.archiveOfficial).toHaveBeenCalledWith(
      "archive",
      expect.any(Number),
      expect.any(Function),
    );
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
  it.each(["official", "external"] as const)(
    "stops %s archiving when disabled during eligibility I/O",
    async (source) => {
      const f = fixture({ [source]: [{ threadId: "old", recencyAt: 1 }] });
      const entered = Promise.withResolvers<undefined>();
      const ready = Promise.withResolvers<boolean>();
      const canArchive = source === "official" ? f.canArchiveOfficial : f.canArchiveExternal;
      canArchive.mockImplementation(async () => {
        entered.resolve(undefined);
        return ready.promise;
      });
      f.service.configure({ enabled: true, inactiveDays: 1 });
      await entered.promise;
      f.service.configure({ enabled: false, inactiveDays: 1 });
      ready.resolve(true);
      await f.service.drain();
      expect(f.archiveOfficial).not.toHaveBeenCalled();
      expect(f.archiveExternal).not.toHaveBeenCalled();
      f.service.stop();
    },
  );

  it("restarts a pending scan with the new threshold and invalidates admitted callbacks", async () => {
    vi.useFakeTimers();
    const recent = Math.floor(Date.now() / 1_000) - 2 * 86_400;
    const f = fixture({ external: [{ threadId: "two-days-old", recencyAt: recent }] });
    f.canArchiveExternal.mockImplementation(async (_, cutoff) => recent < cutoff);
    const entered = Promise.withResolvers<() => boolean>();
    const release = Promise.withResolvers<undefined>();
    const committed: string[] = [];
    f.archiveExternal.mockImplementation(async (id, _, isCurrent) => {
      entered.resolve(isCurrent);
      await release.promise;
      if (isCurrent()) committed.push(id);
    });
    f.service.configure({ enabled: true, inactiveDays: 1 });
    const isCurrent = await entered.promise;
    f.service.configure({ enabled: true, inactiveDays: 1 });
    expect(isCurrent()).toBe(true);
    f.service.configure({ enabled: true, inactiveDays: 30 });
    expect(isCurrent()).toBe(false);
    release.resolve(undefined);
    await f.service.drain();
    expect(committed).toEqual([]);
    expect(f.listExternal).toHaveBeenCalledTimes(2);
    expect(f.listExternal).toHaveBeenLastCalledWith(Math.floor(Date.now() / 1_000) - 30 * 86_400);
    f.service.stop();
  });

  it("discards an old listing when the threshold changes while scanning", async () => {
    const f = fixture();
    const entered = Promise.withResolvers<undefined>();
    const listing = Promise.withResolvers<ThreadAutoArchiveCandidate[]>();
    f.listExternal.mockImplementationOnce(async () => {
      entered.resolve(undefined);
      return listing.promise;
    });
    f.service.configure({ enabled: true, inactiveDays: 1 });
    await entered.promise;
    f.service.configure({ enabled: true, inactiveDays: 30 });
    listing.resolve([{ threadId: "old-candidate", recencyAt: 1 }]);
    await f.service.drain();
    expect(f.archiveExternal).not.toHaveBeenCalled();
    expect(f.listExternal).toHaveBeenCalledTimes(2);
    f.service.stop();
  });
});
