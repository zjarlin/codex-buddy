import { GIT_COMMIT_MESSAGE_MAX_LENGTH } from "@codexhost/shared-contracts";

interface Draft {
  revision: string;
  message: string;
  manual: boolean;
}

const STORAGE_KEY = "codexhost.git-message-drafts.v1";
const MAX_ENTRIES = 32;

// 仅保存短消息与内容指纹，不保存 diff；工作区按 Host 和仓库根目录隔离。
export class GitMessageDrafts {
  readonly #drafts = new Map<string, Draft>();
  readonly #attempts = new Map<string, string>();
  readonly #pending = new Set<string>();
  readonly #versions = new Map<string, number>();

  constructor(private readonly storage?: Pick<Storage, "getItem" | "setItem"> | null) {
    try {
      const rows: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
      if (!Array.isArray(rows)) return;
      for (const row of rows.slice(-MAX_ENTRIES)) {
        if (!Array.isArray(row) || typeof row[0] !== "string") continue;
        const value = row[1] as Partial<Draft> | null;
        if (
          !value ||
          typeof value.revision !== "string" ||
          typeof value.message !== "string" ||
          value.message.length > GIT_COMMIT_MESSAGE_MAX_LENGTH ||
          typeof value.manual !== "boolean"
        )
          continue;
        this.#drafts.set(row[0], value as Draft);
      }
    } catch {
      // 存储不可用时仍保留当前窗口内的草稿。
    }
  }

  read(key: string, revision: string): string {
    const draft = this.#drafts.get(key);
    return draft && (draft.manual || draft.revision === revision) ? draft.message : "";
  }

  pending(key: string): boolean {
    return this.#pending.has(key);
  }

  shouldGenerate(key: string, revision: string): boolean {
    const draft = this.#drafts.get(key);
    return (
      !this.#pending.has(key) &&
      !draft?.manual &&
      !(draft?.revision === revision && draft.message) &&
      this.#attempts.get(key) !== revision
    );
  }

  start(key: string, revision: string): number {
    this.#pending.add(key);
    this.#attempts.delete(key);
    this.#attempts.set(key, revision);
    if (this.#attempts.size > MAX_ENTRIES)
      this.#attempts.delete(this.#attempts.keys().next().value ?? "");
    return this.#versions.get(key) ?? 0;
  }

  finish(key: string): void {
    this.#pending.delete(key);
    if (!this.#drafts.has(key)) this.#versions.delete(key);
  }

  complete(key: string, revision: string, message: string, version: number): boolean {
    if ((this.#versions.get(key) ?? 0) !== version) return false;
    this.#save(key, { revision, message, manual: false });
    return true;
  }

  edit(key: string, revision: string, message: string): void {
    this.#versions.set(key, (this.#versions.get(key) ?? 0) + 1);
    this.#save(key, { revision, message, manual: true });
  }

  clear(key: string): void {
    if (this.#pending.has(key)) this.#versions.set(key, (this.#versions.get(key) ?? 0) + 1);
    else this.#versions.delete(key);
    this.#drafts.delete(key);
    this.#attempts.delete(key);
    this.#persist();
  }

  #save(key: string, draft: Draft): void {
    this.#drafts.delete(key);
    this.#drafts.set(key, draft);
    while (this.#drafts.size > MAX_ENTRIES) {
      const oldest = this.#drafts.keys().next().value;
      if (oldest === undefined) break;
      this.#drafts.delete(oldest);
      this.#versions.delete(oldest);
    }
    this.#persist();
  }

  #persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.#drafts]));
    } catch {
      /* 存储配额或隐私限制不影响当前窗口的消息。 */
    }
  }
}
