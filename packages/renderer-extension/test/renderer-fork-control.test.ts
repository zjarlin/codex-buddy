import {
  hostThreadIdSchema,
  hostTurnIdSchema,
  type ThreadInspection,
} from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installRendererForkControl,
  openRendererThread,
  rendererForkTargetFromButton,
  type RendererForkDom,
  type RendererForkTarget,
} from "../src/renderer-fork-control.js";
import type { RendererModelClient } from "../src/renderer-model-client.js";

class FakeForkDom implements RendererForkDom {
  listener: ((target: RendererForkTarget) => boolean) | null = null;
  readonly openThread = vi.fn(async () => undefined);
  readonly replay = vi.fn();

  listen(onFork: (target: RendererForkTarget) => boolean): () => void {
    this.listener = onFork;
    return () => {
      this.listener = null;
    };
  }

  emit(target: RendererForkTarget): boolean {
    return this.listener?.(target) ?? false;
  }
}

function clientWith(inspection: ThreadInspection): RendererModelClient {
  return {
    forkThread: vi.fn(async () => ({ threadId: hostThreadIdSchema.parse("derived-thread") })),
    inspectHarness: vi.fn(),
    inspectThread: vi.fn(async () => inspection),
    inspectHarnessCommands: vi.fn(),
    inspectThreadCommands: vi.fn(),
    executeThreadCommand: vi.fn(),
    inspectThreadUsage: vi.fn(),
    listThreadOwnership: vi.fn(),
    selectThreadModel: vi.fn(),
    selectThreadThinking: vi.fn(),
    selectThreadPermissionMode: vi.fn(),
    checkUpdate: vi.fn(),
    startUpdate: vi.fn(),
    restartUpdate: vi.fn(),
    readUpdateStatus: vi.fn(),
    listCodexAccounts: vi.fn(),
    refreshCodexAccounts: vi.fn(),
  };
}

