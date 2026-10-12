import createElement from "lucide/dist/esm/createElement.mjs";
import Undo2 from "lucide/dist/esm/icons/undo-2.mjs";
import X from "lucide/dist/esm/icons/x.mjs";

import { hostThreadIdSchema } from "@codexhost/shared-contracts";

import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import { getDomMutationHub } from "./renderer-mutation-hub.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";

const CHIP = "data-codexhost-thread-return";
const DISMISS = "data-codexhost-thread-return-dismiss";
const SIDEBAR_SELECTOR = "#app-shell-sidebar";

const style = `
[${CHIP}]{position:fixed;left:16px;bottom:16px;z-index:1200;display:flex;align-items:center;gap:8px;box-sizing:border-box;max-width:min(420px,calc(100vw - 32px));padding:6px 8px 6px 10px;border:1px solid var(--color-border,rgba(127,127,127,.25));border-radius:999px;background:var(--color-token-dropdown-background,var(--color-background-elevated,light-dark(#fff,#24262c)));color:var(--color-token-text-primary,inherit);box-shadow:0 8px 24px #0003;font:13px/18px system-ui,sans-serif;color-scheme:inherit}
[${CHIP}][hidden]{display:none}
[${CHIP}] button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}
[${CHIP}] [data-codexhost-thread-return-open]{min-height:24px;border-radius:999px}
[${CHIP}] [data-codexhost-thread-return-open]:focus-visible,[${CHIP}] [${DISMISS}]:focus-visible{outline:2px solid Highlight;outline-offset:1px}
[${CHIP}] .codexhost-thread-return-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-token-text-secondary,currentColor)}
[${CHIP}] .codexhost-thread-return-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;max-width:min(220px,40vw)}
[${CHIP}] [${DISMISS}]{flex:none;width:22px;height:22px;border-radius:999px;color:var(--color-token-text-secondary,currentColor)}
[${CHIP}] [${DISMISS}]:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
`;

type Locale = "zh-CN" | "en";

export interface RendererThreadReturnTarget {
  hostId: string;
  threadId: string;
}

export interface RendererThreadReturnSource {
  getLocale(): Locale;
  /** 当前右侧正在查看的会话；threadId 为去掉 hostId 前缀的原生会话 ID。 */
  activeThread(): { hostId: string; threadId: string } | null;
  /** 与待确认卡片“查看结果”同一入口：按侧栏原生行切入会话。 */
  openThread(threadId: string, options: { hostId: string }): Promise<void>;
  /** 归属文档；默认取全局 `document`，便于在受限的测试环境注入。 */
  ownerDocument?(): Document;
}

function messages(locale: Locale): { label: string; dismiss: string } {
  return locale === "zh-CN"
    ? { label: "回到刚才的会话", dismiss: "关闭返回入口" }
    : { label: "Back to previous conversation", dismiss: "Dismiss return entry" };
}

function sameTarget(
  left: RendererThreadReturnTarget | null,
  right: { hostId: string; threadId: string } | null,
): boolean {
  return Boolean(left && right && left.hostId === right.hostId && left.threadId === right.threadId);
}

/**
 * 记住「查看完成提醒之前正在看的会话」，并在之后提供一个返回入口。
 *
 * 用户从完成卡片点“查看结果”会被带到已完成的会话，原本正在看的会话随之丢失，
 * 而侧栏里常常记不住是哪一个。这里在跳转前记录来源会话，跳转后显示一个小胶囊，
 * 点击即按原生侧栏行切回；用户自己走回来源会话、点击返回或关闭胶囊都会收起。
 *
 * 只做导航，不改变任何原生状态：不写入会话行属性、不改会话历史、不新增 Host 协议。
 */
