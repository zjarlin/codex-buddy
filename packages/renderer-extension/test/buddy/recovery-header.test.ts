import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterruptedQueue, InterruptedQueueEntry } from "../../src/buddy/interrupted-queue.js";
import type { RendererModelClient } from "../../src/renderer-model-client.js";

const headerPoint = vi.hoisted(() => vi.fn());
vi.mock("../../src/settings/trigger.js", () => ({
  findRendererSettingsHeaderInsertionPoint: headerPoint,
  PROVIDERS_TRIGGER_ATTRIBUTE: "data-codexhost-providers-trigger",
  RECOVERY_TRIGGER_ATTRIBUTE: "data-codexhost-recovery-trigger",
}));
vi.mock("lucide/dist/esm/createElement.mjs", () => ({
  default: () => document.createElement("svg"),
}));

import { createInterruptedPanel } from "../../src/buddy/interrupted-panel.js";
import { installBuddyControl } from "../../src/buddy/control.js";

// 仅模拟组件使用的 DOM 操作，验证真实按钮回调、批量状态和挂载生命周期。
class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parentElement: ElementStub | null = null;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style = { setProperty: vi.fn() };
  className = "";
  textContent = "";
  title = "";
  disabled = false;
  value = "";
  insertions = 0;
  constructor(readonly tagName: string) {
    super();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  get nextSibling(): ElementStub | null {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get nextElementSibling() {
    return this.nextSibling;
  }
  append(...children: (ElementStub | string)[]) {
    for (const child of children) {
      if (typeof child !== "string") this.insertBefore(child, null);
    }
  }
  insertBefore(child: ElementStub, before: ElementStub | null) {
    child.remove();
    child.parentElement = this;
    const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    this.insertions += 1;
  }
  replaceChildren(...children: ElementStub[]) {
    for (const child of [...this.children]) child.remove();
    this.append(...children);
  }
  remove() {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  querySelector(selector: string): ElementStub | null {
    const attribute = selector.slice(1, -1);
    for (const child of this.children) {
      if (child.attributes.has(attribute)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  click() {
    if (!this.disabled) this.dispatchEvent(new Event("click", { cancelable: true }));
  }
  focus() {
    // 折叠按钮在重画后重新获得焦点；桩只需要可调用。
  }
}

const panels: { dispose(): void }[] = [];
let parent: ElementStub;
let provider: ElementStub;
const candidate = (threadId: string, hostId = "local"): InterruptedQueueEntry => ({
  hostId,
  threadId,
  turnId: `${threadId}-turn`,
  title: threadId,
  status: "failed",
});
const asClient = (client: object) => client as RendererModelClient;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}
function queueFixture(...ids: string[]) {
  let entries = ids.map((id) => candidate(id));
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  const remove = (entry: InterruptedQueueEntry) => {
    entries = entries.filter(
      (item) => item.threadId !== entry.threadId || item.hostId !== entry.hostId,
    );
    publish();
  };
  const value = {
    list: (hostId: string) => entries.filter((entry) => entry.hostId === hostId),
    problem: () => "",
    isPending: () => false,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resume: vi.fn(async (entry: InterruptedQueueEntry) => remove(entry)),
    archive: vi.fn(async (entry: InterruptedQueueEntry) => remove(entry)),
    importHistory: vi.fn(async () => 0),
  };
  return {
    value,
    queue: value as unknown as InterruptedQueue,
    remove,
    enqueue: (id: string, hostId = "local") => {
      entries.push(candidate(id, hostId));
      publish();
    },
    listeners,
  };
}
const client = () => asClient({ buddyInterrupted: vi.fn(), buddyContinue: vi.fn() });
function mount(fixture: ReturnType<typeof queueFixture>, onResumed?: () => void) {
  const panel = createInterruptedPanel(() => "zh-CN", fixture.queue, onResumed);
  panels.push(panel);
  panel.update(client(), null, "", "local");
  panel.repositionHeader();
  return panel;
}
// 中断队列默认收起，只有点开标题行才渲染模型行与记录。
function expand(panel: ReturnType<typeof createInterruptedPanel>): void {
  descendants(panel.root as unknown as ElementStub)
    .find((node) => "buddyInterruptedToggle" in node.dataset)
    ?.click();
}
function descendants(root: ElementStub): ElementStub[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}
function header() {
  const root = parent.querySelector("[data-codexhost-recovery-trigger]");
  const button = root?.children[0];
  const status = root?.children[1];
  if (!root || !button || !status) throw new Error("Missing recovery header");
  return { root, button, status };
}

beforeEach(() => {
  vi.stubGlobal("document", { createElement: (tag: string) => new ElementStub(tag) });
  vi.stubGlobal("window", new EventTarget());
  parent = new ElementStub("header");
  provider = new ElementStub("button");
  provider.setAttribute("data-codexhost-providers-trigger", "");
  parent.append(provider);
  headerPoint.mockReturnValue({ parent, before: null });
});
afterEach(() => {
  for (const panel of panels.splice(0)) panel.dispose();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("header interrupted recovery queue", () => {
  it("mounts next to providers without history requests or DOM churn and reattaches", async () => {
    const f = queueFixture("one");
    const panel = mount(f);
    const { root, button } = header();
    expect(provider.nextSibling).toBe(root);
    expect(button.textContent).toBe("一键恢复中断会话 (1)");
    const insertions = parent.insertions;
    panel.repositionHeader();
    panel.repositionHeader();
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(parent.insertions).toBe(insertions);
    expect(f.value.importHistory).not.toHaveBeenCalled();
    parent = new ElementStub("header");
    parent.append(provider);
    headerPoint.mockReturnValue({ parent, before: null });
    panel.repositionHeader();
    expect(provider.nextSibling).toBe(root);
    panel.dispose();
    expect(root.parentElement).toBeNull();
    expect(f.listeners.size).toBe(0);
  });

  it("updates immediately on queue events and resumes without a history scan", async () => {
    const f = queueFixture();
    mount(f);
    expect(header().button.disabled).toBe(true);
    f.enqueue("new");
    expect(header().button.textContent).toBe("一键恢复中断会话 (1)");
    header().button.click();
    await settle();
    expect(f.value.resume).toHaveBeenCalledWith(candidate("new"), undefined);
    expect(f.value.importHistory).not.toHaveBeenCalled();
    expect(header().status.textContent).toContain("已提交恢复 1，失败 0");
  });

  it("submits a fixed queue snapshot serially, blocks repeat clicks and reports partial failure", async () => {
    const f = queueFixture("one", "two", "three");
    const first = deferred<undefined>();
    f.value.resume
      .mockImplementationOnce(async (entry) => {
        await first.promise;
        f.remove(entry);
      })
      .mockRejectedValueOnce(new Error("rate limited"));
    const onResumed = vi.fn();
    mount(f, onResumed);
    header().button.click();
    header().button.click();
    await settle();
    expect(f.value.resume).toHaveBeenCalledTimes(1);
    expect(header().button.textContent).toBe("正在恢复 0/3");
    f.enqueue("late");
    first.resolve(undefined);
    await settle();
    expect(f.value.resume.mock.calls.map(([entry]) => entry.threadId)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(header().status.textContent).toContain("已提交恢复 2，失败 1");
    expect(header().status.textContent).toContain("rate limited");
    expect(header().button.textContent).toBe("一键恢复中断会话 (2)");
    expect(onResumed).toHaveBeenCalledTimes(1);
  });

  it("stops remaining submissions on Host change", async () => {
    const f = queueFixture("one", "two");
    const first = deferred<undefined>();
    f.value.resume.mockImplementationOnce(async (entry) => {
      await first.promise;
      f.remove(entry);
    });
    const panel = mount(f);
    header().button.click();
    await settle();
    f.enqueue("remote-one", "remote");
    panel.update(client(), null, "", "remote");
    first.resolve(undefined);
    await settle();
    expect(f.value.resume).toHaveBeenCalledTimes(1);
    expect(header().button.textContent).toBe("一键恢复中断会话 (1)");
  });

  it("archives a queue row and preserves a failed archive for retry", async () => {
    const f = queueFixture("one");
    const panel = mount(f);
    expand(panel);
    const archive = () => {
      const button = descendants(panel.root as unknown as ElementStub).find(
        (node) => "buddyArchive" in node.dataset,
      );
      if (!button) throw new Error("Missing archive action");
      return button;
    };
    f.value.archive.mockRejectedValueOnce(new Error("offline"));
    archive().click();
    await settle();
    expect(f.value.list("local")).toHaveLength(1);
    expect(header().status.textContent).toContain("offline");
    archive().click();
    await settle();
    expect(f.value.archive).toHaveBeenCalledTimes(2);
    expect(f.value.list("local")).toEqual([]);
    expect(header().button.disabled).toBe(true);
    expect(f.value.resume).not.toHaveBeenCalled();
  });

  it.each(["resume", "archive"] as const)(
    "keeps %s working after replacing the client for the same Host",
    async (action) => {
      const f = queueFixture("one");
      const panel = mount(f);
      panel.update(client(), null, "", "local");
      expand(panel);
      const button = descendants(panel.root as unknown as ElementStub).find((node) =>
        action === "archive"
          ? "buddyArchive" in node.dataset
          : node.tagName === "button" && node.textContent === "恢复",
      );
      expect(button).toBeDefined();
      expect(button?.disabled).toBe(false);
      button?.click();
      await settle();
      expect(f.value[action]).toHaveBeenCalledTimes(1);
      expect(f.value[action].mock.calls[0]?.[0]).toEqual(candidate("one"));
      expect(f.value[action === "resume" ? "archive" : "resume"]).not.toHaveBeenCalled();
      expect(f.value.list("local")).toEqual([]);
    },
  );

  it("only imports historical interruptions when explicitly requested and exposes failures", async () => {
    const f = queueFixture("one");
    const panel = mount(f);
    expect(f.value.importHistory).not.toHaveBeenCalled();
    f.value.importHistory.mockRejectedValueOnce(new Error("history offline"));
    await panel.refresh();
    expect(f.value.importHistory).toHaveBeenCalledWith("local");
    expect(header().status.textContent).toContain("history offline");
    expect(f.value.resume).not.toHaveBeenCalled();
  });

  it("keeps archive usable when recovery or history discovery is unavailable", async () => {
    const f = queueFixture("one");
    const panel = mount(f);
    f.value.importHistory.mockRejectedValueOnce(new Error("history unavailable"));
    await panel.refresh();
    panel.update(asClient({ requestThreadProjection: vi.fn() }), null, "", "local");
    expand(panel);
    const archive = descendants(panel.root as unknown as ElementStub).find(
      (node) => "buddyArchive" in node.dataset,
    );
    expect(archive?.disabled).toBe(false);
    archive?.click();
    await settle();
    expect(f.value.archive).toHaveBeenCalledTimes(1);
    expect(f.value.resume).not.toHaveBeenCalled();
    expect(f.value.list("local")).toEqual([]);
  });

  it("keeps the queue available without a Composer", async () => {
    const f = queueFixture();
    const currentClient = client();
    const control = installBuddyControl(
      () => null,
      () => "zh-CN",
      {
        queue: f.queue,
        getRecoveryContext: () => ({ hostId: "local", client: currentClient }),
      },
    );
    panels.push(control);
    await settle();
    expect(f.value.importHistory).not.toHaveBeenCalled();
    f.enqueue("one");
    header().button.click();
    await settle();
    expect(f.value.resume).toHaveBeenCalledTimes(1);
  });

  it("opens a queue entry without resuming, archiving or clearing it", async () => {
    const f = queueFixture("one");
    const openThread = vi.fn(async () => {});
    const panel = createInterruptedPanel(() => "zh-CN", f.queue, undefined, openThread);
    panels.push(panel);
    panel.update(client(), null, "", "local");
    expand(panel);
    const view = descendants(panel.root as unknown as ElementStub).find(
      (node) => "buddyOpen" in node.dataset,
    );
    expect(view?.textContent).toBe("查看会话");
    view?.click();
    await settle();
    expect(openThread).toHaveBeenCalledWith("one", { hostId: "local" });
    expect(f.value.resume).not.toHaveBeenCalled();
    expect(f.value.archive).not.toHaveBeenCalled();
    expect(f.value.list("local")).toHaveLength(1);
  });

  it("reports an unreadable conversation and keeps it in the queue", async () => {
    const f = queueFixture("one");
    const openThread = vi.fn(async () => {
      throw new Error("sidebar row missing");
    });
    const panel = createInterruptedPanel(() => "zh-CN", f.queue, undefined, openThread);
    panels.push(panel);
    panel.update(client(), null, "", "local");
    expand(panel);
    descendants(panel.root as unknown as ElementStub)
      .find((node) => "buddyOpen" in node.dataset)
      ?.click();
    await settle();
    const text = descendants(panel.root as unknown as ElementStub)
      .map((node) => node.textContent)
      .join("|");
    expect(text).toContain("打开会话失败");
    expect(text).toContain("sidebar row missing");
    expect(f.value.list("local")).toHaveLength(1);
  });

  it("starts collapsed so the queue does not cover the transcript", () => {
    const f = queueFixture("one", "two");
    const panel = mount(f);
    const nodes = descendants(panel.root as unknown as ElementStub);
    expect(nodes.some((node) => node.className === "buddy-interrupted-list")).toBe(false);
    expect(nodes.some((node) => node.className === "buddy-interrupted-model-resume")).toBe(false);
    const toggle = nodes.find((node) => "buddyInterruptedToggle" in node.dataset);
    expect(toggle?.attributes.get("aria-expanded")).toBe("false");
    // 收起时仍能看到待处理数量。
    expect(nodes.some((node) => node.className === "buddy-interrupted-count")).toBe(true);
  });

  it("expands on demand and collapses again", () => {
    const f = queueFixture("one");
    const panel = mount(f);
    const list = () =>
      descendants(panel.root as unknown as ElementStub).some(
        (node) => node.className === "buddy-interrupted-list",
      );
    const toggle = () =>
      descendants(panel.root as unknown as ElementStub).find(
        (node) => "buddyInterruptedToggle" in node.dataset,
      );
    expect(list()).toBe(false);
    toggle()?.click();
    expect(list()).toBe(true);
    expect(toggle()?.attributes.get("aria-expanded")).toBe("true");
    toggle()?.click();
    expect(list()).toBe(false);
    expect(toggle()?.attributes.get("aria-expanded")).toBe("false");
  });

  it("auto-expands while resuming all and folds back afterwards", async () => {
    const f = queueFixture("one");
    const first = deferred<undefined>();
    f.value.resume.mockImplementationOnce(async (entry) => {
      await first.promise;
      f.remove(entry);
    });
    const panel = mount(f);
    const list = () =>
      descendants(panel.root as unknown as ElementStub).some(
        (node) => node.className === "buddy-interrupted-list",
      );
    expect(list()).toBe(false);
    header().button.click();
    await settle();
    expect(list()).toBe(true);
    first.resolve(undefined);
    await settle();
    expect(list()).toBe(false);
  });

  it("omits the open action when the connection cannot navigate", () => {
    const f = queueFixture("one");
    const panel = mount(f);
    expand(panel);
    expect(
      descendants(panel.root as unknown as ElementStub).some((node) => "buddyOpen" in node.dataset),
    ).toBe(false);
  });
});
