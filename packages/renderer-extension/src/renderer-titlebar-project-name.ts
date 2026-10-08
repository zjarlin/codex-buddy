import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

import { CODEX_COMPOSER_SELECTOR } from "./renderer-composer-dom.js";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import { getDomMutationHub } from "./renderer-mutation-hub.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";

const CONTENT_ATTRIBUTE = "data-app-shell-titlebar-content";
const CONTENT_SELECTOR = `[${CONTENT_ATTRIBUTE}]`;
const PROJECT_ICON_SELECTOR = '[role="img"][aria-label]';
const PROJECT_ATTRIBUTE = "data-codexhost-titlebar-project";
const SIDEBAR_SELECTOR = "#app-shell-sidebar";
const PROJECT_CONTAINER_SELECTOR = "[data-sidebar-project-container-id]";
const PROJECT_HEADER_SELECTOR = "[data-app-action-sidebar-project-row]";
const PROJECT_LABEL_ATTRIBUTE = "data-app-action-sidebar-project-label";
// 项目图标的 Fiber 链里，tooltip 与 project 都在很浅的祖先上；限制深度避免把
// 上层无关组件的 tooltipContent 误当成项目名。
const FIBER_DEPTH_LIMIT = 8;

const style = `
/* 官方标题栏只显示会话名。这里在会话名后追加项目名，让用户不必回到左侧树确认
   当前会话属于哪个项目。用伪元素而不是插入真实节点：标题栏由 React 管理，插入的
   子节点会在重渲染时被移除，伪元素只依赖我们自己维护的属性，不参与协调。 */
[${CONTENT_ATTRIBUTE}][${PROJECT_ATTRIBUTE}]:not([${PROJECT_ATTRIBUTE}=""])::after{
  content:"· " attr(${PROJECT_ATTRIBUTE});
  flex:none;
  min-width:0;
  max-width:40%;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  margin-inline-start:2px;
  color:var(--color-text-tertiary,currentColor);
  font-size:12px;
  font-weight:400;
  line-height:1.2;
  opacity:.9;
}
`;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function boundedText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * 从官方项目图标 Fiber 读取项目名。`project.name` 是 Desktop 自己的项目身份，
 * `tooltipContent` 是同一 tooltip 上的显示名，二者都比本地化的 `aria-label`
 * （`项目：xxx` / `Project: xxx`）稳定，因此优先使用前者。
 */
export function titlebarProjectNameFromIcon(icon: Element | null): string | null {
  if (!icon) return null;
  const key = Object.getOwnPropertyNames(icon).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return null;
  let tooltip: string | null = null;
  const ancestors = committedReactAncestors(Reflect.get(icon, key));
  for (const [depth, fiber] of ancestors.entries()) {
    if (depth >= FIBER_DEPTH_LIMIT) break;
    const props = record(fiber.memoizedProps);
    if (!props) continue;
    const name = boundedText(record(props.project)?.name);
    if (name) return name;
    tooltip ??= boundedText(props.tooltipContent);
  }
  return tooltip;
}

/**
 * 标题栏 Fiber 拿不到项目名时的兜底：用当前会话在左侧树中的项目头标签。
 * 远程项目的原生标签带 `remote_` 前缀，与标题栏显示名可能不同，因此只作兜底。
 */
export function sidebarProjectLabelForThread(
  ownerDocument: Document,
  active: { hostId: string; threadId: string },
): string | null {
  const sidebar = ownerDocument.querySelector(SIDEBAR_SELECTOR);
  if (!sidebar) return null;
  for (const row of sidebar.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)) {
    if (row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) !== active.hostId) continue;
    if (threadIdFromSidebarRowElement(row) !== active.threadId) continue;
    const container = row.closest<HTMLElement>(PROJECT_CONTAINER_SELECTOR);
    const label = boundedText(
      container
        ?.querySelector<HTMLElement>(PROJECT_HEADER_SELECTOR)
        ?.getAttribute(PROJECT_LABEL_ATTRIBUTE),
    );
    if (label) return label;
  }
  return null;
}

export interface TitlebarProjectNameSource {
  /** 当前右侧正在查看的会话；threadId 为去掉 hostId 前缀的原生会话 ID。 */
  getActiveThread(): { hostId: string; threadId: string } | null;
  /** 归属文档；默认取全局 `document`，便于在受限的测试环境注入。 */
  ownerDocument?(): Document;
}

/**
 * 在官方标题栏的会话名后补充当前会话所属的项目名。
 *
 * 标题栏内容由 React 管理，且非会话路由（例如图片查看）根本没有该节点，因此这里
 * 只维护一个自己的属性并靠 MutationObserver 重新对齐：节点缺失时清空标记，节点
 * 出现或重渲染时按 Fiber 项目名重写，属性未变化时不写 DOM，避免自激循环。
 */
export function installRendererTitlebarProjectName(source: TitlebarProjectNameSource): {
  refresh(): void;
  dispose(): void;
} {
  const ownerDocument = (): Document => source.ownerDocument?.() ?? document;
  // 受限环境（部分单测只提供最小 DOM 桩）没有 createElement/head；此时只跳过样式
  // 注入，标记逻辑仍然可用，避免把探测入口整体拖垮。
  const styles =
    typeof ownerDocument().createElement === "function"
      ? ownerDocument().createElement("style")
      : null;
  if (styles) {
    styles.setAttribute("data-codexhost-titlebar-project-style", "true");
    styles.textContent = style;
    ownerDocument().head?.append(styles);
  }

  let disposed = false;
  let scheduled = false;
  const clearAttributes = (): void => {
    for (const element of ownerDocument().querySelectorAll<HTMLElement>(`[${PROJECT_ATTRIBUTE}]`)) {
      element.removeAttribute(PROJECT_ATTRIBUTE);
    }
  };
  const schedule = (): void => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };

  function scan(): void {
    scheduled = false;
    if (disposed) return;
    const content = ownerDocument().querySelector<HTMLElement>(CONTENT_SELECTOR);
    if (!content) {
      clearAttributes();
      return;
    }
    const active = source.getActiveThread();
    const name =
      titlebarProjectNameFromIcon(content.querySelector(PROJECT_ICON_SELECTOR)) ??
      (active ? sidebarProjectLabelForThread(ownerDocument(), active) : null);
    if (name) {
      if (content.getAttribute(PROJECT_ATTRIBUTE) !== name) {
        content.setAttribute(PROJECT_ATTRIBUTE, name);
      }
    } else if (content.hasAttribute(PROJECT_ATTRIBUTE)) {
      content.removeAttribute(PROJECT_ATTRIBUTE);
    }
  }

  const stopObserving = getDomMutationHub(ownerDocument()).subscribe({
    kinds: ["childList", "attributes"],
    // 只关心标题栏内容节点本身的重挂；自身属性的写入不在过滤范围内，不会自激。
    attributeFilter: [CONTENT_ATTRIBUTE],
    test: (mutation) =>
      mutationAffectsElements(mutation, CONTENT_SELECTOR) ||
      mutationAffectsElements(mutation, CODEX_COMPOSER_SELECTOR),
    onMutate: () => schedule(),
  });
  schedule();

  return {
    refresh: schedule,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopObserving();
      styles?.remove();
      clearAttributes();
    },
  };
}
