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
  pasteSessionImages,
  sessionAttachmentSignature,
  sessionDraftCleanup,
  sessionDraftImageCount,
  sessionDraftImagesUploading,
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
  const sessionRoutePending = new WeakMap<Element, Promise<void>>();
  const sessionRouteAbort = new WeakMap<Element, AbortController>();
  const sessionRouteCancel = new WeakMap<Element, () => boolean>();
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
      return existing;
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
    // 图片磁贴会异步补上预览地址，草稿指纹只比对附件身份，避免自我误判为已修改。
    const draftFingerprint = () =>
      JSON.stringify([
        editor?.innerHTML,
        editor?.tagName === "TEXTAREA" ? (editor as HTMLTextAreaElement).value : null,
        sessionAttachmentSignature(mounted.composer),
      ]);
    const abort = new AbortController();
    sessionPickerControllers.add(abort);
    sessionRouteAbort.set(mounted.composer, abort);
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
    const captureTransferDraft = (allowEmpty = false) => {
      if (!editor || !isCurrent()) {
        throw new Error("会话已变化，请重新选择");
      }
      const message = sessionDraftText(editor);
      if (!allowEmpty && !message.trim() && !hasSessionAttachments(mounted.composer)) {
        throw new Error("请输入消息后再发送");
      }
      const images = assertTransferableSessionDraft(mounted.composer, editor);
      return {
        message,
        images,
        fingerprint: draftFingerprint(),
        clearSource: sessionDraftCleanup(editor, mounted.composer, images),
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
      const { message, images, clearSource } = draft;
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
      // 先让目标输入框用自己的粘贴处理登记图片，再写入正文；顺序反过来会让
      // 正文被后续粘贴事件的选区变化挤走。Desktop 经临时文件异步登记图片，
      // 目标草稿确认收下全部图片后才写正文，否则保留来源草稿。
      if (images.length > 0) {
        if (!pasteSessionImages(targetEditor, images)) {
          throw new Error("无法搬移图片附件，来源草稿已保留");
        }
        const started = Date.now();
        const accepted = () =>
          sessionDraftImageCount(target.composer) === images.length &&
          !sessionDraftImagesUploading(target.composer);
        while (!accepted()) {
          // 云模式下 Desktop 还要把图片上传完才允许发送，给足登记时间。
          if (Date.now() - started >= 15_000) {
            throw new Error("目标会话图片附件尚未就绪，来源草稿已保留");
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
        }
      }
      if (message && !insertNativeTextAtSelection(targetEditor, () => message)) {
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
          const settled =
            !sessionDraftText(targetEditor).trim() &&
            // 只有图片的草稿没有正文可判断，改看附件是否被提交清空。
            (message.trim().length > 0 || !hasSessionAttachments(target.composer));
          if (targetEditor.isConnected && settled) {
            // 目标已发出，来源清理失败不应把成功报成失败；残留草稿可继续编辑。
            void clearSource().catch(() => undefined);
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
      threadId,
      projects: hostId ? sessionProjects(hostId) : [],
      signal: abort.signal,
      isCurrent,
      onClosed: () => options.clearPending(mounted),
      loadCandidates: async () => {
        if (!client?.routeSession) throw new Error("近期会话接口不可用");
        const result = await client.routeSession({ message: message.slice(0, 12_000), cwd });
        return result.candidates;
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
          // 与候选筛选一致：已停止（完成/中断/失败/取消）的会话都可续接，仍运行的不可转移。
          !["completed", "succeeded", "interrupted", "failed", "cancelled"].includes(
            String(turn.status),
          )
        ) {
          throw new Error("目标会话已不处于可续接状态，请重新选择");
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
      // 选择器关闭（确认或放弃）后本次提交尝试即结束；不清除会让下一次
      // Enter 一直被当成“仍在发送”，新会话里表现为发送键无响应。
      options.clearPending(mounted);
      sessionRoutePending.delete(mounted.composer);
      sessionRouteAbort.delete(mounted.composer);
      sessionRouteCancel.delete(mounted.composer);
      sessionPickerControllers.delete(abort);
    });
    sessionRoutePending.set(mounted.composer, operation);
    sessionRouteCancel.set(mounted.composer, picker.cancel);
    return operation;
  };

  return {
    choose,
    cancel(mounted: M): boolean {
      return sessionRouteCancel.get(mounted.composer)?.() ?? true;
    },
    isReplaying: (composer: Element) => replayingSubmissions.has(composer),
    dispose() {
      disposed = true;
      for (const abort of sessionPickerControllers) {
        abort.abort();
      }
    },
  };
}
