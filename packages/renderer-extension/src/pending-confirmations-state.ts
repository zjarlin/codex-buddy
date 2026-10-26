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
  project?: string;
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
  project?: string;
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

/** 单行文本（标题、失败原因首行）折叠所有空白，保证列表与卡片标题不被换行撑开。 */
function compact(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

/**
 * 最终消息保留 Markdown 块结构：逐行去掉行尾空白、把连续空行压成一个空行，
 * 但绝不把换行折叠成空格，否则标题、列表、表格会塌成一段。超长时按原文截断，
 * 并补齐未闭合的代码围栏，避免截断处破坏渲染。
 */
function summarize(value: string, limit: number): string {
  const lines = value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""));
  const kept: string[] = [];
  let blank = true;
  for (const line of lines) {
    if (line.length === 0) {
      if (blank) continue;
      blank = true;
    } else {
      blank = false;
    }
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  const text = kept.join("\n").trim();
  if (text.length <= limit) return text;
  const fencesIn = (value: string): number => (value.match(/^```/gmu) ?? []).length;
  let cut = text.slice(0, limit - 1);
  if (fencesIn(cut) % 2 === 1) {
    cut = text.slice(0, Math.max(0, limit - 5));
    return fencesIn(cut) % 2 === 1 ? `${cut}\n\`\`\`…` : `${cut}…`;
  }
  return `${cut}…`;
}

export function pendingConfirmationStatus(value: unknown): PendingConfirmationStatus | null {
  if (value === "completed" || value === "succeeded") return "completed";
  if (value === "failed") return "failed";
  if (value === "interrupted" || value === "cancelled") return "interrupted";
  return null;
}

export function pendingConfirmationSummary(
  turn: Pick<PendingConfirmationTurn, "items" | "error" | "status">,
): string {
  const items = Array.isArray(turn.items) ? turn.items : [];
  const agent = items.findLast(
    (value): value is Record<string, unknown> =>
      record(value)?.type === "agentMessage" && text(record(value)?.text).trim().length > 0,
  );
  // 标题生成的 JSON 是内部元数据，不能作为“结果”展示给用户。
  if (agent && !isTitleGenerationPayload(text(agent.text)))
    return summarize(text(agent.text), 2_000);
  const error = record(turn.error);
  if (error) return compact(text(error.message) || text(error.code), 2_000);
  if (pendingConfirmationStatus(turn.status) === "failed")
    return "会话执行失败，未返回可展示的结果。";
  if (pendingConfirmationStatus(turn.status) === "interrupted")
    return "会话已中断，未返回可展示的结果。";
  return "会话已完成，但未返回可展示的文字结果。";
}

// Codex names a Thread with a background Turn produced by its native
// ThreadMetadataGenerationService. That Turn's only agent message is a small
// JSON object such as {"title":"...","description":"..."}. It is internal
// housekeeping rather than user-initiated work, so it must not enter the
// pending-confirmation queue.
const TITLE_GENERATION_FIELDS = new Set(["title", "description"]);

function stripCodeFence(value: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(value.trim());
  return (fenced?.[1] ?? value).trim();
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const candidate = stripCodeFence(value);
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  try {
    return record(JSON.parse(candidate));
  } catch {
    return null;
  }
}

/**
 * 标题生成要求返回 {"title","description"} JSON，但模型也可能按提示词里的字段名
 * 直接回两行纯文本（实际出现：`Title: …` / `Description: …`）。两种形状都是内部
 * 元数据，不能当成用户回合结果。
 */
const TITLE_LABEL_PATTERN = /^title\s*[:：]\s*(.+)$/iu;
const DESCRIPTION_LABEL_PATTERN = /^description\s*[:：]\s*(.+)$/iu;

/** 去掉列表符号与强调符，只保留 `Title: …` 这类字段行本身。 */
function labeledLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*+>]+|#{1,6})\s*/u, "")
    .replace(/\*\*/gu, "")
    .trim();
}

function isLabeledTitlePayload(value: string): boolean {
  const lines = stripCodeFence(value)
    .split("\n")
    .map(labeledLine)
    .filter((line) => line.length > 0);
  if (lines.length !== 2) return false;
  const title = TITLE_LABEL_PATTERN.exec(lines[0] ?? "");
  const description = DESCRIPTION_LABEL_PATTERN.exec(lines[1] ?? "");
  return Boolean(title?.[1]?.trim() && description?.[1]?.trim());
}

// 正在生成标题的 Thread 在命名完成前没有标题，侧栏按钮的 textContent 只有打字机
// 状态的点阵；它不是会话名，不能钉进待确认卡片，否则会盖住真实会话标题。
const PLACEHOLDER_TITLE = /^[\s.…·•]+$/u;