export function installRendererThreadReturn(source: RendererThreadReturnSource): {
  remember(target: RendererThreadReturnTarget): void;
  refresh(): void;
  dispose(): void;
} {
  const ownerDocument = (): Document => source.ownerDocument?.() ?? document;
  let disposed = false;
  let scheduled = false;
  let target: RendererThreadReturnTarget | null = null;
  let navigating = false;
  const chip = ownerDocument().createElement?.("div") as HTMLElement | undefined;
  const styles = ownerDocument().createElement?.("style") as HTMLStyleElement | undefined;
  const open = ownerDocument().createElement?.("button") as HTMLButtonElement | undefined;
  const label = ownerDocument().createElement?.("span") as HTMLSpanElement | undefined;
  const title = ownerDocument().createElement?.("span") as HTMLSpanElement | undefined;
  const dismiss = ownerDocument().createElement?.("button") as HTMLButtonElement | undefined;

  const findRow = (value: RendererThreadReturnTarget): HTMLElement | null => {
    const sidebar = ownerDocument().querySelector(SIDEBAR_SELECTOR);
    if (!sidebar) return null;
    for (const row of sidebar.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)) {
      if (row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) !== value.hostId) continue;
      if (threadIdFromSidebarRowElement(row) === value.threadId) return row;
    }
    return null;
  };

  const labelFor = (value: RendererThreadReturnTarget): string => {
    const text = findRow(value)?.querySelector<HTMLElement>("[data-thread-title]")?.textContent;
    return text?.trim() || value.threadId;
  };

  if (styles && chip && open && label && title && dismiss) {
    styles.textContent = style;
    chip.setAttribute(CHIP, "");
    chip.hidden = true;
    open.type = "button";
    open.dataset.codexhostThreadReturnOpen = "";
    open.append(createElement(Undo2, { width: 15, height: 15, "aria-hidden": "true" }));
    label.className = "codexhost-thread-return-label";
    title.className = "codexhost-thread-return-title";
    open.append(label, title);
    dismiss.type = "button";
    dismiss.setAttribute(DISMISS, "");
    dismiss.append(createElement(X, { width: 14, height: 14, "aria-hidden": "true" }));
    chip.append(open, dismiss);
    ownerDocument().head?.append(styles);
    ownerDocument().body?.append(chip);

    const clear = (): void => {
      target = null;
      chip.hidden = true;
      renderedKey = "";
    };
    open.addEventListener("click", () => {
      const current = target;
      if (!current || navigating) return;
      navigating = true;
      void source
        .openThread(current.threadId, { hostId: current.hostId })
        .then(() => {
          navigating = false;
          clear();
        })
        .catch(() => {
          // 行未渲染或导航被取消时保留入口，用户可重试或从侧栏自行切换。
          navigating = false;
          schedule();
        });
    });
    dismiss.addEventListener("click", () => clear());
  }

  let renderedKey = "";
  const schedule = (): void => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };

  function scan(): void {
    scheduled = false;
    if (disposed || !chip) return;
    const active = source.activeThread();
    // 已经回到来源会话（或用户手动切回）时收起入口。
    if (target && sameTarget(target, active)) target = null;
    if (!target) {
      if (renderedKey !== "") {
        renderedKey = "";
        chip.hidden = true;
      }
      return;
    }
    const copy = messages(source.getLocale());
    const text = labelFor(target);
    const key = `${copy.label}\u0000${text}\u0000${target.hostId}\u0000${target.threadId}`;
    if (key !== renderedKey) {
      renderedKey = key;
      if (label && title) {
        label.textContent = copy.label;
        title.textContent = text;
        title.title = text;
      }
      if (open && dismiss) {
        open.setAttribute("aria-label", `${copy.label}：${text}`);
        dismiss.setAttribute("aria-label", copy.dismiss);
        dismiss.title = copy.dismiss;
      }
    }
    chip.hidden = false;
  }

  const stopObserving = getDomMutationHub(ownerDocument()).subscribe({
    kinds: ["childList", "attributes"],
    attributeFilter: [
      SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
      "data-app-action-sidebar-thread-id",
      "data-app-action-sidebar-thread-active",
    ],
    test: (mutation) => mutationAffectsElements(mutation, SIDEBAR_SELECTOR),
    onMutate: () => schedule(),
  });
  schedule();

  return {
    remember(value) {
      if (disposed) return;
      const parsed = hostThreadIdSchema.safeParse(value.threadId);
      if (!parsed.success || !value.hostId) return;
      // 来源会话就是即将打开的目标时没有可返回的上一会话。
      if (sameTarget(value, source.activeThread())) {
        target = null;
        schedule();
        return;
      }
      target = { hostId: value.hostId, threadId: parsed.data };
      schedule();
    },
    refresh: schedule,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopObserving();
      target = null;
      chip?.remove();
      styles?.remove();
    },
  };
}
