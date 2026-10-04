import { describe, expect, it, vi } from "vitest";

import type { RendererModelClient } from "../src/renderer-model-client.js";
import { installRendererThreadActions } from "../src/renderer-thread-actions.js";
import type { ThreadTerminalPreferenceStore } from "../src/thread-terminal-preference.js";

/**
 * A deliberately small DOM shim. It implements only the surface the thread
 * actions module touches: element creation, attribute/closest/querySelector,
 * events, layout metrics, and MutationObserver-less refresh scheduling.
 */
class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  parentElement: FakeElement | null = null;
  textContent = "";
  title = "";
  disabled = false;
  type = "";
  style: Record<string, string> = {};
  removed = false;

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  get isConnected(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: FakeElement | null = this;
    while (node.parentElement) node = node.parentElement;
    return node === this.ownerDocument.body || node.ownerDocument.body.contains(node);
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement?.removeChild(node);
      node.parentElement = this;
      this.children.push(node);
    }
  }

  appendChild(node: FakeElement): FakeElement {
    this.append(node);
    return node;
  }

  insertBefore(node: FakeElement, reference: FakeElement | null): void {
    node.parentElement?.removeChild(node);
    node.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }

  removeChild(node: FakeElement): void {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentElement = null;
  }

  remove(): void {
    this.parentElement?.removeChild(this);
    this.removed = true;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  addEventListener(name: string, listener: (event: FakeEvent) => void): void {
    const bucket = this.listeners.get(name) ?? new Set();
    bucket.add(listener);
    this.listeners.set(name, bucket);
  }

  removeEventListener(name: string, listener: (event: FakeEvent) => void): void {
    this.listeners.get(name)?.delete(listener);
  }

  dispatch(name: string, target: FakeElement = this, event = new FakeEvent(name, target)): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
    if (!event.propagationStopped && this.parentElement)
      this.parentElement.dispatch(name, target, event);
  }

  contains(node: FakeElement): boolean {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  getBoundingClientRect(): {
    top: number;
    bottom: number;
    left: number;
    right: number;
    height: number;
    width: number;
  } {
    return { top: 100, bottom: 124, left: 200, right: 224, height: 24, width: 24 };
  }

  private matchesAttributes(selector: string): boolean {
    const attribute = selector.match(/^\[([^\]]+)\]$/u)?.[1];
    return attribute ? this.attributes.has(attribute) : false;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
      for (const child of node.children) {
        if (selector.startsWith("[")) {
          if (child.matchesAttributes(selector)) results.push(child);
        } else if (child.tagName === selector) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector: string): FakeElement | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: FakeElement | null = this;
    while (node) {
      if (node.matchesAttributes(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
}

class FakeEvent {
  defaultPrevented = false;
  propagationStopped = false;
  readonly clientX = 300;
  readonly clientY = 200;
  constructor(
    readonly type: string,
    readonly target: FakeElement,
  ) {}
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

class FakeDocument {
  readonly clipboardWriteText = vi.fn(async () => undefined);
  readonly defaultView = {
    navigator: {
      clipboard: {
        writeText: this.clipboardWriteText,
      },
    },
  };
  readonly head = new FakeElement("head", this);
  readonly body = new FakeElement("body", this);
  readonly documentElement = new FakeElement("html", this);
  readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  rows: FakeElement[] = [];
  readonly titleTriggers = new Map<FakeElement, FakeElement>();

  constructor() {
    this.documentElement.append(this.head, this.body);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === "[data-app-action-sidebar-thread-row]") return this.rows;
    return [];
  }

  addEventListener(name: string, listener: (event: FakeEvent) => void): void {
    const bucket = this.listeners.get(name) ?? new Set();
    bucket.add(listener);
    this.listeners.set(name, bucket);
  }

  removeEventListener(name: string, listener: (event: FakeEvent) => void): void {
    this.listeners.get(name)?.delete(listener);
  }

  dispatch(name: string, target: FakeElement, event = new FakeEvent(name, target)): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

function installFakeBrowser(): FakeDocument {
  const document_ = new FakeDocument();
  vi.stubGlobal("document", document_);
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal("Node", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("window", {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal("queueMicrotask", (callback: () => void) => callback());
  return document_;
}

function sidebarRow(document_: FakeDocument, hostId: string, threadId: string): FakeElement {
  const row = document_.createElement("div");
  row.setAttribute("data-app-action-sidebar-thread-row", "");
  row.setAttribute("data-app-action-sidebar-thread-host-id", hostId);
  row.setAttribute("data-app-action-sidebar-thread-id", `${hostId}:${threadId}`);
  const actions = document_.createElement("div");
  const titleTrigger = document_.createElement("button");
  titleTrigger.setAttribute("data-thread-title-trigger", "");
  actions.append(titleTrigger);
  row.append(actions);
  document_.rows.push(row);
  document_.titleTriggers.set(row, titleTrigger);
  // Resolve the native Thread id through the same fiber contract the module uses.
  const fiberKey = "__reactFiber$test";
  const props = {
    conversationId: threadId,
    dataAttributes: {
      "data-app-action-sidebar-thread-row": "",
      "data-app-action-sidebar-thread-id": `${hostId}:${threadId}`,
      "data-app-action-sidebar-thread-host-id": hostId,
    },
  };
  Object.defineProperty(row, fiberKey, {
    value: { memoizedProps: props },
    enumerable: true,
    configurable: true,
  });
  return row;
}

function clientWith(openThreadTerminal: (input: { threadId: string }) => Promise<unknown>) {
  const listThreadTerminals = vi.fn(async () => ({
    terminals: [
      { id: "apple-terminal", name: "Terminal", installed: true, default: true },
      { id: "ghostty", name: "Ghostty", installed: true, default: false },
      { id: "warp", name: "Warp", installed: false, default: false },
    ],
  }));
  return {
    forkThread: vi.fn(),
    inspectHarness: vi.fn(),
    inspectThread: vi.fn(),
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
    readUpdateStatus: vi.fn(),
    listCodexAccounts: vi.fn(),
    refreshCodexAccounts: vi.fn(),
    listThreadTerminals,
    openThreadTerminal: vi.fn(openThreadTerminal),
    openThreadWorkspace: vi.fn(async () => ({ workspace: "/tmp/repo", application: "vscode" })),
  } as unknown as RendererModelClient & {
    listThreadTerminals: ReturnType<typeof vi.fn>;
    openThreadTerminal: ReturnType<typeof vi.fn>;
    openThreadWorkspace: ReturnType<typeof vi.fn>;
  };
}

function archiveClient(archiveCompletedThreads: (threadId: string) => Promise<unknown>) {
  const client = clientWith(async () => ({ workspace: "/tmp/repo", terminal: "terminal" }));
  return Object.assign(client, {
    archiveCompletedThreads: vi.fn(archiveCompletedThreads),
  });
}

async function openRowMenu(row: FakeElement, document_: FakeDocument): Promise<FakeElement> {
  const trigger = required(
    row.querySelector("[data-codexhost-thread-actions-trigger]"),
    "trigger was not injected",
  );
  trigger.dispatch("click");
  return required(
    document_.body.querySelector("[data-codexhost-thread-actions-menu]"),
    "menu was not opened",
  );
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function preference(selected: ReturnType<ThreadTerminalPreferenceStore["get"]>) {
  let value = selected;
  return {
    get: () => value,
    set: vi.fn((next: ReturnType<ThreadTerminalPreferenceStore["get"]>) => {
      value = next;
    }),
    subscribe: () => () => undefined,
  } satisfies ThreadTerminalPreferenceStore;
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

describe("renderer thread actions", () => {
  it("injects exactly one more-actions trigger per resolvable row", () => {
    const document_ = installFakeBrowser();
    const row = sidebarRow(document_, "local", "thread-a");
    const client = clientWith(async () => ({
      workspace: "/tmp/repo",
      terminal: "apple-terminal",
      mode: "resume",
    }));
    const installed = installRendererThreadActions({
      getClient: () => client,
      getLocale: () => "zh-CN",
    });

    installed.refresh();
    expect(row.querySelectorAll("[data-codexhost-thread-actions-trigger]")).toHaveLength(1);

    // Removing and re-adding the trigger must not accumulate duplicates when
    // React reuses the same row element across renders.
    installed.refresh();
    expect(row.querySelectorAll("[data-codexhost-thread-actions-trigger]")).toHaveLength(1);
    installed.dispose();
  });

  it("opens the resolved thread in the terminal and stops row propagation", async () => {
    const document_ = installFakeBrowser();
    const row = sidebarRow(document_, "local", "thread-a");
    const client = clientWith(async () => ({ workspace: "/tmp/repo", terminal: "terminal" }));
    const installed = installRendererThreadActions({
      getClient: () => client,
      getLocale: () => "en",
      terminalPreference: preference(null),
    });
    installed.refresh();

    const portal = await openRowMenu(row, document_);
    expect(portal).toBeTruthy();
    const item = required(portal.querySelector("button"), "menu item was not rendered");
    item.dispatch("click");
    await settle();

    expect(client.openThreadTerminal).toHaveBeenCalledWith({
      threadId: "thread-a",
      terminalId: "apple-terminal",
    });
    installed.dispose();
  });

  it("resolves an SSH session remotely and opens it with the local terminal preference", async () => {
    const document_ = installFakeBrowser();
    const hostId = "remote-ssh-discovered:okm252";
    const row = sidebarRow(document_, hostId, "thread-a");
    const local = clientWith(async () => ({
      workspace: "/remote/repo",
      terminal: "ghostty",
      mode: "resume",
    }));
    const remote = clientWith(async () => {
      throw new Error("must not start a remote GUI");
    });
    const target = {
      workspace: "/remote/repo",
      codexPath: "/remote/bin/codex",
      codexHome: "/remote/.codex",
    };
    remote.threadOpenTarget = vi.fn(async () => target);
    const installed = installRendererThreadActions({
      getClient: (id) => (id === "local" ? local : id === hostId ? remote : null),
      getLocale: () => "zh-CN",
      terminalPreference: preference("ghostty"),
    });
    installed.refresh();
    const portal = await openRowMenu(row, document_);
    required(portal.querySelector("button"), "terminal action").dispatch("click");
    await settle();
    expect(remote.threadOpenTarget).toHaveBeenCalledWith("thread-a");
    expect(remote.listThreadTerminals).not.toHaveBeenCalled();
    expect(remote.openThreadTerminal).not.toHaveBeenCalled();
    expect(local.openThreadTerminal).toHaveBeenCalledWith({
      threadId: "thread-a",
      terminalId: "ghostty",
      remote: { ...target, hostId },
    });
    installed.dispose();
  });

  it("does not launch a terminal after the SSH connection changes while resolving the session", async () => {
    const document_ = installFakeBrowser();
    const hostId = "remote-ssh-discovered:okm252";
    const row = sidebarRow(document_, hostId, "thread-a");
    const local = clientWith(async () => ({}));
    const remote = clientWith(async () => ({}));
    let connected = true;
    let resolveTarget!: (value: {
      workspace: string;
      codexPath: string;
      codexHome: string;
    }) => void;
    remote.threadOpenTarget = vi.fn(
      () =>
        new Promise<{ workspace: string; codexPath: string; codexHome: string }>((resolve) => {
          resolveTarget = resolve;
        }),
    );
    const installed = installRendererThreadActions({
      getClient: (id) => (id === "local" ? local : connected ? remote : null),
      getLocale: () => "zh-CN",
    });
    installed.refresh();
    const portal = await openRowMenu(row, document_);
    required(portal.querySelector("button"), "terminal action").dispatch("click");
    await settle();
    connected = false;
    resolveTarget({
      workspace: "/remote/repo",
      codexPath: "/bin/codex",
      codexHome: "/remote/.codex",
    });
    await settle();
    expect(local.openThreadTerminal).not.toHaveBeenCalled();
    expect(remote.openThreadTerminal).not.toHaveBeenCalled();
    installed.dispose();
  });

  it("opens with the installed default terminal selected in Settings", async () => {
    const document_ = installFakeBrowser();
    const row = sidebarRow(document_, "local", "thread-a");
    const client = clientWith(async () => ({
      workspace: "/tmp/repo",
      terminal: "ghostty",
      mode: "resume",
    }));
    const installed = installRendererThreadActions({
      getClient: () => client,
      getLocale: () => "zh-CN",
      terminalPreference: preference("ghostty"),
    });
    installed.refresh();

    const portal = await openRowMenu(row, document_);
    const item = required(portal.querySelector("button"), "menu item was not rendered");
    expect(portal.querySelectorAll("button")).toHaveLength(3);
    item.dispatch("click");
    await settle();

    expect(client.openThreadTerminal).toHaveBeenCalledWith({
      threadId: "thread-a",
      terminalId: "ghostty",
    });
    installed.dispose();
  });

  it("opens the resolved thread workspace in VS Code", async () => {
    const document_ = installFakeBrowser();
    const row = sidebarRow(document_, "local", "thread-a");
    const client = clientWith(async () => ({ workspace: "/tmp/repo", terminal: "terminal" }));
    const installed = installRendererThreadActions({
      getClient: () => client,
      getLocale: () => "zh-CN",
    });
    installed.refresh();

    const portal = await openRowMenu(row, document_);
    const vscode = required(
      portal.querySelector("[data-codexhost-thread-actions-open-vscode]"),
      "VS Code item was not rendered",
    );
    expect(vscode.children.some((child) => child.textContent.includes("用 VS Code 打开"))).toBe(
      true,
    );
    vscode.dispatch("click");
    await settle();

    expect(client.openThreadWorkspace).toHaveBeenCalledWith({ threadId: "thread-a" });
    installed.dispose();
  });

  it("reports VS Code open failures and allows retry", async () => {
    const document_ = installFakeBrowser();
    const row = sidebarRow(document_, "local", "thread-a");
    const client = clientWith(async () => ({ workspace: "/tmp/repo", terminal: "terminal" }));
    client.openThreadWorkspace
      .mockRejectedValueOnce(new Error("未安装 Visual Studio Code"))
      .mockResolvedValueOnce({ workspace: "/tmp/repo", application: "vscode" });
    const installed = installRendererThreadActions({
      getClient: () => client,
      getLocale: () => "zh-CN",
    });
    installed.refresh();

    const portal = await openRowMenu(row, document_);
    const vscode = required(
      portal.querySelector("[data-codexhost-thread-actions-open-vscode]"),
      "VS Code item was not rendered",
    );
    const error = required(
      portal.querySelector("[data-codexhost-thread-actions-error]"),
      "error element was not rendered",
    );
    vscode.dispatch("click");
    await settle();

    expect(error.textContent).toBe("用 VS Code 打开: 未安装 Visual Studio Code");
    expect(vscode.disabled).toBe(false);
    vscode.dispatch("click");
    await settle();
    expect(client.openThreadWorkspace).toHaveBeenCalledTimes(2);
    installed.dispose();
  });

  it("leaves the native row right-click menu untouched", () => {
    const document_ = installFakeBrowser();
    const row = sidebarRow(document_, "local", "thread-b");
    const client = clientWith(async () => ({ workspace: "/tmp/repo", terminal: "terminal" }));
    // Desktop 原生行在捕获/冒泡阶段监听 contextmenu 打开自己的菜单。扩展必须让事件
    // 继续传递，且不得 preventDefault，否则重命名、置顶、归档等原生项会消失。
    const nativeContextMenu = vi.fn();
    row.addEventListener("contextmenu", nativeContextMenu);
    const installed = installRendererThreadActions({
      getClient: () => client,
      getLocale: () => "zh-CN",
    });
    installed.refresh();

    const event = new FakeEvent("contextmenu", row);
    row.dispatch("contextmenu", row, event);

    expect(nativeContextMenu).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(event.propagationStopped).toBe(false);
    expect(document_.body.querySelector("[data-codexhost-thread-actions-menu]")).toBeNull();
    installed.dispose();
  });

  it("archives completed threads from the row menu and reports the result", async () => {
    const document_ = installFakeBrowser();
    const row = sidebarRow(document_, "local", "thread-a");
    const client = archiveClient(async () => ({ archived: 2, skipped: 1, failed: 0 }));
    const installed = installRendererThreadActions({
      getClient: () => client,
      getLocale: () => "zh-CN",
    });
    installed.refresh();

    const portal = await openRowMenu(row, document_);
    const archive = required(
      portal.querySelector("[data-codexhost-thread-actions-archive-completed]"),
      "archive item was not rendered",
    );
    archive.dispatch("click");
    await settle();

    expect(client.archiveCompletedThreads).toHaveBeenCalledWith("thread-a");
    expect(archive.children.some((child) => child.textContent.includes("已归档 2 个"))).toBe(true);
    installed.dispose();
  });

  it("copies the native thread id from the row menu", async () => {
    const document_ = installFakeBrowser();
    const write = Promise.withResolvers<undefined>();
    document_.clipboardWriteText.mockReturnValueOnce(write.promise);
    const row = sidebarRow(document_, "local", "thread-a");
    const client = clientWith(async () => ({ workspace: "/tmp/repo", terminal: "terminal" }));
    const installed = installRendererThreadActions({
      getClient: () => client,
      getLocale: () => "zh-CN",
    });
    installed.refresh();

    const portal = await openRowMenu(row, document_);
    const copy = required(
      portal.querySelector("[data-codexhost-thread-actions-copy-thread-id]"),
      "copy item was not rendered",
    );
    copy.dispatch("click");
    await settle();

    expect(document_.clipboardWriteText).toHaveBeenCalledWith("thread-a");
    expect(copy.disabled).toBe(true);
    expect(copy.children.some((child) => child.textContent.includes("已复制会话 ID"))).toBe(false);
    copy.dispatch("click");
    expect(document_.clipboardWriteText).toHaveBeenCalledTimes(1);

    write.resolve(undefined);
    await settle();
    expect(copy.children.some((child) => child.textContent.includes("已复制会话 ID"))).toBe(true);
    expect(copy.disabled).toBe(false);
    installed.dispose();
  });

  it.each(["unavailable", "missing-write", "throws", "rejects"])(
    "clears stale copy success and allows retry when the clipboard %s",
    async (failure) => {
      const document_ = installFakeBrowser();
      const row = sidebarRow(document_, "local", "thread-a");
      const client = clientWith(async () => ({ workspace: "/tmp/repo", terminal: "terminal" }));
      const installed = installRendererThreadActions({
        getClient: () => client,
        getLocale: () => "zh-CN",
      });
      installed.refresh();
      const portal = await openRowMenu(row, document_);
      const copy = required(
        portal.querySelector("[data-codexhost-thread-actions-copy-thread-id]"),
        "copy item was not rendered",
      );
      const error = required(
        portal.querySelector("[data-codexhost-thread-actions-error]"),
        "error element was not rendered",
      );
      copy.dispatch("click");
      await settle();
      expect(copy.children.some((child) => child.textContent.includes("已复制会话 ID"))).toBe(true);

      const navigator = document_.defaultView.navigator;
      const clipboard = navigator.clipboard;
      switch (failure) {
        case "unavailable":
          Reflect.deleteProperty(navigator, "clipboard");
          break;
        case "missing-write":
          Reflect.set(navigator, "clipboard", {});
          break;
        case "throws":
          document_.clipboardWriteText.mockImplementationOnce(() => {
            throw new Error("Clipboard write failed");
          });
          break;
        case "rejects":
          document_.clipboardWriteText.mockRejectedValueOnce(new Error("Clipboard write denied"));
          break;
      }
      copy.dispatch("click");
      await settle();
      expect(copy.children.some((child) => child.textContent.includes("已复制会话 ID"))).toBe(
        false,
      );
      expect(error.textContent).toBe("复制会话 ID 失败");
      expect(copy.disabled).toBe(false);

      navigator.clipboard = clipboard;
      copy.dispatch("click");
      expect(error.textContent).toBe("");
      await settle();
      expect(copy.children.some((child) => child.textContent.includes("已复制会话 ID"))).toBe(true);
      installed.dispose();
    },
  );

  it("drops a row that loses its thread id and cleans up on dispose", () => {
    const document_ = installFakeBrowser();
    const row = sidebarRow(document_, "local", "thread-a");
    const client = clientWith(async () => ({ workspace: "/tmp/repo", terminal: "terminal" }));
    const installed = installRendererThreadActions({
      getClient: () => client,
      getLocale: () => "en",
    });
    installed.refresh();
    expect(row.querySelectorAll("[data-codexhost-thread-actions-trigger]")).toHaveLength(1);

    delete (row as unknown as Record<string, unknown>)["__reactFiber$test"];
    installed.refresh();
    expect(row.querySelectorAll("[data-codexhost-thread-actions-trigger]")).toHaveLength(0);

    Object.defineProperty(row, "__reactFiber$test", {
      value: {
        memoizedProps: {
          conversationId: "thread-a",
          dataAttributes: {
            "data-app-action-sidebar-thread-row": "",
            "data-app-action-sidebar-thread-id": "local:thread-a",
            "data-app-action-sidebar-thread-host-id": "local",
          },
        },
      },
      enumerable: true,
      configurable: true,
    });
    installed.refresh();
    expect(row.querySelectorAll("[data-codexhost-thread-actions-trigger]")).toHaveLength(1);

    installed.dispose();
    expect(row.querySelectorAll("[data-codexhost-thread-actions-trigger]")).toHaveLength(0);
    expect(document_.body.querySelectorAll("[data-codexhost-thread-actions-menu]")).toHaveLength(0);
  });
});
