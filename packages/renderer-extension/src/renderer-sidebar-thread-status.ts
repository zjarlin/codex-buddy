import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ID_ATTRIBUTE,
} from "./renderer-sidebar-agent-icons.js";

// 原生侧栏行由 React 管理，执行中/未读状态只存在于行组件的 statusState。
// 这里按行属性精确匹配所属 Fiber，避免复用行或隐藏状态槽时误判。
export interface SidebarThreadNativeStatus {
  /** 正在执行回合：原生状态槽 loading，或 Host 已确认的原生回合仍在运行。 */
  running: boolean;
  /** 有未读结果，且不是执行中（执行中由 running 表达）。 */
  unread: boolean;
}

const IDLE: SidebarThreadNativeStatus = { running: false, unread: false };

// Host 侧恢复标记：running 表示 Host 已收到且尚未结束的原生回合。
const RECOVERY_ATTRIBUTE = "data-buddy-sidebar-state";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function fiberOf(row: HTMLElement): unknown {
  const key = Object.getOwnPropertyNames(row).find((name) => name.startsWith("__reactFiber$"));
  return key ? Reflect.get(row, key) : null;
}

// 行会被多个侧栏观察者重复扫描（签名、投影、未读、查阅次数等）。Fiber 祖先回溯
// 成本高，因此按「元素 + Fiber 指针 + 廉价 DOM 状态指纹」缓存；指纹变化
// （未读描述、状态槽出现/消失、Host 恢复标记）才重新回溯，其余情况复用。
interface StatusCacheEntry {
  fiber: unknown;
  fingerprint: string;
  status: SidebarThreadNativeStatus;
}
const statusCache = new WeakMap<HTMLElement, StatusCacheEntry>();

function domFingerprint(row: HTMLElement): string {
  // 只用原生行上廉价且稳定的信号：未读描述（sr-only 文本）、状态槽是否挂载、
  // Host 恢复标记。三者任一变化都可能改变 statusState 的读取结果。
  const describedBy = row.getAttribute("aria-describedby");
  const described = describedBy
    ? (row.querySelector(`[id="${describedBy}"]`)?.textContent ?? null)
    : null;
  return JSON.stringify([
    described,
    row.querySelector('[role="status"]') !== null,
    row.getAttribute(RECOVERY_ATTRIBUTE),
  ]);
}

export function sidebarThreadNativeStatus(row: HTMLElement): SidebarThreadNativeStatus {
  const fiber = fiberOf(row);
  const fingerprint = domFingerprint(row);
  const cached = statusCache.get(row);
  if (cached && cached.fiber === fiber && cached.fingerprint === fingerprint) return cached.status;

  const recovery = row.getAttribute(RECOVERY_ATTRIBUTE);
  if (recovery === "running") {
    const status = { running: true, unread: false };
    statusCache.set(row, { fiber, fingerprint, status });
    return status;
  }

  let running = false;
  let unread = false;
  for (const ancestor of committedReactAncestors(fiber).slice(0, 12)) {
    const props = record(ancestor.memoizedProps);
    const attributes = record(props?.dataAttributes);
    if (
      attributes?.[SIDEBAR_THREAD_ID_ATTRIBUTE] !== row.getAttribute(SIDEBAR_THREAD_ID_ATTRIBUTE) ||
      attributes?.[SIDEBAR_THREAD_HOST_ID_ATTRIBUTE] !==
        row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) ||
      props?.hideStatusIndicator === true
    )
      continue;
    const status = record(props?.statusState);
    if (status?.type === "loading") running = true;
    else if (status?.unread === true) unread = true;
  }
  const result = running ? { running: true, unread: false } : unread ? { running, unread } : IDLE;
  statusCache.set(row, { fiber, fingerprint, status: result });
  return result;
}
