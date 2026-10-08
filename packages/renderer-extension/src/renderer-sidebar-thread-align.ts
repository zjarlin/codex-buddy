import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import { getDomMutationHub } from "./renderer-mutation-hub.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";

export const SIDEBAR_SCROLL_SELECTOR = "[data-app-action-sidebar-scroll]";
const SIDEBAR_SELECTOR = "#app-shell-sidebar";
const PROJECT_CONTAINER_SELECTOR = "[data-sidebar-project-container-id][data-sidebar-project-kind]";
const PROJECT_HEADER_SELECTOR = "[data-app-action-sidebar-project-row]";
// 只在目标离开可视区时才滚动；完全可见时保持用户的滚动位置不动。
const VISIBLE_MARGIN_PX = 6;

export interface SidebarRect {
  top: number;
  bottom: number;
  height: number;
}

export interface SidebarThreadAlignSource {
  /** 当前右侧正在查看的会话；threadId 为去掉 hostId 前缀的原生会话 ID。 */
  getActiveThread(): { hostId: string; threadId: string } | null;
  /** 归属文档；默认取全局 `document`，便于在受限的测试环境注入。 */
  ownerDocument?(): Document;
}

function fullyVisible(rect: SidebarRect, scroller: SidebarRect): boolean {
  return (
    rect.top >= scroller.top + VISIBLE_MARGIN_PX &&
    rect.bottom <= scroller.bottom - VISIBLE_MARGIN_PX
  );
}

/** 把目标矩形滚动到容器中心的位移。 */
function centerDelta(target: SidebarRect, scroller: SidebarRect): number {
  return target.top + target.height / 2 - (scroller.top + scroller.height / 2);
}

/** 会话行相对滚动容器中心的位移；已完全可见时返回 null，表示无需滚动。 */
export function sidebarAlignDelta(row: SidebarRect, scroller: SidebarRect): number | null {
  return fullyVisible(row, scroller) ? null : centerDelta(row, scroller);
}

/**
 * 让「会话所属项目」优先进入可视区：项目头不在可视区时，先把它对齐到容器顶部，
 * 这样用户既能看到会话，也能看到它属于哪个项目。项目较长（对齐项目头后会话行
 * 仍在可视区之外）时退回把会话行居中，始终保证当前查看的会话可见。
 *
 * 已经同时可见时返回 null，不打扰用户当前的滚动位置。
 */
export function sidebarProjectFocusDelta(
  project: { header: SidebarRect | null; row: SidebarRect },
  scroller: SidebarRect,
): number | null {
  const rowVisible = fullyVisible(project.row, scroller);
  const headerVisible = project.header === null || fullyVisible(project.header, scroller);
  if (rowVisible && headerVisible) return null;
  if (project.header && !headerVisible) {
    const delta = project.header.top - scroller.top - VISIBLE_MARGIN_PX;
    const moved = {
      top: project.row.top - delta,
      bottom: project.row.bottom - delta,
      height: project.row.height,
    };
    if (fullyVisible(moved, scroller)) return delta;
  }
  return centerDelta(project.row, scroller);
}

/**
 * 保持左侧树的滚动位置与当前查看的会话对齐。
 *
 * 官方侧栏把所有项目放在同一个滚动容器里，项目多时目标会话常常滚出可视区，用户
 * 只能凭会话名猜它属于哪个项目。这里在「查看的会话发生变化」时把该会话所属的项目
 * 头与其会话行一起滚动到可视区；两者都已可见时不滚动，避免和用户的手动滚动打架；
 * 同一会话内不重复滚动，只有切换会话才重新对齐。
 *
 * 只做滚动，不改变任何原生状态：不切换项目分类、不展开折叠的项目、不写入会话行
 * 属性。目标行未被渲染（项目折叠、超出分页）时保持当前滚动位置，等它出现后再对齐。
 */
export function installRendererSidebarThreadAlign(source: SidebarThreadAlignSource): {
  refresh(): void;
  dispose(): void;
} {
  const ownerDocument = (): Document => source.ownerDocument?.() ?? document;
  let disposed = false;
  let scheduled = false;
  let alignedKey: string | null = null;

  const findRow = (hostId: string, threadId: string): HTMLElement | null => {
    const sidebar = ownerDocument().querySelector(SIDEBAR_SELECTOR);
    if (!sidebar) return null;
    for (const row of sidebar.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)) {
      if (row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) !== hostId) continue;
      if (threadIdFromSidebarRowElement(row) === threadId) return row;
    }
    return null;
  };

  const schedule = (): void => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };

  function scan(): void {
    scheduled = false;
    if (disposed || ownerDocument().hidden) return;
    const active = source.getActiveThread();
    if (!active) {
      alignedKey = null;
      return;
    }
    const key = JSON.stringify([active.hostId, active.threadId]);
    if (key === alignedKey) return;
    const row = findRow(active.hostId, active.threadId);
    if (!row) return;
    const scroller = row.closest<HTMLElement>(SIDEBAR_SCROLL_SELECTOR);
    if (!scroller) return;
    const rowRect = row.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    if (rowRect.height <= 0 || scrollerRect.height <= 0) return;
    const headerRect = row
      .closest<HTMLElement>(PROJECT_CONTAINER_SELECTOR)
      ?.querySelector<HTMLElement>(PROJECT_HEADER_SELECTOR)
      ?.getBoundingClientRect();
    const delta = sidebarProjectFocusDelta(
      {
        header:
          headerRect && headerRect.height > 0
            ? { top: headerRect.top, bottom: headerRect.bottom, height: headerRect.height }
            : null,
        row: { top: rowRect.top, bottom: rowRect.bottom, height: rowRect.height },
      },
      { top: scrollerRect.top, bottom: scrollerRect.bottom, height: scrollerRect.height },
    );
    if (delta !== null) scroller.scrollTop += delta;
    alignedKey = key;
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
    refresh: schedule,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopObserving();
      alignedKey = null;
    },
  };
}
