/**
 * “在文件夹中新建会话”的待定归类。
 *
 * Desktop 的新建会话入口属于项目，不认识扩展的文件夹；因此从文件夹里新建时先
 * 记录一个意图：调用原生项目入口打开新会话，再把随后出现的会话归入该文件夹。
 * 归类需要身份，而身份只能从原生侧栏行上读：未提交的草稿用 `client-new-thread:`
 * 草稿身份，提交后换成原生 Thread ID。
 *
 * 判定只在新组合唯一时成立：点击后恰好新出现一个草稿就绑定它；绑定的草稿消失
 * 且同时恰好新出现一个已物化会话时，认定这次提交属于该会话。出现多个新会话无
 * 法判定具体对象，直接放弃意图而不是猜。意图都有时限：未绑定到草稿的意图、以及
 * 草稿消失后仍看不到新会话的意图都会过期，避免之后把无关会话误归入文件夹；过期
 * 后会话只是不自动归类，仍可在侧栏右键手动移动。
 */

export interface PendingThreadRow {
  /** 行身份：已物化会话用原生 Thread ID，草稿用草稿身份。 */
  key: string;
  /** 该行是否为未提交的新会话草稿。 */
  draft: boolean;
}

export interface PendingThreadOutcome {
  /** 本次观察新绑定到意图的草稿身份。 */
  boundDraft: string | null;
  /** 需要写入文件夹归类的已物化会话。 */
  assigned: { folderId: string; threadId: string } | null;
  /** 意图已被放弃（歧义、过期或草稿被替换）。 */
  dropped: boolean;
}

export interface PendingFolderThreads {
  /** 记录“刚在 folderId 中打开了新会话”，并快照该项目当时的行身份。 */
  begin(
    projectKey: string,
    folderId: string,
    rows: readonly PendingThreadRow[],
    now?: number,
  ): void;
  /** 用最新观察推进意图，返回本次需要落地的动作。 */
  observe(
    projectKey: string,
    rows: readonly PendingThreadRow[],
    now?: number,
  ): PendingThreadOutcome;
  /** 草稿当前归属的文件夹；未绑定或不是该草稿时返回 null。 */
  folderFor(projectKey: string, draftKey: string): string | null;
  /** 意图的当前形态，用于投影签名；首次绑定草稿后变化一次。 */
  state(projectKey: string): { draftKey: string | null; folderId: string } | null;
  cancel(projectKey: string): void;
  clear(): void;
}

/** 未绑定到草稿的意图保留时长：原生可能根本没有渲染草稿行。 */
const UNBOUND_TTL_MS = 5 * 60 * 1000;
/**
 * 已绑定草稿消失后的等待时长。行身份切换（草稿换成原生 Thread ID）通常在同一
 * 次渲染里完成，这里是留给中间态的余量；超出后不再等待，宁可让会话留在原生
 * 列表里手动归类，也不把之后出现的无关会话误归入文件夹。
 */
const BOUND_DRAFT_GRACE_MS = 60 * 1000;

interface Intent {
  folderId: string;
  known: Set<string>;
  draftKey: string | null;
  startedAt: number;
  missingSince: number | null;
}

const NONE: PendingThreadOutcome = { boundDraft: null, assigned: null, dropped: false };

export function createPendingFolderThreads(): PendingFolderThreads {
  const intents = new Map<string, Intent>();
  const fresh = (intent: Intent, rows: readonly PendingThreadRow[], draft: boolean): string[] =>
    rows.filter((row) => row.draft === draft && !intent.known.has(row.key)).map((row) => row.key);

  return {
    begin(projectKey, folderId, rows, now = Date.now()) {
      intents.set(projectKey, {
        folderId,
        known: new Set(rows.map((row) => row.key)),
        draftKey: null,
        startedAt: now,
        missingSince: null,
      });
    },
    observe(projectKey, rows, now = Date.now()) {
      const intent = intents.get(projectKey);
      if (!intent) return NONE;
      const drop = (): PendingThreadOutcome => {
        intents.delete(projectKey);
        return { boundDraft: null, assigned: null, dropped: true };
      };
      const assign = (threadId: string): PendingThreadOutcome => {
        intents.delete(projectKey);
        return {
          boundDraft: null,
          assigned: { folderId: intent.folderId, threadId },
          dropped: false,
        };
      };
      if (intent.draftKey === null) {
        if (now - intent.startedAt > UNBOUND_TTL_MS) return drop();
        const drafts = fresh(intent, rows, true);
        const threads = fresh(intent, rows, false);
        if (drafts.length === 1 && threads.length === 0) {
          const boundDraft = drafts[0] ?? null;
          intent.draftKey = boundDraft;
          if (boundDraft) intent.known.add(boundDraft);
          return { boundDraft, assigned: null, dropped: false };
        }
        if (drafts.length === 0 && threads.length === 1) return assign(threads[0] ?? "");
        // 同时出现多个候选，或出现候选以外的意外组合时无法判定对象。
        return drafts.length === 0 && threads.length === 0 ? NONE : drop();
      }
      if (rows.some((row) => row.draft && row.key === intent.draftKey)) {
        intent.missingSince = null;
        // 草稿仍在时出现的行属于其他会话（或其他客户端），不能算本次提交的
        // 候选，否则草稿消失时会同时看到多个“新”会话而误判为歧义。
        intent.known = new Set(rows.map((row) => row.key));
        intent.known.add(intent.draftKey);
        return NONE;
      }
      const threads = fresh(intent, rows, false);
      // 已绑定的草稿消失，且同时只新出现一个已物化会话：这次提交就是它。
      // 其余新草稿与此无关（用户可能又开了一个），不影响判定。
      if (threads.length === 1) return assign(threads[0] ?? "");
      // 同时出现多个已物化会话时无法判定具体对象。
      if (threads.length > 1) return drop();
      // 尚未看到新会话：可能是行身份切换的中间态，也可能是项目行未渲染
      // （折叠或分页）。给一段有限时间，超时即放弃，避免误归类无关会话。
      intent.missingSince ??= now;
      return now - intent.missingSince > BOUND_DRAFT_GRACE_MS ? drop() : NONE;
    },
    folderFor(projectKey, draftKey) {
      const intent = intents.get(projectKey);
      return intent && intent.draftKey === draftKey ? intent.folderId : null;
    },
    state(projectKey) {
      const intent = intents.get(projectKey);
      return intent ? { draftKey: intent.draftKey, folderId: intent.folderId } : null;
    },
    cancel(projectKey) {
      intents.delete(projectKey);
    },
    clear() {
      intents.clear();
    },
  };
}
