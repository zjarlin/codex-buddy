import {
  DEFAULT_THREAD_AUTO_ARCHIVE_SETTINGS,
  threadAutoArchiveSettingsSchema,
  type ThreadAutoArchiveSettings,
} from "@codexhost/shared-contracts";

const CHECK_INTERVAL_MS = 60 * 60_000;
const DAY_SECONDS = 24 * 60 * 60;

export interface ThreadAutoArchiveCandidate {
  threadId: string;
  recencyAt: number;
}

/**
 * Host-side scheduler for threads that have not been used for a long time.
 * Listing and archive decisions remain callbacks so native and external
 * ownership stay in their existing layers.
 */
export class ThreadAutoArchive {
  #settings: ThreadAutoArchiveSettings = { ...DEFAULT_THREAD_AUTO_ARCHIVE_SETTINGS };
  #timer: NodeJS.Timeout | undefined;
  #checking: Promise<void> | undefined;
  #stopped = false;

  constructor(
    private readonly options: {
      listOfficial(cutoffSeconds: number): Promise<ThreadAutoArchiveCandidate[]>;
      listExternal(cutoffSeconds: number): Promise<ThreadAutoArchiveCandidate[]>;
      canArchiveOfficial(threadId: string, cutoffSeconds: number): Promise<boolean>;
      canArchiveExternal(threadId: string, cutoffSeconds: number): Promise<boolean>;
      archiveOfficial(threadId: string, cutoffSeconds: number): Promise<void>;
      archiveExternal(threadId: string, cutoffSeconds: number): Promise<void>;
      allowed?(): Promise<boolean>;
      diagnose(error: unknown): void;
    },
  ) {}

  configure(value: unknown): ThreadAutoArchiveSettings {
    const settings = threadAutoArchiveSettingsSchema.parse(value);
    if (this.#stopped) throw new Error("Host is shutting down");
    this.#settings = settings;
    if (settings.enabled && !this.#timer) {
      this.#timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
      this.#timer.unref();
      this.check();
    } else if (!settings.enabled && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    return { ...settings };
  }

  check(): void {
    if (this.#stopped || !this.#settings.enabled || this.#checking) return;
    const checking = this.#run()
      .catch((error: unknown) => this.options.diagnose(error))
      .finally(() => {
        if (this.#checking === checking) this.#checking = undefined;
      });
    this.#checking = checking;
  }

  async #run(): Promise<void> {
    const settings = this.#settings;
    if (this.options.allowed && !(await this.options.allowed())) return;
    const cutoffSeconds = Math.floor(Date.now() / 1_000) - settings.inactiveDays * DAY_SECONDS;
    const candidates = new Map<string, { source: "official" | "external"; recencyAt: number }>();
    const discovered = await Promise.allSettled([
      this.options.listOfficial(cutoffSeconds),
      this.options.listExternal(cutoffSeconds),
    ]);
    for (const [index, result] of discovered.entries()) {
      if (result.status === "rejected") {
        this.options.diagnose(result.reason);
        continue;
      }
      const source = index === 0 ? "official" : "external";
      for (const candidate of result.value) {
        const previous = candidates.get(candidate.threadId);
        if (!previous || candidate.recencyAt < previous.recencyAt) {
          candidates.set(candidate.threadId, { source, recencyAt: candidate.recencyAt });
        }
      }
    }
    for (const [threadId, candidate] of candidates) {
      if (this.#stopped || !this.#settings.enabled) return;
      if (this.options.allowed && !(await this.options.allowed())) return;
      try {
        const canArchive =
          candidate.source === "official"
            ? await this.options.canArchiveOfficial(threadId, cutoffSeconds)
            : await this.options.canArchiveExternal(threadId, cutoffSeconds);
        if (!canArchive) continue;
        if (candidate.source === "official") {
          await this.options.archiveOfficial(threadId, cutoffSeconds);
        } else {
          await this.options.archiveExternal(threadId, cutoffSeconds);
        }
      } catch (error) {
        this.options.diagnose(error);
      }
    }
  }

  disable(): void {
    this.#settings = { ...this.#settings, enabled: false };
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  stop(): void {
    this.#stopped = true;
    this.disable();
  }

  async drain(): Promise<void> {
    await this.#checking;
  }
}