export function pendingConfirmationTitle(value: string): string {
  // 命名完成前侧栏按钮只有 1–3 个点阵字符；空白与这类占位都不是真实会话名。
  if (!value.trim() || (value.length <= 3 && PLACEHOLDER_TITLE.test(value))) return "";
  return value;
}

export function isTitleGenerationPayload(value: string): boolean {
  if (isLabeledTitlePayload(value)) return true;
  const object = parseJsonObject(value);
  if (!object) return false;
  const keys = Object.keys(object);
  if (keys.length === 0 || !keys.every((key) => TITLE_GENERATION_FIELDS.has(key))) return false;
  if (!text(object.title).trim()) return false;
  if (object.description !== undefined && typeof object.description !== "string") return false;
  return true;
}

export function isMetadataTitleTurn(turn: Pick<PendingConfirmationTurn, "items">): boolean {
  const items = Array.isArray(turn.items) ? turn.items : [];
  const agent = items.findLast(
    (value): value is Record<string, unknown> =>
      record(value)?.type === "agentMessage" && text(record(value)?.text).trim().length > 0,
  );
  if (!agent) return false;
  return isTitleGenerationPayload(text(agent.text));
}

function normalizeStored(value: unknown): PendingConfirmationRecord | null {
  const entry = record(value);
  if (!entry) return null;
  const hostId = text(entry.hostId);
  const threadId = text(entry.threadId);
  const turnId = text(entry.turnId);
  const status = pendingConfirmationStatus(entry.status);
  const state = entry.state === "confirmed" || entry.state === "pending" ? entry.state : null;
  if (!hostId || !threadId || !turnId || !status || !state) return null;
  // 旧版本可能已经把标题生成的元数据存进队列；升级读取时直接丢弃，避免再弹一次。
  const summary = summarize(text(entry.summary), 2_000);
  if (isTitleGenerationPayload(summary)) return null;
  return {
    hostId,
    threadId,
    turnId,
    status,
    title: compact(pendingConfirmationTitle(text(entry.title)) || "未命名会话", 300),
    summary,
    project: text(entry.project),
    completedAt: timestamp(entry.completedAt, 0),
    state,
    confirmedAt: state === "confirmed" ? timestamp(entry.confirmedAt, Date.now()) : null,
  };
}

function sameEntries(
  left: readonly PendingConfirmationRecord[],
  right: readonly PendingConfirmationRecord[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      key(entry) === key(other) &&
      entry.state === other.state &&
      entry.confirmedAt === other.confirmedAt &&
      entry.completedAt === other.completedAt
    );
  });
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
        value.entries
          .map(normalizeStored)
          .filter((entry): entry is PendingConfirmationRecord => entry !== null),
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
      (entry) =>
        entry.state === "pending" && entry.hostId === hostId && entry.threadId === threadId,
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
      project: text(value.project) || text(value.cwd) || text(thread?.cwd),
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
    if (isMetadataTitleTurn(input)) return null;
    const next: PendingConfirmationRecord = {
      hostId,
      threadId,
      turnId,
      status,
      title: compact(pendingConfirmationTitle(input.title) || "未命名会话", 300),
      summary: pendingConfirmationSummary({ ...input, status }),
      project: input.project ?? "",
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
      (entry) =>
        key(entry) !== nextKey && !(threadKey(entry) === thread && entry.state === "pending"),
    );
    this.#entries.push(next);
    this.#entries = prunePendingConfirmations(this.#entries);
    this.#write();
    this.#publish();
    return next;
  }

  /** 标题生成完成后把占位标题换成真实名称，不改变已读状态与顺序。 */
  retitle(
    entry: Pick<PendingConfirmationRecord, "hostId" | "threadId" | "turnId">,
    title: string,
  ): boolean {
    const next = compact(pendingConfirmationTitle(title), 300);
    if (!next) return false;
    const current = this.#entries.find((candidate) => key(candidate) === key(entry));
    if (!current || current.title === next) return false;
    current.title = next;
    this.#write();
    this.#publish();
    return true;
  }

  /**
   * 同一 Thread 上更新的 Turn 开始后，旧终态不再单独占位：新 Turn 结束时会
   * 用自己的结果替换它。调用方只能在与用户当前查看的会话一致时调用，否则重连
   * 或中断恢复自动续跑会把还没看过的提醒顶掉。
   */
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
    const current = index < 0 ? undefined : this.#entries[index];
    if (!current || current.state === "confirmed") return false;
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

  /**
   * 其他窗口确认后重新读取存储，避免本窗口用内存里的旧快照把已读覆盖回待确认。
   * 只在 storage 事件里调用；读取失败时保持当前内存状态。
   */
  reload(): boolean {
    if (!this.storage) return false;
    const next = this.#read();
    if (sameEntries(this.#entries, next)) return false;
    this.#entries = next;
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
