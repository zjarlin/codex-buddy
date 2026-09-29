import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  draftIdFromSidebarRowElement,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";

const BADGE = "data-codexhost-sidebar-visits";
const ACTIVE = "data-app-action-sidebar-thread-active";
const STORAGE_PREFIX = "codexhost.sidebar-visits.v1:";
const style = `
[${BADGE}]{display:inline-flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;min-width:18px;height:18px;padding:0 5px;border-radius:5px;background:color-mix(in srgb,currentColor 7%,transparent);color:var(--color-token-text-secondary,currentColor);font:11px/18px system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none}
`;

// 查阅次数属于本机界面元数据，按 Host 和原生会话 ID 隔离，不写入会话历史。
export function installRendererSidebarVisits(options: { getLocale(): "zh-CN" | "en" }): {
  refresh(): void;
  dispose(): void;
} {
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);
  const mounted = new Map<HTMLElement, HTMLElement>();
  const counts = new Map<string, number>();
  let activeKey: string | null = null;
  let initialized = false;
  let scheduled = false;
  let disposed = false;
  let storageWarningShown = false;

  const storageWarning = (error: unknown): void => {
    if (storageWarningShown) {
      return;
    }
    storageWarningShown = true;
    console.warn("[codexhost] Sidebar visit counts are only available in this window", error);
  };
  const read = (key: string): number => {
    try {
      const raw = localStorage.getItem(key);
      const count = raw === null ? 0 : Number(raw);
      return Number.isSafeInteger(count) && count >= 0 ? count : 0;
    } catch (error) {
      storageWarning(error);
      return counts.get(key) ?? 0;
    }
  };
  const increment = (key: string): void => {
    // 每次递增前读取其他窗口保存的最新值；保存失败时仍保留当前窗口的统计。
    const count = Math.min(Math.max(read(key), counts.get(key) ?? 0) + 1, Number.MAX_SAFE_INTEGER);
    counts.set(key, count);
    try {
      localStorage.setItem(key, String(count));
    } catch (error) {
      storageWarning(error);
    }
  };
  const clear = (row: HTMLElement): void => {
    mounted.get(row)?.remove();
    mounted.delete(row);
  };
  const schedule = (): void => {
    if (disposed || scheduled) {
      return;
    }
    scheduled = true;
    queueMicrotask(scan);
  };

  function scan(): void {
    scheduled = false;
    if (disposed) {
      return;
    }
    const rows = new Map<HTMLElement, { key: string; title: HTMLElement }>();
    for (const row of document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)) {
      const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
      const id = threadIdFromSidebarRowElement(row);
      const title = row.querySelector<HTMLElement>("[data-thread-title-trigger]");
      if (!hostId || !id || !title || draftIdFromSidebarRowElement(row)) {
        continue;
      }
      const threadId = id.startsWith(`${hostId}:`) ? id.slice(hostId.length + 1) : id;
      const key = STORAGE_PREFIX + JSON.stringify([hostId, threadId]);
      rows.set(row, { key, title });
      if (!counts.has(key)) {
        counts.set(key, read(key));
      }
    }
    for (const row of mounted.keys()) {
      if (!rows.has(row)) {
        clear(row);
      }
    }

    const active = new Set(
      [...rows].filter(([row]) => row.getAttribute(ACTIVE) === "true").map(([, { key }]) => key),
    );
    const nextKey = active.size === 1 ? active.values().next().value : null;
    if (nextKey && nextKey !== activeKey) {
      // 启动时恢复的已选中会话不算新查阅，只有后续实际切入才增加次数。
      if (initialized) {
        increment(nextKey);
      }
      activeKey = nextKey;
    } else if (!active.size && [...rows.values()].some(({ key }) => key === activeKey)) {
      activeKey = null;
    }
    // 折叠项目或重绘时保留已选中的身份，避免同一会话重新挂载后重复计数。
    if (rows.size > 0) {
      initialized = true;
    }

    for (const [row, { key, title }] of rows) {
      let badge = mounted.get(row);
      if (badge && badge.previousElementSibling !== title) {
        clear(row);
        badge = undefined;
      }
      if (!badge) {
        badge = document.createElement("span");
        badge.setAttribute(BADGE, "");
        badge.setAttribute("role", "img");
        title.after(badge);
        mounted.set(row, badge);
      }
      const count = counts.get(key) ?? 0;
      const text = String(count);
      const label = options.getLocale() === "zh-CN" ? `查阅 ${count} 次` : `Viewed ${count} times`;
      if (badge.textContent !== text) {
        badge.textContent = text;
      }
      if (badge.title !== label) {
        badge.title = label;
        badge.setAttribute("aria-label", label);
      }
    }
  }

  const observer = new MutationObserver((records) => {
    if (records.some((entry) => mutationAffectsElements(entry, SIDEBAR_THREAD_ROW_SELECTOR))) {
      schedule();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [SIDEBAR_THREAD_HOST_ID_ATTRIBUTE, SIDEBAR_THREAD_ID_ATTRIBUTE, ACTIVE],
  });
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null) {
      counts.clear();
    } else if (event.key.startsWith(STORAGE_PREFIX)) {
      counts.delete(event.key);
    } else {
      return;
    }
    schedule();
  };
  window.addEventListener("storage", onStorage);
  schedule();
  return {
    refresh: schedule,
    dispose() {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("storage", onStorage);
      for (const row of mounted.keys()) {
        clear(row);
      }
      counts.clear();
      styles.remove();
    },
  };
}
