import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import { EDITOR_SELECTOR } from "./renderer-composer-dom.js";
import { composerDraftWorkspace } from "./renderer-composer-workspace.js";
import { openRendererThread } from "./renderer-fork-control.js";
import { insertNativeTextAtSelection } from "./renderer-native-composer-controller.js";
import { threadIdFromComposerModelTarget } from "./versioned-renderer-adapter.js";
import type { RendererModelClient } from "./renderer-model-client.js";
import { showSessionPicker } from "./renderer-session-picker.js";
import {
  assertTransferableSessionDraft,
  hasSessionAttachments,
  sessionDraftCleanup,
  sessionDraftText,
  sessionProjects,
} from "./renderer-session-targets.js";

interface SessionComposer {
  composer: Element;
  hostId: string | null;
  modelTarget: readonly unknown[] | null;
  ownershipStatus: string;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 防呆选择与原生草稿转移共享生命周期；关闭窗口或换连接后不继续发送。 */
export function createSessionRouting<M extends SessionComposer>(options: {
  mounted: ReadonlyMap<Element, M>;
  activeHostId(): string | null;
  client(hostId: string): RendererModelClient | null;
  locale(): string;
  send(mounted: M): void;
  clearPending(mounted: M): void;
}) {
  let disposed = false;
  const replayingSubmissions = new WeakSet<Element>();
  const sessionRoutePending = new WeakMap<Element, ReturnType<typeof showSessionPicker>>();
  const replayDraftSubmission = (mounted: M): void => {
    replayingSubmissions.add(mounted.composer);
    try {
      options.send(mounted);
    } finally {
      replayingSubmissions.delete(mounted.composer);
    }
  };

  const sessionPickerControllers = new Set<AbortController>();
  const choose = (mounted: M, message: string): Promise<void> => {
    const existing = sessionRoutePending.get(mounted.composer);
    if (existing) {
      existing.confirm();
      return existing.closed;
    }
    options.clearPending(mounted);
    const threadId = threadIdFromComposerModelTarget(mounted.modelTarget);
    const hostId = mounted.hostId ?? options.activeHostId();
    const client = hostId ? options.client(hostId) : null;
    const route = hostId ? window.__codexhostHostRoutingV1?.forHost?.(hostId) : null;
    const manager = route?.manager as unknown as
      | {
          getConversationCwd?(threadId: string): unknown;
          sendRequest?(method: string, params: unknown): Promise<unknown>;
        }
      | undefined;
    const readWorkspace = (): string | undefined => {
      const workspace = threadId
        ? manager?.getConversationCwd?.(threadId)
        : hostId
          ? composerDraftWorkspace(mounted.composer, hostId)
          : undefined;
      return typeof workspace === "string" && workspace ? workspace : undefined;
    };
    const cwd = readWorkspace();
    const modelTarget = JSON.stringify(mounted.modelTarget);
    const editor = mounted.composer.querySelector<HTMLElement>(EDITOR_SELECTOR);
    const draftFingerprint = () =>
      JSON.stringify([
        editor?.innerHTML,
        editor?.tagName === "TEXTAREA" ? (editor as HTMLTextAreaElement).value : null,
        [
          ...mounted.composer.querySelectorAll(
            "[data-composer-attachments-row], [data-appshot-attachment]",
          ),
        ].map((element) => element.outerHTML),
      ]);
    const abort = new AbortController();
    sessionPickerControllers.add(abort);
    const sameConnection = (): boolean =>
      !disposed &&
      !abort.signal.aborted &&
      (hostId ? options.client(hostId) : null) === client &&
      options.activeHostId() === hostId &&
      (hostId ? window.__codexhostHostRoutingV1?.forHost?.(hostId)?.manager : undefined) ===
        route?.manager;
    const isCurrent = (): boolean =>
      sameConnection() &&
      mounted.composer.isConnected &&
      options.mounted.get(mounted.composer) === mounted &&
      mounted.composer.querySelector(EDITOR_SELECTOR) === editor &&
      JSON.stringify(mounted.modelTarget) === modelTarget &&
      readWorkspace() === cwd;
    const captureTransferDraft = () => {
      if (!editor || !isCurrent()) {
        throw new Error("会话已变化，请重新选择");
      }
      const message = sessionDraftText(editor);
      if (!message.trim()) {
        throw new Error("请输入消息后再发送");
      }
      assertTransferableSessionDraft(mounted.composer, editor);
      return {
        message,
        fingerprint: draftFingerprint(),
        clearSource: sessionDraftCleanup(editor),
      };
    };
    const waitForTarget = (matches: (target: M) => boolean): Promise<M> =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const poll = (): void => {
          if (!sameConnection()) {
            reject(new Error("Host 或连接已变化，未发送消息"));
            return;
          }
          for (const target of options.mounted.values()) {
            if (target.composer.isConnected && target.hostId === hostId && matches(target)) {
              resolve(target);
              return;
            }
          }
          if (Date.now() - started >= 5_000) {
            reject(new Error("目标会话输入框尚未就绪，草稿已保留"));
            return;
          }
          window.setTimeout(poll, 50);
        };
        poll();
      });
    const transfer = async (
      draft: ReturnType<typeof captureTransferDraft>,
      open: () => void | Promise<void>,
      matches: (target: M) => boolean,
    ): Promise<void> => {
      if (!isCurrent() || draftFingerprint() !== draft.fingerprint) {
        throw new Error("会话或草稿已变化，请重新选择");
      }
      const { message, clearSource } = draft;
      await open();
      const target = await waitForTarget(matches);
      // Desktop 可能复用输入框；切到目标后，不能将目标正文当成来源草稿校验。
      if (isCurrent() && draftFingerprint() !== draft.fingerprint) {
        throw new Error("来源草稿已变化，未发送消息");
      }
      const targetEditor = target.composer.querySelector<HTMLElement>(EDITOR_SELECTOR);
      if (
        !targetEditor ||
        sessionDraftText(targetEditor).trim() ||
        hasSessionAttachments(target.composer)
      ) {
        throw new Error("目标会话已有草稿，未覆盖或发送任何内容");
      }
      if (!insertNativeTextAtSelection(targetEditor, () => message)) {
        throw new Error("无法填入目标会话，来源草稿已保留");
      }
      // 等待原生编辑器更新发送按钮，再使用目标自身的配置发送。
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (
        !sameConnection() ||
        !targetEditor.isConnected ||
        options.mounted.get(target.composer) !== target ||
        !matches(target) ||
        (isCurrent() && draftFingerprint() !== draft.fingerprint) ||
        sessionDraftText(targetEditor) !== message
      ) {
        throw new Error("目标会话或草稿已变化，未发送消息");
      }
      replayDraftSubmission(target);
      const started = Date.now();
      await new Promise<void>((resolve, reject) => {
        const poll = (): void => {
          if (!sameConnection()) {
            reject(new Error("连接已变化，请核对目标会话发送结果"));
            return;
          }
          if (targetEditor.isConnected && !sessionDraftText(targetEditor).trim()) {
            clearSource();
            resolve();
            return;
          }
          if (Date.now() - started >= 5_000) {
            reject(new Error("目标会话尚未确认发送，草稿已保留，请核对后再发送"));
            return;
          }
          window.setTimeout(poll, 50);
        };
        poll();
      });
    };
    const picker = showSessionPicker({
      locale: options.locale(),
      composer: mounted.composer,
      hostId: hostId ?? "",
      ...(cwd ? { cwd } : {}),
      threadId,
      projects: hostId ? sessionProjects(hostId) : [],
      signal: abort.signal,
      isCurrent,
      loadCandidates: async () => {
        if (!client?.routeSession) throw new Error("近期会话接口不可用");
        const result = await client.routeSession({ message: message.slice(0, 12_000), cwd });
        return result.candidates;
      },
      sendCurrent: () => {
        if (!sessionDraftText(editor).trim() && !hasSessionAttachments(mounted.composer)) {
          throw new Error("请输入消息后再发送");
        }
        replayDraftSubmission(mounted);
      },
      sendNew: (project) =>
        transfer(
          captureTransferDraft(),
          project.open,
          (target) =>
            target.modelTarget?.[0] === "default" &&
            JSON.stringify(target.modelTarget) !== modelTarget &&
            composerDraftWorkspace(target.composer, project.hostId) === project.cwd,
        ),
      sendExisting: async (candidate) => {
        const draft = captureTransferDraft();
        if (!manager?.sendRequest) throw new Error("无法核对目标会话运行状态");
        const response = await manager.sendRequest("thread/read", {
          threadId: candidate.threadId,
          includeTurns: true,
        });
        const thread = isRecord(response) && isRecord(response.thread) ? response.thread : null;
        const turns = thread && Array.isArray(thread.turns) ? thread.turns : [];
        const turn = turns.at(-1);
        if (
          !thread ||
          thread.id !== candidate.threadId ||
          thread.canAcceptDirectInput === false ||
          thread.cwd !== candidate.cwd ||
          (isRecord(thread.status) && thread.status.type === "active") ||
          !isRecord(turn) ||
          !["completed", "succeeded"].includes(String(turn.status))
        ) {
          throw new Error("目标会话已不处于完成状态，请重新选择");
        }
        await transfer(
          draft,
          () =>
            openRendererThread(hostThreadIdSchema.parse(candidate.threadId), {
              ...(hostId ? { hostId } : {}),
              signal: abort.signal,
            }),
          (target) =>
            threadIdFromComposerModelTarget(target.modelTarget) === candidate.threadId &&
            target.ownershipStatus === "ready",
        );
      },
    });
    const operation = picker.closed.finally(() => {
      sessionRoutePending.delete(mounted.composer);
      sessionPickerControllers.delete(abort);
      options.clearPending(mounted);
    });
    sessionRoutePending.set(mounted.composer, { closed: operation, confirm: picker.confirm });
    return operation;
  };

  return {
    choose,
    isReplaying: (composer: Element) => replayingSubmissions.has(composer),
    dispose() {
      disposed = true;
      for (const abort of sessionPickerControllers) {
        abort.abort();
      }
    },
  };
}
