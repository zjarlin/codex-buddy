import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installRendererSidebarThreadAlign,
  sidebarAlignDelta,
  sidebarProjectFocusDelta,
} from "../src/renderer-sidebar-thread-align.js";

/** 只实现本模块用到的 DOM 面：属性、树遍历、命中测试与布局矩形。 */
class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  scrollTop = 0;
  rect = { top: 0, bottom: 0, height: 0 };

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

  getBoundingClientRect(): { top: number; bottom: number; height: number } {
    return this.rect;
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
  return row;
}

interface Fixture {
  ownerDocument: FakeDocument;
  scroller: FakeElement;
  row: FakeElement;
}

function fixture(input: {
  threadId: string;
  hostId?: string;
  rowRect: { top: number; bottom: number; height: number };
  scrollerRect?: { top: number; bottom: number; height: number };
  scrollTop?: number;
  projectHeaderRect?: { top: number; bottom: number; height: number } | null;
}): Fixture {
  const ownerDocument = new FakeDocument();
  const sidebar = ownerDocument.createElement("aside");
  sidebar.setAttribute("id", "app-shell-sidebar");
  const scroller = ownerDocument.createElement("div");
  scroller.setAttribute("data-app-action-sidebar-scroll", "");
  scroller.rect = input.scrollerRect ?? { top: 100, bottom: 600, height: 500 };
  scroller.scrollTop = input.scrollTop ?? 0;
  const row = sidebarRow(ownerDocument, input.threadId, input.hostId ?? "local");
  row.rect = input.rowRect;
  const container =
    input.projectHeaderRect == null
      ? scroller
      : projectContainer(ownerDocument, input.projectHeaderRect);
  container.append(row);
  scroller.append(container);
  sidebar.append(scroller);
  ownerDocument.body.append(sidebar);
  return { ownerDocument, scroller, row };
}

function projectContainer(
  ownerDocument: FakeDocument,
  headerRect: { top: number; bottom: number; height: number },
): FakeElement {
  const container = ownerDocument.createElement("div");
  container.setAttribute("data-sidebar-project-container-id", "project:p1");
  container.setAttribute("data-sidebar-project-kind", "local");
  const header = ownerDocument.createElement("div");
  header.setAttribute("data-app-action-sidebar-project-row", "");
  header.rect = headerRect;
  container.append(header);
  return container;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeMutationObserver.instances = [];
});

describe("sidebar thread alignment geometry", () => {
  const scroller = { top: 100, bottom: 600, height: 500 };

  it("keeps the current scroll position while the row is fully visible", () => {
    expect(sidebarAlignDelta({ top: 200, bottom: 230, height: 30 }, scroller)).toBeNull();
  });

  it("scrolls a row below the viewport toward the center", () => {
    // 行中心 915 与容器中心 350 的差。
    expect(sidebarAlignDelta({ top: 900, bottom: 930, height: 30 }, scroller)).toBe(565);
  });

  it("scrolls a row above the viewport toward the center", () => {
    expect(sidebarAlignDelta({ top: -200, bottom: -170, height: 30 }, scroller)).toBe(-535);
  });

  it("treats a row inside the visibility margin as visible", () => {
    expect(sidebarAlignDelta({ top: 107, bottom: 137, height: 30 }, scroller)).toBeNull();
    expect(sidebarAlignDelta({ top: 103, bottom: 133, height: 30 }, scroller)).not.toBeNull();
  });
});

describe("sidebar project focus geometry", () => {
  const scroller = { top: 100, bottom: 600, height: 500 };

  it("does nothing while both the project header and the conversation row are visible", () => {
    expect(
      sidebarProjectFocusDelta(
        {
          header: { top: 120, bottom: 150, height: 30 },
          row: { top: 200, bottom: 230, height: 30 },
        },
        scroller,
      ),
    ).toBeNull();
  });

  it("pulls the project header to the top when the project has scrolled above the viewport", () => {
    // 项目头 -72..-42 在上方 142px 处越界；对齐项目头后会话行仍在可视区内。
    expect(
      sidebarProjectFocusDelta(
        {
          header: { top: -72, bottom: -42, height: 30 },
          row: { top: 130, bottom: 160, height: 30 },
        },
        scroller,
      ),
    ).toBe(-178);
  });

  it("centers the conversation row when the project is too long to keep it visible", () => {
    // 项目头对齐后会话行仍会落到可视区下方，此时退回把会话行居中。
    expect(
      sidebarProjectFocusDelta(
        {
          header: { top: -400, bottom: -370, height: 30 },
          row: { top: 900, bottom: 930, height: 30 },
        },
        scroller,
      ),
    ).toBe(565);
  });

  it("treats a missing project header as already focused", () => {
    expect(
      sidebarProjectFocusDelta(
        { header: null, row: { top: 200, bottom: 230, height: 30 } },
        scroller,
      ),
    ).toBeNull();
    expect(
      sidebarProjectFocusDelta(
        { header: null, row: { top: 900, bottom: 930, height: 30 } },
        scroller,
      ),
    ).toBe(565);
  });
});

