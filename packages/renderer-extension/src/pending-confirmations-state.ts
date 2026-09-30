export const PENDING_CONFIRMATIONS_STORAGE_KEY = "codexhost.pending-confirmations.v1";
export const PENDING_CONFIRMATIONS_LIMIT = 200;

export type PendingConfirmationStatus = "completed" | "failed" | "interrupted";
export type PendingConfirmationState = "pending" | "confirmed";

export interface PendingConfirmationRecord {
  hostId: string;
  threadId: string;
  turnId: string;
  status: PendingConfirmationStatus;
  title: string;
  summary: string;
  completedAt: number;
  state: PendingConfirmationState;
  confirmedAt: number | null;
}

export interface PendingConfirmationStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PendingConfirmationTurn {
  hostId: string;
  threadId: string;
  title: string;
  turnId: string;
  status: unknown;
  items?: unknown;
  completedAt?: unknown;
  error?: unknown;
}

interface StoredPendingConfirmationsV1 {
  version: 1;
  entries: PendingConfirmationRecord[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown, fallback: number): number {
  const parsed = finiteNumber(value);
  if (parsed === null) return fallback;
  return parsed < 10_000_000_000 ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
}

function compact(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

export function pendingConfirmationStatus(value: unknown): PendingConfirmationStatus | null {
  if (value === "completed" || value === "succeeded") return "completed";
  if (value === "failed") return "failed";
  if (value === "interrupted" || value === "cancelled") return "interrupted";
  return null;
}

function itemText(item: Record<string, unknown>): string {
  if (item.type === "agentMessage") return text(item.text).trim();
  const content = Array.isArray(item.content) ? item.content : [];
  if (item.type === "userMessage") {
    return content
      .map((entry) => {
        const value = record(entry);
        return value?.type === "text" ? text(value.text) : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

export function pendingConfirmationSummary(
  turn: Pick<PendingConfirmationTurn, "items" | "error" | "status">,
): string {
  const items = Array.isArray(turn.items) ? turn.items : [];
  const agent = items.findLast(
    (value): value is Record<string, unknown> =>
      record(value)?.type === "agentMessage" && text(record(value)?.text).trim().length > 0,
  );
  if (agent) return compact(text(agent.text), 2_000);
  const error = record(turn.error);
  if (error) return compact(text(error.message) || text(error.code), 2_000);
  if (pendingConfirmationStatus(turn.status) === "failed") return "会话执行失败，未返回可展示的结果。";
  if (pendingConfirmationStatus(turn.status) === "interrupted") return "会话已中断，未返回可展示的结果。";
  return "会话已完成，但未返回可展示的文字结果。";
}

function normalizeStored(value: unknown): PendingConfirmationRecord | null {
  const entry = record(value);
  if (!entry) return null;
  const hostId = text(entry.hostId);
  const threadId = text(entry.threadId);
  const turnId = text(entry.turnId);
  const status = pendingConfirmationStatus(entry.status);
  const state =
    entry.state === "confirmed" || entry.state === "pending" ? entry.state : null;
  if (!hostId || !threadId || !turnId || !status || !state) return null;
  return {
    hostId,
    threadId,
    turnId,
    status,
    title: compact(text(entry.title) || "未命名会话", 300),
    summary: compact(text(entry.summary), 2_000),
    completedAt: timestamp(entry.completedAt, 0),
    state,
    confirmedAt:
      state === "confirmed" ? timestamp(entry.confirmedAt, Date.now()) : null,
  };
}

function key(entry: Pick<PendingConfirmationRecord, "hostId" | "threadId" | "turnId">): string {
  return `${entry.hostId}\u0000${entry.threadId}\u0000${entry.turnId}`;
}

function threadKey(entry: Pick<PendingConfirmationRecord, "hostId" | "threadId">): string {
  return `${entry.hostId}\u0000${entry.threadId}`;
}

function significantStatus(status: PendingConfirmationStatus): number {
  if (status === "failed") return 2;
  if (status === "interrupted") return 1;
  return 0;
}

export function sortPendingConfirmations(
  entries: readonly PendingConfirmationRecord[],
): PendingConfirmationRecord[] {
  return [...entries].sort((left, right) => {
    if (left.state !== right.state) return left.state === "pending" ? -1 : 1;
    if (right.completedAt !== left.completedAt) return right.completedAt - left.completedAt;
    return significantStatus(right.status) - significantStatus(left.status);
  });
}

export function prunePendingConfirmations(
  entries: readonly PendingConfirmationRecord[],
  limit = PENDING_CONFIRMATIONS_LIMIT,
): PendingConfirmationRecord[] {
  const ordered = sortPendingConfirmations(entries);
  const pending = ordered.filter((entry) => entry.state === "pending").slice(0, limit);
  const confirmed = ordered
    .filter((entry) => entry.state === "confirmed")
    .slice(0, Math.max(0, limit - pending.length));
  return [...pending, ...confirmed];
}

export class PendingConfirmationsModel {
  #entries: PendingConfirmationRecord[];
  readonly #listeners = new Set<() => void>();

  constructor(
    readonly storage: PendingConfirmationStore | null = null,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#entries = this.#read();
  }

  #read(): PendingConfirmationRecord[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(PENDING_CONFIRMATIONS_STORAGE_KEY);
      if (!raw) return [];
      const decoded: unknown = JSON.parse(raw);
      const value = record(decoded);
      if (value?.version !== 1 || !Array.isArray(value.entries)) return [];
      return prunePendingConfirmations(
        value.entries.map(normalizeStored).filter((entry): entry is PendingConfirmationRecord => entry !== null),
      );
    } catch {
      return [];
    }
  }

  #write(): void {
    if (!this.storage) return;
    try {
      const value: StoredPendingConfirmationsV1 = { version: 1, entries: this.#entries };
      this.storage.setItem(PENDING_CONFIRMATIONS_STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Storage failure does not block the live queue for this window.
    }
  }

  #publish(): void {
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  entries(): PendingConfirmationRecord[] {
    return [...this.#entries];
  }

  pending(): PendingConfirmationRecord[] {
    return sortPendingConfirmations(this.#entries.filter((entry) => entry.state === "pending"));
  }

  hasPending(hostId: string, threadId: string): boolean {
    return this.#entries.some(
      (entry) => entry.state === "pending" && entry.hostId === hostId && entry.threadId === threadId,
    );
  }

  latestPending(): PendingConfirmationRecord | null {
    return sortPendingConfirmations(this.pending())[0] ?? null;
  }

  link(recordValue: unknown, titleFromEvent?: string): PendingConfirmationRecord | null {
    const value = record(recordValue);
    if (!value) return null;
    const thread = record(value.thread);
    const threadId = text(value.threadId) || text(thread?.id);
    const turn = record(value.turn);
    const turnId = text(value.turnId) || text(turn?.id);
    const status = pendingConfirmationStatus(value.status ?? turn?.status);
    if (!threadId || !turnId || !status) return null;
    const item: PendingConfirmationTurn = {
      hostId: text(value.hostId),
      threadId,
      title:
        titleFromEvent ||
        text(value.title) ||
        text(thread?.name) ||
        text(thread?.title) ||
        "未命名会话",
      turnId,
      status,
      items: value.items ?? turn?.items,
      completedAt: value.completedAt ?? turn?.completedAt,
      error: value.error ?? turn?.error,
    };
    return this.upsert(item);
  }

  upsert(input: PendingConfirmationTurn): PendingConfirmationRecord | null {
    const hostId = input.hostId.trim();
    const threadId = input.threadId.trim();
    const turnId = input.turnId.trim();
    const status = pendingConfirmationStatus(input.status);
    if (!hostId || !threadId || !turnId || !status) return null;
    const next: PendingConfirmationRecord = {
      hostId,
      threadId,
      turnId,
      status,
      title: compact(input.title || "未命名会话", 300),
      summary: pendingConfirmationSummary({ ...input, status }),
      completedAt: timestamp(input.completedAt, this.now()),
      state: "pending",
      confirmedAt: null,
    };
    const nextKey = key(next);
    const thread = threadKey(next);
    const existing = this.#entries.find((entry) => key(entry) === nextKey);
    if (existing) return existing;
    // A newer Turn supersedes the previous pending item for the same Thread.
    this.#entries = this.#entries.filter(
      (entry) => key(entry) !== nextKey && !(threadKey(entry) === thread && entry.state === "pending"),
    );
    this.#entries.push(next);
    this.#entries = prunePendingConfirmations(this.#entries);
    this.#write();
    this.#publish();
    return next;
  }

  startTurn(hostId: string, threadId: string, turnId: string): boolean {
    const before = this.#entries.length;
    this.#entries = this.#entries.filter(
      (entry) =>
        !(
          entry.hostId === hostId &&
          entry.threadId === threadId &&
          entry.state === "pending" &&
          entry.turnId !== turnId
        ),
    );
    if (this.#entries.length === before) return false;
    this.#write();
    this.#publish();
    return true;
  }

  confirm(entry: Pick<PendingConfirmationRecord, "hostId" | "threadId" | "turnId">): boolean {
    const index = this.#entries.findIndex((candidate) => key(candidate) === key(entry));
    if (index < 0 || this.#entries[index]?.state === "confirmed") return false;
    const current = this.#entries[index]!;
    this.#entries[index] = {
      ...current,
      state: "confirmed",
      confirmedAt: this.now(),
    };
    this.#entries = prunePendingConfirmations(this.#entries);
    this.#write();
    this.#publish();
    return true;
  }

  remove(entry: Pick<PendingConfirmationRecord, "hostId" | "threadId" | "turnId">): boolean {
    const before = this.#entries.length;
    this.#entries = this.#entries.filter((candidate) => key(candidate) !== key(entry));
    if (this.#entries.length === before) return false;
    this.#write();
    this.#publish();
    return true;
  }

  merge(fromHostId: string, toHostId: string, threadId: string): boolean {
    if (!fromHostId || !toHostId || fromHostId === toHostId) return false;
    let changed = false;
    this.#entries = this.#entries.map((entry) => {
      if (entry.hostId !== fromHostId || entry.threadId !== threadId) return entry;
      changed = true;
      return { ...entry, hostId: toHostId };
    });
    if (!changed) return false;
    this.#entries = prunePendingConfirmations(this.#entries);
    this.#write();
    this.#publish();
    return true;
  }
}
