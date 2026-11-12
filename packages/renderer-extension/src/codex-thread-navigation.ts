import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

import { loadCodexNativeServices } from "./codex-native-services.js";

interface NativeNavigationBus {
  handlers: Map<string, unknown>;
  dispatchHostMessage(message: { type: "navigate-to-route"; path: string }): void;
}

function isNavigationBus(value: unknown): value is NativeNavigationBus {
  if (typeof value !== "object" || value === null) return false;
  const bus = value as NativeNavigationBus;
  return (
    bus.handlers instanceof Map &&
    bus.handlers.has("navigate-to-route") &&
    typeof bus.dispatchHostMessage === "function"
  );
}

// 只读子会话可以没有 Composer；活动页的已提交路由仍能确认 Host 与 Thread。
function isActiveRoute(pathname: string, hostId: string): boolean {
  const pages = document.querySelectorAll('[data-app-shell-active-page="true"]');
  const page = pages[0];
  if (pages.length !== 1 || !page) return false;
  const key = Object.getOwnPropertyNames(page).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return false;
  for (const ancestor of committedReactAncestors(Reflect.get(page, key))) {
    const props = ancestor.memoizedProps as {
      value?: {
        navigationType?: unknown;
        location?: { pathname?: unknown; search?: unknown };
      };
    } | null;
    const value = props?.value;
    if (!["POP", "PUSH", "REPLACE"].includes(String(value?.navigationType))) continue;
    const location = value?.location;
    return (
      location?.pathname === pathname &&
      typeof location.search === "string" &&
      new URLSearchParams(location.search).get("hostId") === hostId
    );
  }
  return false;
}

/** 缺少原生导航入口时返回 false，由调用方沿用侧栏定位。 */
export async function openCodexThreadRoute(
  threadId: string,
  options: {
    hostId: string;
    signal?: AbortSignal;
    activeThread?(): { hostId: string; threadId: string } | null;
  },
): Promise<boolean> {
  options.signal?.throwIfAborted();
  const bus = await loadCodexNativeServices(window, isNavigationBus);
  options.signal?.throwIfAborted();
  if (!bus) return false;
  const pathname = `/local/${encodeURIComponent(threadId)}`;
  const search = new URLSearchParams({ hostId: options.hostId });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const check = (): void => {
      const active = options.activeThread?.();
      if (
        (active?.hostId === options.hostId && active.threadId === threadId) ||
        isActiveRoute(pathname, options.hostId)
      ) {
        finish();
      }
    };
    const onAbort = (): void => finish(options.signal?.reason);
    const poll = window.setInterval(check, 100);
    const timeout = window.setTimeout(
      () => finish(new Error("Thread did not become the current conversation")),
      10_000,
    );
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      bus.dispatchHostMessage({ type: "navigate-to-route", path: `${pathname}?${search}` });
      check();
    } catch (error) {
      finish(error);
    }
  });
  return true;
}
