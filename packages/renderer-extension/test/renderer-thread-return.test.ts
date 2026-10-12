import { afterEach, describe, expect, it, vi } from "vitest";

import { installRendererThreadReturn } from "../src/renderer-thread-return.js";

/** 只实现本模块用到的 DOM 面：属性、树遍历、创建与移除。 */
class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Array<() => void>>();
  parentElement: FakeElement | null = null;
  textContent = "";
  hidden = false;
  title = "";

  // dataset 与真实 DOM 一样落到 data-* 属性上：模块用 dataset 标记返回按钮，
  // 测试再按属性选择器找回它。
  readonly dataset: Record<string, string>;

  constructor(
    readonly tagName: string,
    private readonly ownerDocument: FakeDocument,
  ) {
    this.dataset = new Proxy({} as Record<string, string>, {
      set: (target, property, value: string) => {
        target[property as string] = value;
        const attribute = `data-${String(property).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
        this.attributes.set(attribute, value);
        return true;
      },
      get: (target, property) => target[property as string],
    });
  }

  get id(): string {
    return this.attributes.get("id") ?? "";
  }

  // className 与真实 DOM 一样落到 class 属性上，选择器才能按类名找回节点。
  get className(): string {
    return this.attributes.get("class") ?? "";
  }

  set className(value: string) {
    this.attributes.set("class", value);
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  appendChild(node: FakeElement): FakeElement {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  remove(): void {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parentElement = null;
  }

  addEventListener(type: string, listener: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
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
  hidden = false;

  constructor() {
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.documentElement = new FakeElement("html", this);
    this.documentElement.append(this.head, this.body);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
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
          const expected = quoted ?? bare;
          if (name === undefined) return false;
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

function sidebarRow(ownerDocument: FakeDocument, threadId: string, hostId: string): FakeElement {
  const row = new FakeElement("div", ownerDocument);
  const attributes = {
    "data-app-action-sidebar-thread-row": "",
    "data-app-action-sidebar-thread-id": `${hostId}:${threadId}`,
    "data-app-action-sidebar-thread-host-id": hostId,
  };
  for (const [name, value] of Object.entries(attributes)) row.setAttribute(name, value);
  Object.defineProperty(row, "__reactFiber$test", {
    value: {
      memoizedProps: { conversationId: threadId, dataAttributes: attributes },
      return: null,
    },
  });
  const title = new FakeElement("span", ownerDocument);
  title.setAttribute("data-thread-title", "");
  title.textContent = `标题 ${threadId}`;
  row.append(title);
  return row;
}

function fixture(input: {
  hostId?: string;
  threads: string[];
  active?: string | null | undefined;
}): {
  ownerDocument: FakeDocument;
  rows: Map<string, FakeElement>;
} {
  const ownerDocument = new FakeDocument();
  const sidebar = ownerDocument.createElement("aside");
  sidebar.setAttribute("id", "app-shell-sidebar");
  const rows = new Map<string, FakeElement>();
  for (const threadId of input.threads) {
    const row = sidebarRow(ownerDocument, threadId, input.hostId ?? "local");
    if (threadId === input.active)
      row.setAttribute("data-app-action-sidebar-thread-active", "true");
    rows.set(threadId, row);
    sidebar.append(row);
  }
  ownerDocument.body.append(sidebar);
  return { ownerDocument, rows };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeMutationObserver.instances = [];
});

interface Setup {
  ownerDocument: FakeDocument;
  control: ReturnType<typeof installRendererThreadReturn>;
  chip: () => FakeElement | null;
  opened: Array<{ threadId: string; hostId: string }>;
  setActive(threadId: string | null): void;
}

function setup(input: {
  hostId?: string;
  threads: string[];
  active?: string | null | undefined;
}): Setup {
  const hostId = input.hostId ?? "local";
  const { ownerDocument, rows } = fixture({ hostId, threads: input.threads, active: input.active });
  vi.stubGlobal("MutationObserver", FakeMutationObserver);
  vi.stubGlobal("document", ownerDocument);
  const opened: Array<{ threadId: string; hostId: string }> = [];
  let active = input.active ?? null;
  const control = installRendererThreadReturn({
    getLocale: () => "zh-CN",
    activeThread: () => (active ? { hostId, threadId: active } : null),
    openThread: async (threadId: string, options: { hostId: string }) => {
      opened.push({ threadId, hostId: options.hostId });
      active = threadId;
      for (const [id, row] of rows) {
        row.setAttribute("data-app-action-sidebar-thread-active", String(id === threadId));
      }
    },
  });
  return {
    ownerDocument,
    control,
    chip: () => ownerDocument.querySelector("[data-codexhost-thread-return]"),
    opened,
    setActive(threadId) {
      active = threadId;
    },
  };
}

describe("thread return entry", () => {
  it("stays hidden until a source conversation is remembered", async () => {
    const f = setup({ threads: ["thread-a", "thread-b"], active: "thread-a" });
    await settle();
    expect(f.chip()?.hidden).toBe(true);
  });

  it("shows a chip naming the origin conversation after remembering it", async () => {
    const f = setup({ threads: ["thread-a", "thread-b"], active: "thread-a" });
    f.control.remember({ hostId: "local", threadId: "thread-b" });
    await settle();
    const chip = f.chip();
    expect(chip?.hidden).toBe(false);
    // 简化版选择器不支持后代组合，逐个按单级选择器取回。
    expect(chip?.querySelector(".codexhost-thread-return-label")?.textContent).toBe(
      "回到刚才的会话",
    );
    expect(chip?.querySelector(".codexhost-thread-return-title")?.textContent).toBe(
      "标题 thread-b",
    );
  });

  it("navigates back to the remembered conversation when clicked", async () => {
    const f = setup({ threads: ["thread-a", "thread-b"], active: "thread-b" });
    f.control.remember({ hostId: "local", threadId: "thread-a" });
    await settle();
    f.chip()?.querySelector("[data-codexhost-thread-return-open]")?.click();
    await settle();
    expect(f.opened).toEqual([{ threadId: "thread-a", hostId: "local" }]);
  });

  it("hides once the user is already back on the origin conversation", async () => {
    const f = setup({ threads: ["thread-a", "thread-b"], active: "thread-b" });
    f.control.remember({ hostId: "local", threadId: "thread-a" });
    await settle();
    expect(f.chip()?.hidden).toBe(false);
    f.setActive("thread-a");
    f.control.refresh();
    await settle();
    expect(f.chip()?.hidden).toBe(true);
  });

  it("does not offer a return entry when the origin equals the destination", async () => {
    const f = setup({ threads: ["thread-a"], active: "thread-a" });
    f.control.remember({ hostId: "local", threadId: "thread-a" });
    await settle();
    expect(f.chip()?.hidden).toBe(true);
  });
});
