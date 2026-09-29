import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";
import { PROJECT_ROW_SELECTOR, rowProject } from "./project-tabs/native-binding.js";
import { findNativeComposerController } from "./renderer-native-composer-controller.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export interface SessionProject {
  hostId: string;
  cwd: string;
  title: string;
  open(): void;
}

function nativeProjectStart(row: HTMLElement, projectId: string): (() => void) | null {
  for (const element of row.querySelectorAll<HTMLElement>("button")) {
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
    const ancestors = key ? committedReactAncestors(Reflect.get(element, key)) : [];
    const props = ancestors
      .map((fiber) => record(fiber.memoizedProps))
      .find(
        (props) =>
          record(props?.group)?.projectId === projectId &&
          props?.canStartNewThread === true &&
          typeof props.onStartNewThread === "function",
      );
    if (typeof props?.onStartNewThread === "function") {
      return props.onStartNewThread as () => void;
    }
  }
  return null;
}

/** 使用项目行的原生新建入口，让 Desktop 决定项目、Host 和草稿配置。 */
export function sessionProjects(hostId: string): SessionProject[] {
  const projects: SessionProject[] = [];
  for (const row of document.querySelectorAll<HTMLElement>(PROJECT_ROW_SELECTOR)) {
    const project = rowProject(row);
    const cwd = record(project)?.path;
    if (
      !project ||
      (project.hostId ?? "local") !== hostId ||
      typeof cwd !== "string" ||
      !cwd ||
      projects.some((item) => item.cwd === cwd) ||
      !nativeProjectStart(row, project.projectId)
    ) {
      continue;
    }
    projects.push({
      hostId,
      cwd,
      title: project.label,
      open: () => {
        const current = rowProject(row);
        const start = nativeProjectStart(row, project.projectId);
        if (
          !row.isConnected ||
          !current ||
          (current.hostId ?? "local") !== hostId ||
          record(current)?.path !== cwd ||
          !start
        ) {
          throw new Error("项目的新建会话入口已变化，请重新选择");
        }
        start();
      },
    });
  }
  return projects;
}

/** 获取编辑器正文时保留换行；当前会话发送仍完整使用原生草稿。 */
export function sessionDraftText(editor: HTMLElement | null): string {
  if (!editor) {
    return "";
  }
  if (editor.tagName === "TEXTAREA") {
    return (editor as HTMLTextAreaElement).value;
  }
  return editor.innerText ?? editor.textContent ?? "";
}

export function hasSessionAttachments(composer: Element): boolean {
  return [
    ...composer.querySelectorAll("[data-composer-attachments-row], [data-appshot-attachment]"),
  ].some((element) => element.childElementCount > 0 || Boolean(element.textContent?.trim()));
}

export function assertTransferableSessionDraft(composer: Element, editor: HTMLElement): void {
  // 附件由原生草稿独立持有，缺少完整搬运契约时必须保留草稿，不能只发正文。
  if (
    hasSessionAttachments(composer) ||
    editor.querySelector(
      '[contenteditable="false"], img, strong, em, a, pre, code, ul, ol, blockquote',
    )
  ) {
    throw new Error("含附件、引用或格式的草稿暂不能跨会话发送，草稿已保留");
  }
  if (!findNativeComposerController(editor)) {
    throw new Error("当前桌面版的草稿转移接口不可用，草稿已保留");
  }
}

/** 成功搬运后清理原生持久草稿；目标未接受发送时不清理来源。 */
export function sessionDraftCleanup(editor: HTMLElement): () => void {
  const controller = findNativeComposerController(editor);
  const doc = record(controller?.view.state.doc);
  const type = record(doc?.type);
  if (!controller || !doc || typeof type?.createAndFill !== "function") {
    throw new Error("无法安全清理来源草稿，未转移消息");
  }
  const key = Object.keys(editor).find((name) => name.startsWith("__reactFiber$"));
  const props = (key ? committedReactAncestors(Reflect.get(editor, key)) : [])
    .map((fiber) => record(fiber.memoizedProps))
    .find(
      (props) =>
        typeof props?.onDocumentChange === "function" && Object.hasOwn(props, "initialDocument"),
    );
  if (typeof props?.onDocumentChange !== "function") {
    throw new Error("无法确认来源草稿的保存入口，未转移消息");
  }
  const save = props.onDocumentChange as (document: unknown, plainTextMode: boolean) => void;
  const empty = type.createAndFill.call(type);
  return () => {
    // 同一编辑器被复用或用户已修改来源时，不能清除新输入。
    if (controller.view.state.doc !== doc) {
      return;
    }
    if (editor.isConnected) {
      const size = record(doc.content)?.size;
      if (typeof size === "number") {
        controller.view.dispatch(controller.view.state.tr.delete(0, size));
      }
    }
    save(empty, false);
  };
}
