import { describe, expect, it } from "vitest";

import { sidebarThreadNativeStatus } from "../src/renderer-sidebar-thread-status.js";

const attributes = {
  "data-app-action-sidebar-thread-row": "",
  "data-app-action-sidebar-thread-id": "local:thread-1",
  "data-app-action-sidebar-thread-host-id": "local",
};

function rowWith(
  statuses: Array<Record<string, unknown> | null>,
  options: { matching?: boolean; hideStatusIndicator?: boolean } = {},
): HTMLElement {
  const attributesWithRecovery: Record<string, string> = { ...attributes };
  const element = {
    getAttribute(name: string) {
      return attributesWithRecovery[name] ?? null;
    },
    setAttribute(name: string, value: string) {
      attributesWithRecovery[name] = value;
    },
    querySelector() {
      return null;
    },
  } as unknown as HTMLElement;
  let fiber: Record<string, unknown> | null = null;
  for (const statusState of statuses.toReversed()) {
    fiber = {
      memoizedProps: {
        dataAttributes:
          options.matching === false
            ? { ...attributes, "data-app-action-sidebar-thread-host-id": "other" }
            : attributes,
        hideStatusIndicator: options.hideStatusIndicator ?? false,
        ...(statusState ? { statusState } : {}),
      },
      return: fiber,
    };
  }
  Object.defineProperty(element, "__reactFiber$test", { value: fiber });
  return element;
}

describe("Sidebar thread native status", () => {
  it("reports running for the native loading status", () => {
    expect(
      sidebarThreadNativeStatus(rowWith([{ type: "loading", unread: false, unreadCount: 0 }])),
    ).toEqual({ running: true, unread: false });
  });

  it("reports unread for idle statuses with unread results", () => {
    expect(
      sidebarThreadNativeStatus(rowWith([{ type: "idle", unread: true, unreadCount: 0 }])),
    ).toEqual({ running: false, unread: true });
  });

  it("prefers running over a stale unread flag", () => {
    expect(
      sidebarThreadNativeStatus(rowWith([{ type: "loading", unread: true, unreadCount: 0 }])),
    ).toEqual({ running: true, unread: false });
  });

  it("honours the Host running marker without walking the Fiber tree", () => {
    const element = rowWith([{ type: "idle", unread: true, unreadCount: 0 }]);
    element.setAttribute("data-buddy-sidebar-state", "running");
    expect(sidebarThreadNativeStatus(element)).toEqual({ running: true, unread: false });
  });

  it("reuses the cached result while the row fingerprint is unchanged", () => {
    const element = rowWith([{ type: "loading", unread: false, unreadCount: 0 }]);
    expect(sidebarThreadNativeStatus(element)).toEqual({ running: true, unread: false });
    // 同一 Fiber 与同一指纹下不再重新回溯：把 Fiber 指到不同身份也不影响缓存。
    const stale = Reflect.get(element, "__reactFiber$test");
    Reflect.set(element, "__reactFiber$test", { memoizedProps: {}, return: null });
    expect(sidebarThreadNativeStatus(element)).toEqual({ running: true, unread: false });
    Reflect.set(element, "__reactFiber$test", stale);
  });

  it("ignores rows without a matching Fiber identity or with a hidden status slot", () => {
    expect(
      sidebarThreadNativeStatus(rowWith([{ type: "loading", unread: true }], { matching: false })),
    ).toEqual({ running: false, unread: false });
    expect(
      sidebarThreadNativeStatus(
        rowWith([{ type: "loading", unread: true }], { hideStatusIndicator: true }),
      ),
    ).toEqual({ running: false, unread: false });
    expect(sidebarThreadNativeStatus(rowWith([null]))).toEqual({ running: false, unread: false });
  });
});
