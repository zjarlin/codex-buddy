import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import { getDomMutationHub } from "./renderer-mutation-hub.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";

const SYNCED = "data-codexhost-sidebar-thread-synced";
const ACTIVE = "data-app-action-sidebar-thread-active";
const style = `
/* 原生选中态在浅色主题下对比度不足时补充可见性；不覆盖深色主题或自定义样式。 */
[${ACTIVE}="true"]{--codexhost-sidebar-active-bg:color-mix(in srgb,var(--color-background-info-solid,#3b82f6) 14%,transparent);--codexhost-sidebar-active-border:color-mix(in srgb,var(--color-background-info-solid,#3b82f6) 55%,transparent)}
[${ACTIVE}="true"]{background:var(--codexhost-sidebar-active-bg)!important;border-left:2px solid var(--codexhost-sidebar-active-border)!important;border-radius:6px!important}
/* 当右侧正在查看的会话未被原生标为 active 时，补一个同步标记，避免用户找不到当前会话。 */
[${SYNCED}]{--codexhost-sidebar-synced-bg:color-mix(in srgb,var(--color-background-info-solid,#3b82f6) 10%,transparent);--codexhost-sidebar-synced-border:color-mix(in srgb,var(--color-background-info-solid,#3b82f6) 45%,transparent)}
[${SYNCED}]:not([${ACTIVE}="true"]){background:var(--codexhost-sidebar-synced-bg)!important;border-left:2px dashed var(--codexhost-sidebar-synced-border)!important;border-radius:6px!important}
`;

export interface SidebarActiveSyncSource {
  /** 返回当前右侧正在查看的会话；threadId 应为去除 hostId 前缀后的原生会话 ID。 */
  getActiveThread(): { hostId: string; threadId: string } | null;
}

/**
 * 解决「右侧正在查看某会话，但左侧树没有明显选中态」的体验问题：
 * 1. 给原生 [data-app-action-sidebar-thread-active=true] 加一层更明显的背景/左边框，
 *    让浅色主题下的选中行更容易被看到；
 * 2. 当右侧已挂载 Composer 对应的会话在左侧树中存在、但未被原生标为 active 时，
 *    给该行补一个 [data-codexhost-sidebar-thread-synced] 虚线边框样式，并尝试滚动到可视区。
 *
 * 该模块只读原生 active 属性，不写入也不替换；如果未来原生修复了选中态一致性，
 * 同步标记会自然消失（因为 active=true 时 synced 样式被 :not 排除）。
 */
export function installRendererSidebarActiveSync(source: SidebarActiveSyncSource): {
  refresh(): void;
  dispose(): void;
} {
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);

  let disposed = false;
  let scheduled = false;
  let lastSyncedKey: string | null = null;

  const schedule = (): void => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };

  function scan(): void {
    scheduled = false;
    if (disposed) return;

    const active = source.getActiveThread();
    const rows = document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR);
    let matched: HTMLElement | null = null;
    let matchedIsNativeActive = false;

    for (const row of rows) {
      const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
      const rawId = threadIdFromSidebarRowElement(row);
      if (!hostId || !rawId) {
        row.removeAttribute(SYNCED);
        continue;
      }
      const threadId = rawId.startsWith(`${hostId}:`) ? rawId.slice(hostId.length + 1) : rawId;
      const isTarget = active !== null && hostId === active.hostId && threadId === active.threadId;
      const nativeActive = row.getAttribute(ACTIVE) === "true";

      if (isTarget) {
        matched = row;
        matchedIsNativeActive = nativeActive;
      }

      // 仅对目标行保留同步标记；其他行一律清除，避免残留。
      if (!isTarget && row.hasAttribute(SYNCED)) {
        row.removeAttribute(SYNCED);
      }
    }

    const nextKey = matched && active ? JSON.stringify([active.hostId, active.threadId]) : null;

    if (matched && !matchedIsNativeActive) {
      if (!matched.hasAttribute(SYNCED)) {
        matched.setAttribute(SYNCED, "");
      }
      // 仅在目标变化时滚动，避免每次 DOM 抖动都触发 scrollIntoView。
      if (nextKey !== lastSyncedKey) {
        matched.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } else if (matched) {
      matched.removeAttribute(SYNCED);
    }

    lastSyncedKey = nextKey;
  }

  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList", "attributes"],
    attributeFilter: [SIDEBAR_THREAD_HOST_ID_ATTRIBUTE, SIDEBAR_THREAD_ID_ATTRIBUTE, ACTIVE],
    test: (mutation) => mutationAffectsElements(mutation, SIDEBAR_THREAD_ROW_SELECTOR),
    onMutate: () => schedule(),
  });

  schedule();

  return {
    refresh: schedule,
    dispose() {
      disposed = true;
      stopObserving();
      styles.remove();
      for (const row of document.querySelectorAll<HTMLElement>(`[${SYNCED}]`)) {
        row.removeAttribute(SYNCED);
      }
      lastSyncedKey = null;
    },
  };
}