function target(isProjectlessConversation = true): RendererForkTarget {
  return {
    control: {},
    isProjectlessConversation,
    threadId: hostThreadIdSchema.parse("source-thread"),
    turnId: hostTurnIdSchema.parse("source-turn"),
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function forkButton(
  input: {
    domThreadId?: string;
    fiberThreadId?: string;
    domTurnId?: string;
    fiberTurnId?: string;
    forkSignature?: boolean;
    isProjectlessConversation?: boolean;
    projectlessSignature?: boolean;
  } = {},
): HTMLButtonElement {
  const domThreadId = input.domThreadId ?? "source-thread";
  const fiberThreadId = input.fiberThreadId ?? domThreadId;
  const domTurnId = input.domTurnId ?? "source-turn";
  const fiberTurnId = input.fiberTurnId ?? domTurnId;
  const annotation = {
    getAttribute: (name: string) =>
      name === "data-response-annotation-conversation" ? domThreadId : null,
  };
  const turn = {
    getAttribute: (name: string) => (name === "data-content-search-turn-key" ? domTurnId : null),
  };
  const button = {
    closest(selector: string) {
      if (selector === "[data-response-annotation-conversation]") return annotation;
      if (selector === "[data-content-search-turn-key]") return turn;
      return null;
    },
  } as unknown as HTMLButtonElement;
  const fiber = {
    memoizedProps:
      input.forkSignature === false ? { onClick: vi.fn() } : { "aria-busy": undefined },
    return: {
      memoizedProps: {
        conversationId: fiberThreadId,
        turnId: fiberTurnId,
        hostId: "local",
        onFork: vi.fn(),
        ...(input.projectlessSignature === false
          ? {}
          : { isProjectlessConversation: input.isProjectlessConversation ?? false }),
      },
      return: null,
    },
  };
  Object.defineProperty(button, "__reactFiber$test", { value: fiber });
  return button;
}

function sidebarRow(
  threadId: string,
  hostId: string,
  conversationId = threadId,
  projectContainer: HTMLElement | null = null,
) {
  const attributes = {
    "data-app-action-sidebar-thread-row": "row-marker",
    "data-app-action-sidebar-thread-id": `${hostId}:${threadId}`,
    "data-app-action-sidebar-thread-host-id": hostId,
  } as const;
  const row = {
    click: vi.fn(),
    closest: (selector: string) =>
      selector === "[data-sidebar-project-container-id]" ? projectContainer : null,
    getAttribute: (name: string) => attributes[name as keyof typeof attributes] ?? null,
  } as unknown as HTMLElement;
  Object.defineProperty(row, "__reactFiber$test", {
    value: {
      memoizedProps: {
        conversationId,
        dataAttributes: attributes,
      },
      return: null,
    },
  });
  return row;
}

// 原生“Show more / Show less”加载更多控件：以 Fiber 上的 hasMoreItems +
// onExpandedChange 暴露分页契约，并按当前展开态决定 onClick 的行为。
function pagingButton(
  handlers: { onExpandedChange: (expanded: boolean) => void },
  options: { busy?: boolean } = {},
): HTMLButtonElement {
  const button = {
    disabled: options.busy ?? false,
    getAttribute: (name: string) => (name === "aria-disabled" ? String(options.busy) : null),
    click: vi.fn(() => handlers.onExpandedChange(true)),
  } as unknown as HTMLButtonElement;
  Object.defineProperty(button, "__reactFiber$test", {
    value: {
      memoizedProps: { expanded: true, hasMoreItems: true, onExpandedChange: vi.fn() },
      return: null,
    },
  });
  return button;
}

describe("Renderer external Thread Fork control", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens only the Host-qualified standard sidebar row", async () => {
    const local = sidebarRow("same-thread", "local");
    const remote = sidebarRow("same-thread", "remote-1");
    vi.stubGlobal("document", {
      querySelectorAll: () => [local, remote],
      documentElement: {},
    });

    await openRendererThread(hostThreadIdSchema.parse("same-thread"), { hostId: "remote-1" });

    expect(local.click).not.toHaveBeenCalled();
    expect(remote.click).toHaveBeenCalledOnce();
  });

  it("keeps the generic Fork opener compatible with a Remote Host row", async () => {
    const remote = sidebarRow("remote-thread", "remote-1");
    vi.stubGlobal("document", {
      querySelectorAll: () => [remote],
      documentElement: {},
    });

    await openRendererThread(hostThreadIdSchema.parse("remote-thread"));

    expect(remote.click).toHaveBeenCalledOnce();
  });

  it("opens a Remote Host row whose Fiber carries the Host prefix", async () => {
    const hostId = "remote-ssh-discovered:okm252";
    const remote = sidebarRow("remote-thread", hostId, `${hostId}:remote-thread`);
    vi.stubGlobal("document", {
      querySelectorAll: () => [remote],
      documentElement: {},
    });

    await openRendererThread(hostThreadIdSchema.parse("remote-thread"), { hostId });

    expect(remote.click).toHaveBeenCalledOnce();
  });

  it("opens a delayed Host-qualified row and releases its observer", async () => {
    const local = sidebarRow("delayed-thread", "local");
    let rows: HTMLElement[] = [];
    const callbacks: MutationCallback[] = [];
    const disconnect = vi.fn();
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        callbacks.push(callback);
      }
      observe = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("document", {
      querySelectorAll: () => rows,
      documentElement: {},
    });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const opening = openRendererThread(hostThreadIdSchema.parse("delayed-thread"), {
      hostId: "local",
      timeoutMs: 60_000,
    });

    rows = [local];
    const notify = callbacks[0];
    if (!notify) throw new Error("Sidebar observer was not installed");
    notify([], {} as MutationObserver);
    await opening;

    expect(local.click).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("aborts a pending sidebar wait and releases its observer", async () => {
    const disconnect = vi.fn();
    class FakeMutationObserver {
      observe = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("document", { querySelectorAll: () => [], documentElement: {} });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const abort = new AbortController();
    const opening = openRendererThread(hostThreadIdSchema.parse("pending-thread"), {
      hostId: "remote-1",
      signal: abort.signal,
      timeoutMs: 60_000,
    });

    abort.abort();

    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("times out a missing sidebar row and releases its observer", async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();
    class FakeMutationObserver {
      observe = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("document", { querySelectorAll: () => [], documentElement: {} });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const opening = openRendererThread(hostThreadIdSchema.parse("missing-thread"), {
      hostId: "local",
      timeoutMs: 5,
    });
    const rejection = expect(opening).rejects.toThrow("Thread did not appear in the sidebar");

    await vi.advanceTimersByTimeAsync(5);

    await rejection;
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("expands a collapsed sidebar project, opens it, and folds the project back", async () => {
    const rows: HTMLElement[] = [];
    const target = sidebarRow("hidden-thread", "local");
    let expanded = false;
    const header = {
      isConnected: true,
      getAttribute: (name: string) => (name === "aria-expanded" ? String(expanded) : null),
      click: vi.fn(() => {
        if (expanded) {
          expanded = false;
          return;
        }
        expanded = true;
        rows.push(target);
      }),
    } as unknown as HTMLElement;
    // Desktop 原生列表的“展开显示”加载更多控件通过 Fiber 上的
    // hasMoreItems/onExpandedChange 暴露分页契约，这里用同一契约驱动，
    // 避免依赖具体 UI 文案或私有组件名。
    const reveal = { click: vi.fn() } as unknown as HTMLButtonElement;
    Object.defineProperty(reveal, "__reactFiber$test", {
      value: {
        memoizedProps: { expanded: true, hasMoreItems: true, onExpandedChange: vi.fn() },
        return: null,
      },
    });
    const sidebar = {
      querySelectorAll: (selector: string) => {
        if (selector === "[data-app-action-sidebar-project-row]") return [header];
        if (selector === "button") return [reveal];
        return [];
      },
    };
    class FakeMutationObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (selector === "#app-shell-sidebar" ? sidebar : null),
      querySelectorAll: (selector: string) =>
        selector === "[data-app-action-sidebar-thread-row]" ? rows : [],
      documentElement: {},
    });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    await openRendererThread(hostThreadIdSchema.parse("hidden-thread"), {
      hostId: "local",
      timeoutMs: 60_000,
    });

    // 展开一次、打开会话后再折叠还原，项目头被点击两次，且最终处于折叠状态。
    expect(header.click).toHaveBeenCalledTimes(2);
    expect(expanded).toBe(false);
    expect(target.click).toHaveBeenCalledOnce();
  });

  it("expands only the requested project and keeps it open for scroll focus", async () => {
    const rows: HTMLElement[] = [];
    let targetExpanded = false;
    const target = sidebarRow("project-thread", "local", "project-thread", null);
    const targetHeader = {
      isConnected: true,
      getAttribute: (name: string) =>
        name === "aria-expanded"
          ? String(targetExpanded)
          : name === "data-app-action-sidebar-project-label"
            ? "Target Project"
            : null,
      click: vi.fn(() => {
        targetExpanded = true;
        rows.push(target);
      }),
    } as unknown as HTMLElement;
    const container = {
      contains: (element: Node) => element === targetHeader,
      querySelector: (selector: string) =>
        selector === "[data-app-action-sidebar-project-row]" ? targetHeader : null,
      querySelectorAll: (selector: string) =>
        selector === "[data-app-action-sidebar-project-row]" ? [targetHeader] : [],
    } as unknown as HTMLElement;
    Object.defineProperty(target, "closest", {
      value: (selector: string) =>
        selector === "[data-sidebar-project-container-id]" ? container : null,
    });

    const otherHeader = {
      isConnected: true,
      getAttribute: (name: string) =>
        name === "aria-expanded"
          ? "false"
          : name === "data-app-action-sidebar-project-label"
            ? "Other Project"
            : null,
      click: vi.fn(),
    } as unknown as HTMLElement;
    const otherContainer = {
      contains: () => false,
      querySelector: (selector: string) =>
        selector === "[data-app-action-sidebar-project-row]" ? otherHeader : null,
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
    const sidebar = {
      querySelectorAll: (selector: string) => {
        if (selector === "[data-sidebar-project-container-id]") return [container, otherContainer];
        if (selector === "[data-app-action-sidebar-project-row]")
          return [targetHeader, otherHeader];
        if (selector === "button") return [];
        return [];
      },
    };
    class FakeMutationObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (selector === "#app-shell-sidebar" ? sidebar : null),
      querySelectorAll: (selector: string) =>
        selector === "[data-app-action-sidebar-thread-row]" ? rows : [],
      documentElement: {},
    });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    const opening = openRendererThread(hostThreadIdSchema.parse("project-thread"), {
      hostId: "local",
      project: "Target Project",
      timeoutMs: 60_000,
    });
    await opening;

    expect(targetHeader.click).toHaveBeenCalledOnce();
    expect(otherHeader.click).not.toHaveBeenCalled();
    expect(targetExpanded).toBe(true);
    expect(target.click).toHaveBeenCalledOnce();
  });

  it("clicks the native load-more control to reveal a Thread, then restores it", async () => {
    const rows: HTMLElement[] = [];
    const target = sidebarRow("paged-thread", "local");
    // 原生第一次点击展开列表并挂载目标行，第二次点击（此时按钮变为“Show less”）
    // 收起列表；两次都走同一个 onExpandedChange 契约。
    let expanded = false;
    const onExpandedChange = vi.fn(() => {
      expanded = !expanded;
      if (expanded) rows.push(target);
    });
    const reveal = pagingButton({ onExpandedChange });
    const sidebar = {
      querySelectorAll: (selector: string) => (selector === "button" ? [reveal] : []),
    };
    class FakeMutationObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (selector === "#app-shell-sidebar" ? sidebar : null),
      querySelectorAll: (selector: string) =>
        selector === "[data-app-action-sidebar-thread-row]" ? rows : [],
      documentElement: {},
    });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    await openRendererThread(hostThreadIdSchema.parse("paged-thread"), {
      hostId: "local",
      timeoutMs: 60_000,
    });

    expect(reveal.click).toHaveBeenCalledTimes(2);
    expect(expanded).toBe(false);
    expect(target.click).toHaveBeenCalledOnce();
  });

  it("waits for an asynchronously mounted load-more control", async () => {
    const rows: HTMLElement[] = [];
    const target = sidebarRow("paged-thread", "local");
    let expanded = false;
    const onExpandedChange = vi.fn(() => {
      expanded = !expanded;
      if (expanded) rows.push(target);
    });
    const reveal = pagingButton({ onExpandedChange });
    let queries = 0;
    const sidebar = {
      querySelectorAll: (selector: string) =>
        selector === "button" && ++queries > 1 ? [reveal] : [],
    };
    class FakeMutationObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (selector === "#app-shell-sidebar" ? sidebar : null),
      querySelectorAll: (selector: string) =>
        selector === "[data-app-action-sidebar-thread-row]" ? rows : [],
      documentElement: {},
    });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    await openRendererThread(hostThreadIdSchema.parse("paged-thread"), {
      hostId: "local",
      timeoutMs: 60_000,
    });

    expect(reveal.click).toHaveBeenCalledTimes(2);
    expect(expanded).toBe(false);
    expect(target.click).toHaveBeenCalledOnce();
  });

  it("stops paginating once the native list has no more items", async () => {
    const reveal = { click: vi.fn() } as unknown as HTMLButtonElement;
    Object.defineProperty(reveal, "__reactFiber$test", {
      value: {
        memoizedProps: { expanded: true, hasMoreItems: false, onExpandedChange: vi.fn() },
        return: null,
      },
    });
    const sidebar = {
      querySelectorAll: (selector: string) => (selector === "button" ? [reveal] : []),
    };
    class FakeMutationObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (selector === "#app-shell-sidebar" ? sidebar : null),
      querySelectorAll: () => [],
      documentElement: {},
    });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    const opening = openRendererThread(hostThreadIdSchema.parse("absent-thread"), {
      hostId: "local",
      timeoutMs: 40,
    });

    await expect(opening).rejects.toThrow("Thread did not appear in the sidebar");
    expect(reveal.click).not.toHaveBeenCalled();
  });

  it("folds revealed projects and lists back when the target never appears", async () => {
    // 目标行始终找不到时，reveal 期间打开的项目头与“Show more”列表必须在超时后
    // 还原，避免侧栏残留展开形态。这里没有目标行，因此列表会继续分页直到超时。
    vi.useFakeTimers();
    // 项目头初始折叠；reveal 展开它、超时后再折叠回来。
    let headerExpanded = false;
    const header = {
      isConnected: true,
      getAttribute: (name: string) => (name === "aria-expanded" ? String(headerExpanded) : null),
      click: vi.fn(() => {
        headerExpanded = !headerExpanded;
      }),
    } as unknown as HTMLElement;
    let expanded = false;
    const reveal = pagingButton({
      onExpandedChange: () => {
        expanded = !expanded;
      },
    });
    const sidebar = {
      querySelectorAll: (selector: string) => {
        if (selector === "[data-app-action-sidebar-project-row]") return [header];
        if (selector === "button") return [reveal];
        return [];
      },
    };
    class FakeMutationObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (selector === "#app-shell-sidebar" ? sidebar : null),
      querySelectorAll: () => [],
      documentElement: {},
    });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    const opening = openRendererThread(hostThreadIdSchema.parse("absent-thread"), {
      hostId: "local",
      timeoutMs: 300,
    });
    const rejection = expect(opening).rejects.toThrow("Thread did not appear in the sidebar");
    // 第一轮（120ms）先展开折叠的项目头。
    await vi.advanceTimersByTimeAsync(121);
    expect(header.click).toHaveBeenCalledTimes(1);
    // 第二轮（240ms）再点开“Show more”列表。
    await vi.advanceTimersByTimeAsync(121);
    expect(reveal.click).toHaveBeenCalledTimes(1);
    // 300ms 超时：统一还原，列表收起（Show less），项目头折叠。
    await vi.advanceTimersByTimeAsync(70);
    await rejection;

    expect(reveal.click).toHaveBeenCalledTimes(2);
    expect(expanded).toBe(false);
    // 项目头展开一次、还原折叠一次，最终回到折叠态。
    expect(header.click).toHaveBeenCalledTimes(2);
    expect(headerExpanded).toBe(false);
  });

  it("does not expand unrelated projects while the requested project is missing", async () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const header = { getAttribute: () => "false", click };
    vi.stubGlobal("document", {
      querySelector: () => ({
        querySelectorAll: (selector: string) =>
          selector === "[data-app-action-sidebar-project-row]" ? [header] : [],
      }),
      querySelectorAll: () => [],
      documentElement: {},
    });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const opening = openRendererThread(hostThreadIdSchema.parse("missing"), {
      hostId: "remote",
      project: "not-mounted",
      timeoutMs: 1000,
    });
    const rejected = expect(opening).rejects.toThrow("Thread did not appear");
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(click).not.toHaveBeenCalled();
  });

  it("resolves a Fork button only when DOM and Fiber identities agree", () => {
    expect(rendererForkTargetFromButton(forkButton())).toMatchObject({
      isProjectlessConversation: false,
      threadId: "source-thread",
      turnId: "source-turn",
    });
    expect(
      rendererForkTargetFromButton(forkButton({ fiberThreadId: "different-thread" })),
    ).toBeNull();
    expect(rendererForkTargetFromButton(forkButton({ fiberTurnId: "different-turn" }))).toBeNull();
    expect(rendererForkTargetFromButton(forkButton({ forkSignature: false }))).toBeNull();
    expect(rendererForkTargetFromButton(forkButton({ projectlessSignature: false }))).toBeNull();
  });

  it("intercepts a projectless external Fork and opens the derived Thread", async () => {
    const dom = new FakeForkDom();
    const client = clientWith({
      owner: "external",
      harnessId: "pi",
      transportModelId: "codexhost/pi-native",
      history: { fork: true, forkAcrossCwd: true, rollbackLastTurn: false },
      locked: true,
    });
    const control = installRendererForkControl({ getClient: () => client, dom });

    expect(dom.emit(target())).toBe(true);
    await settle();

    expect(client.forkThread).toHaveBeenCalledWith({
      threadId: "source-thread",
      lastTurnId: "source-turn",
    });
    expect(dom.openThread).toHaveBeenCalledWith("derived-thread");
    expect(dom.replay).not.toHaveBeenCalled();
    control.dispose();
  });

  it("replays the native destination flow for a project external Thread", async () => {
    const dom = new FakeForkDom();
    const client = clientWith({
      owner: "external",
      harnessId: "pi",
      transportModelId: "codexhost/pi-native",
      history: { fork: true, forkAcrossCwd: true, rollbackLastTurn: false },
      locked: true,
    });
    const source = target(false);
    const control = installRendererForkControl({ getClient: () => client, dom });

    expect(dom.emit(source)).toBe(true);
    await settle();

    expect(dom.replay).toHaveBeenCalledWith(source);
    expect(client.forkThread).not.toHaveBeenCalled();
    control.dispose();
  });

  it("replays the native destination flow for a project Thread without cross-cwd capability", async () => {
    const dom = new FakeForkDom();
    const client = clientWith({
      owner: "external",
      harnessId: "claude-code",
      transportModelId: "codexhost/claude-code-native",
      history: { fork: true, forkAcrossCwd: false, rollbackLastTurn: false },
      locked: true,
    });
    const source = target(false);
    const control = installRendererForkControl({ getClient: () => client, dom });

    expect(dom.emit(source)).toBe(true);
    await settle();

    expect(dom.replay).toHaveBeenCalledWith(source);
    expect(client.forkThread).not.toHaveBeenCalled();
    expect(dom.openThread).not.toHaveBeenCalled();
    control.dispose();
  });

  it("replays the native action for a Codex-owned Thread", async () => {
    const dom = new FakeForkDom();
    const client = clientWith({ owner: "codex", locked: true });
    const source = target();
    const control = installRendererForkControl({ getClient: () => client, dom });

    expect(dom.emit(source)).toBe(true);
    await settle();

    expect(dom.replay).toHaveBeenCalledWith(source);
    expect(client.forkThread).not.toHaveBeenCalled();
    control.dispose();
  });

  it("leaves the native action untouched when the fixed request client is unavailable", () => {
    const dom = new FakeForkDom();
    const control = installRendererForkControl({ getClient: () => null, dom });

    expect(dom.emit(target())).toBe(false);
    control.dispose();
    expect(dom.listener).toBeNull();
  });
});
