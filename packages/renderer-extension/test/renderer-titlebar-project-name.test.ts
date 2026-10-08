import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installRendererTitlebarProjectName,
  sidebarProjectLabelForThread,
  titlebarProjectNameFromIcon,
} from "../src/renderer-titlebar-project-name.js";

/** 只实现本模块用到的 DOM 面：属性、树遍历与命中测试。 */
class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  textContent = "";

  constructor(
    readonly tagName: string,
    private readonly ownerDocument: FakeDocument,
  ) {}

  get id(): string {
    return this.attributes.get("id") ?? "";
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
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

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  remove(): void {
    const siblings = this.parentElement?.children;
    if (!siblings) return;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  matches(selector: string): boolean {
    return matches(this, selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      for (const child of node.children) {
        if (matches(child, selector)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector: string): FakeElement | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: FakeElement | null = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
}

class FakeDocument {
  readonly head: FakeElement;
  readonly body: FakeElement;
  readonly documentElement: FakeElement;

  constructor() {
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.documentElement = new FakeElement("html", this);
    this.documentElement.append(this.head, this.body);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector: string): FakeElement | null {
    return this.documentElement.querySelector(selector);
  }
}

function matches(element: FakeElement, selector: string): boolean {
  return selector
    .split(",")
    .map((part) => part.trim())
    .some((part) => {
      const tokens = part.match(/^[a-zA-Z]+|#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) ?? [];
      return tokens.every((token) => {
        if (token.startsWith("#")) return element.id === token.slice(1);
        if (token.startsWith(".")) return element.attributes.get("class")?.includes(token.slice(1));
        if (token.startsWith("[")) {
          const parsed = token.slice(1, -1).match(/^([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?$/);
          if (!parsed) return false;
          const [, name, quoted, bare] = parsed;
          if (name === undefined) return false;
          const expected = quoted ?? bare;
          if (expected === undefined) return element.hasAttribute(name);
          return element.getAttribute(name) === expected;
        }
        return element.tagName.toLowerCase() === token.toLowerCase();
      });
    });
}

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];
  disconnected = false;

  constructor(private readonly callback: MutationCallback) {
    FakeMutationObserver.instances.push(this);
  }

  observe(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  deliver(records: MutationRecord[]): void {
    this.callback(records, this as unknown as MutationObserver);
  }
}

function fiber(icon: FakeElement, props: Record<string, unknown>[]): void {
  let chain: Record<string, unknown> | null = null;
  for (const entry of props.toReversed()) chain = { memoizedProps: entry, return: chain };
  Object.defineProperty(icon, "__reactFiber$test", { value: chain, configurable: true });
}

/** 只造图标自身的 Fiber 链，避免为单测复刻整棵已提交 React 树。 */
function iconWith(props: Record<string, unknown>[]): Element {
  const icon = { getAttribute: () => null } as unknown as FakeElement;
  fiber(icon, props);
  return icon as unknown as Element;
}

function titlebarFixture(input: { iconProps?: Record<string, unknown>[] } = {}): {
  ownerDocument: FakeDocument;
  content: FakeElement;
  icon: FakeElement;
} {
  const ownerDocument = new FakeDocument();
  const content = ownerDocument.createElement("span");
  content.setAttribute("data-app-shell-titlebar-content", "true");
  const icon = ownerDocument.createElement("span");
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", "项目：fallback");
  if (input.iconProps) fiber(icon, input.iconProps);
  const title = ownerDocument.createElement("div");
  title.textContent = "当前会话";
  content.append(icon, title);
  ownerDocument.body.append(content);
  return { ownerDocument, content, icon };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeMutationObserver.instances = [];
});

describe("titlebar project name resolution", () => {
  it("prefers the Desktop project identity over the tooltip", () => {
    const icon = iconWith([{ tooltipContent: "remote_iot-app" }, { project: { name: "iot-app" } }]);
    expect(titlebarProjectNameFromIcon(icon)).toBe("iot-app");
  });

  it("falls back to the tooltip when the project identity is unavailable", () => {
    expect(titlebarProjectNameFromIcon(iconWith([{ tooltipContent: "sub2api" }]))).toBe("sub2api");
  });

  it("ignores unrelated tooltips deeper in the tree and missing icons", () => {
    expect(titlebarProjectNameFromIcon(iconWith([{ tooltipContent: "unrelated" }]))).toBe(
      "unrelated",
    );
    expect(titlebarProjectNameFromIcon(null)).toBeNull();
  });

  it("reads the sidebar project label for the viewed thread as a fallback", () => {
    const ownerDocument = new FakeDocument();
    const sidebar = ownerDocument.createElement("aside");
    sidebar.setAttribute("id", "app-shell-sidebar");
    const container = ownerDocument.createElement("div");
    container.setAttribute("data-sidebar-project-container-id", "project:1");
    const header = ownerDocument.createElement("div");
    header.setAttribute("data-app-action-sidebar-project-row", "");
    header.setAttribute("data-app-action-sidebar-project-label", "remote_iot-app");
    const row = ownerDocument.createElement("div");
    const attributes = {
      "data-app-action-sidebar-thread-row": "",
      "data-app-action-sidebar-thread-id": "local:thread-1",
      "data-app-action-sidebar-thread-host-id": "local",
    };
    for (const [name, value] of Object.entries(attributes)) row.setAttribute(name, value);
    Object.defineProperty(row, "__reactFiber$test", {
      value: {
        memoizedProps: { conversationId: "thread-1", dataAttributes: attributes },
        return: null,
      },
    });
    container.append(header, row);
    sidebar.append(container);
    ownerDocument.body.append(sidebar);

    expect(
      sidebarProjectLabelForThread(ownerDocument as unknown as Document, {
        hostId: "local",
        threadId: "thread-1",
      }),
    ).toBe("remote_iot-app");
    expect(
      sidebarProjectLabelForThread(ownerDocument as unknown as Document, {
        hostId: "local",
        threadId: "nope",
      }),
    ).toBeNull();
  });
});

describe("Renderer titlebar project name", () => {
  it("labels the titlebar with the project name and re-applies after a re-render", async () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const { ownerDocument, content, icon } = titlebarFixture({
      iconProps: [{ project: { name: "iot-app" } }],
    });
    vi.stubGlobal("document", ownerDocument);
    const control = installRendererTitlebarProjectName({
      getActiveThread: () => ({ hostId: "local", threadId: "thread-1" }),
    });

    await settle();
    expect(content.getAttribute("data-codexhost-titlebar-project")).toBe("iot-app");

    // React 重渲染会换掉图标实例；重新对齐后仍应写出项目名。
    fiber(icon, [{ project: { name: "iot-app" } }]);
    control.refresh();
    await settle();
    expect(content.getAttribute("data-codexhost-titlebar-project")).toBe("iot-app");

    control.dispose();
    expect(content.hasAttribute("data-codexhost-titlebar-project")).toBe(false);
    expect(ownerDocument.querySelectorAll("[data-codexhost-titlebar-project]")).toHaveLength(0);
  });

  it("uses the sidebar project label when the titlebar icon exposes no project", async () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const { ownerDocument, content } = titlebarFixture();
    const sidebar = ownerDocument.createElement("aside");
    sidebar.setAttribute("id", "app-shell-sidebar");
    const container = ownerDocument.createElement("div");
    container.setAttribute("data-sidebar-project-container-id", "project:1");
    const header = ownerDocument.createElement("div");
    header.setAttribute("data-app-action-sidebar-project-row", "");
    header.setAttribute("data-app-action-sidebar-project-label", "remote_iot-app");
    const row = ownerDocument.createElement("div");
    const attributes = {
      "data-app-action-sidebar-thread-row": "",
      "data-app-action-sidebar-thread-id": "local:thread-1",
      "data-app-action-sidebar-thread-host-id": "local",
    };
    for (const [name, value] of Object.entries(attributes)) row.setAttribute(name, value);
    Object.defineProperty(row, "__reactFiber$test", {
      value: {
        memoizedProps: { conversationId: "thread-1", dataAttributes: attributes },
        return: null,
      },
    });
    container.append(header, row);
    sidebar.append(container);
    ownerDocument.body.append(sidebar);
    vi.stubGlobal("document", ownerDocument);
    const control = installRendererTitlebarProjectName({
      getActiveThread: () => ({ hostId: "local", threadId: "thread-1" }),
    });

    await settle();
    expect(content.getAttribute("data-codexhost-titlebar-project")).toBe("remote_iot-app");
    control.dispose();
  });

  it("clears the label on non-conversation routes without a titlebar content node", async () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const { ownerDocument, content } = titlebarFixture({
      iconProps: [{ project: { name: "iot-app" } }],
    });
    vi.stubGlobal("document", ownerDocument);
    const control = installRendererTitlebarProjectName({
      getActiveThread: () => ({ hostId: "local", threadId: "thread-1" }),
    });
    await settle();
    expect(content.getAttribute("data-codexhost-titlebar-project")).toBe("iot-app");

    // 非会话路由（例如图片查看）没有该节点。
    content.parentElement?.children.splice(content.parentElement.children.indexOf(content), 1);
    control.refresh();
    await settle();
    expect(ownerDocument.querySelectorAll("[data-codexhost-titlebar-project]")).toHaveLength(0);
    control.dispose();
  });
});