describe("Renderer sidebar thread alignment", () => {
  it("scrolls the viewed conversation into view and does not repeat for the same thread", async () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const { ownerDocument, scroller } = fixture({
      threadId: "thread-a",
      rowRect: { top: 900, bottom: 930, height: 30 },
      projectHeaderRect: { top: 500, bottom: 530, height: 30 },
    });
    vi.stubGlobal("document", ownerDocument);
    const active = { hostId: "local", threadId: "thread-a" };
    const control = installRendererSidebarThreadAlign({ getActiveThread: () => active });

    await settle();
    expect(scroller.scrollTop).toBe(565);

    // 用户手动滚回顶部后，同一会话不应被强行拉回。
    scroller.scrollTop = 0;
    control.refresh();
    await settle();
    expect(scroller.scrollTop).toBe(0);

    control.dispose();
  });

  it("re-aligns after the viewed conversation changes", async () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const { ownerDocument, scroller } = fixture({
      threadId: "thread-a",
      rowRect: { top: 900, bottom: 930, height: 30 },
      projectHeaderRect: { top: 500, bottom: 530, height: 30 },
    });
    vi.stubGlobal("document", ownerDocument);
    let active = { hostId: "local", threadId: "thread-a" };
    const control = installRendererSidebarThreadAlign({ getActiveThread: () => active });
    await settle();
    expect(scroller.scrollTop).toBe(565);

    const second = sidebarRow(ownerDocument, "thread-b", "local");
    second.rect = { top: -300, bottom: -270, height: 30 };
    scroller.append(second);
    scroller.scrollTop = 0;
    active = { hostId: "local", threadId: "thread-b" };
    control.refresh();
    await settle();

    expect(scroller.scrollTop).toBe(-635);
    control.dispose();
  });

  it("keeps the scroll position while the target row is not rendered", async () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const { ownerDocument, scroller } = fixture({
      threadId: "thread-a",
      rowRect: { top: 900, bottom: 930, height: 30 },
      scrollTop: 120,
      projectHeaderRect: { top: 500, bottom: 530, height: 30 },
    });
    vi.stubGlobal("document", ownerDocument);
    const control = installRendererSidebarThreadAlign({
      getActiveThread: () => ({ hostId: "local", threadId: "hidden-thread" }),
    });

    await settle();
    expect(scroller.scrollTop).toBe(120);

    // 目标行稍后出现（例如项目展开或分页加载完成）时再对齐。
    const late = sidebarRow(ownerDocument, "hidden-thread", "local");
    late.rect = { top: 900, bottom: 930, height: 30 };
    scroller.append(late);
    control.refresh();
    await settle();

    expect(scroller.scrollTop).toBe(685);
    control.dispose();
  });

  it("does not scroll while the window is hidden", async () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const { ownerDocument, scroller } = fixture({
      threadId: "thread-a",
      rowRect: { top: 900, bottom: 930, height: 30 },
      projectHeaderRect: { top: 500, bottom: 530, height: 30 },
    });
    ownerDocument.hidden = true;
    vi.stubGlobal("document", ownerDocument);
    const control = installRendererSidebarThreadAlign({
      getActiveThread: () => ({ hostId: "local", threadId: "thread-a" }),
    });

    await settle();
    expect(scroller.scrollTop).toBe(0);
    control.dispose();
  });

  it("brings the conversation's project header into view when the project scrolled away", async () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    // 项目头在上方越界，会话行仍在可视区内：应把项目头拉回可视区顶部。
    const { ownerDocument, scroller } = fixture({
      threadId: "thread-a",
      rowRect: { top: 130, bottom: 160, height: 30 },
      projectHeaderRect: { top: -72, bottom: -42, height: 30 },
    });
    vi.stubGlobal("document", ownerDocument);
    const control = installRendererSidebarThreadAlign({
      getActiveThread: () => ({ hostId: "local", threadId: "thread-a" }),
    });

    await settle();
    expect(scroller.scrollTop).toBe(-178);
    control.dispose();
  });
});
