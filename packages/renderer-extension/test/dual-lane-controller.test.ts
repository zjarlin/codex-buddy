import { afterEach, describe, expect, it, vi } from "vitest";
import { installDualLane } from "../src/dual-lane/controller.js";
import { DUAL_LANE_CHANGE_EVENT, DUAL_LANE_STORAGE_KEY } from "../src/dual-lane/preference.js";

const FIBER_PREFIX = "__reactFiber$";

interface FakeComposer {
  element: Element;
  menu?: { selected: string; onSelectModel: ReturnType<typeof vi.fn> };
  openSide?: ReturnType<typeof vi.fn>;
  /** 原生读取的 React props；测试直接改写它模拟原生换会话。 */
  props: Record<string, unknown>[];
}

function fiberChain(propsList: Record<string, unknown>[]) {
  const nodes = propsList.map((props) => ({ memoizedProps: props, return: null as unknown }));
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const node = nodes[index];
    if (node) node.return = nodes[index + 1];
  }
  return nodes[0];
}

/** Composer stub: React fiber pointer, right-panel ancestry, and a native Model menu button. */
function fakeComposer(input: {
  lane: "main" | "side";
  selected?: string;
  onSelectModel?: ReturnType<typeof vi.fn>;
  props?: Record<string, unknown>[];
}): FakeComposer {
  const onSelectModel = input.onSelectModel ?? vi.fn();
  const menuProps = {
    model: input.selected ?? "ds",
    reasoningEffort: "high",
    modelOptions: [
      { model: { model: "free", displayName: "free", defaultReasoningEffort: "none" } },
      { model: { model: "ds", displayName: "ds", defaultReasoningEffort: "medium" } },
    ],
    onSelectModel,
  };
  const props = input.props ?? [{ conversationId: "conv-1", hostId: "local" }];
  const chain = fiberChain([{}, ...props]);
  const button: Record<string, unknown> = {};
  Object.defineProperty(button, `${FIBER_PREFIX}x`, { value: fiberChain([menuProps]) });
  const element = {
    getBoundingClientRect: () => ({ width: 700, height: 90 }),
    querySelectorAll: (selector: string) =>
      selector === 'button[aria-haspopup="menu"]' ? [button] : [],
    closest: (selector: string) =>
      input.lane === "side" && selector.includes("right-panel") ? { marker: true } : null,
  } as unknown as Element;
  Object.defineProperty(element, `${FIBER_PREFIX}x`, { value: chain });
  return { element, props, menu: { selected: input.selected ?? "ds", onSelectModel } };
}

/** 让原生入口返回的 Promise 与其 then/catch 链走完。 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

function setup(input: {
  composers: FakeComposer[];
  storage?: Record<string, string>;
  sideOpen?: boolean;
}) {
  let paneOpen = input.sideOpen === true;
  const closeClicks: number[] = [];
  const store = new Map(Object.entries(input.storage ?? {}));
  const events = new EventTarget();
  const window_ = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  } as unknown as Window;
  const listeners: (() => void)[] = [];
  // 关闭按钮只记录点击：控制器不应自己改原生状态。
  const sideTabs = [
    {
      getBoundingClientRect: () =>
        paneOpen ? { width: 600, height: 900 } : { width: 0, height: 0 },
      querySelector: (selector: string) =>
        selector === "[data-app-shell-tab-close-button]"
          ? { click: () => closeClicks.push(1) }
          : null,
    },
  ];
  const document_ = {
    querySelectorAll: (selector: string) => {
      if (selector === "[data-codex-composer-root]") return input.composers.map((c) => c.element);
      if (selector.startsWith('[data-tab-id^="sidechat:"]')) return sideTabs;
      return [];
    },
    defaultView: window_,
  } as unknown as Document;
  const controller = installDualLane({
    ownerDocument: document_,
    ownerWindow: window_,
    observe: (notify) => {
      listeners.push(notify);
      return () => undefined;
    },
  });
  return {
    controller,
    store,
    events,
    closeClicks,
    setPaneOpen: (value: boolean) => {
      paneOpen = value;
    },
    notify: () => listeners.forEach((fn) => fn()),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("dual lane controller", () => {
  it("writes the left pane default into a new conversation draft only", () => {
    const draft = fakeComposer({
      lane: "main",
      selected: "translate",
      props: [{ browserConversationId: "client-new-thread:abc" }],
    });
    const { controller } = setup({ composers: [draft] });
    // free 只支持 none，所以强度退到它自己的默认值而不是沿用 ds 的 high。
    expect(draft.menu?.onSelectModel).toHaveBeenCalledExactlyOnceWith("free", "none");
    expect(controller.status()).toMatchObject({ draft: true, mainApplied: true });
    controller.dispose();
  });

  it("leaves an existing conversation on its own Model", () => {
    const existing = fakeComposer({ lane: "main", selected: "ds" });
    const { controller } = setup({ composers: [existing] });
    expect(existing.menu?.onSelectModel).not.toHaveBeenCalled();
    expect(controller.status()).toMatchObject({ draft: false, mainApplied: false });
    controller.dispose();
  });

  it("opens the native right pane as soon as the conversation has started", () => {
    const openSide = vi.fn().mockResolvedValue("side-id");
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [{ conversationId: "conv-9", hostId: "local", onCreateSideConversation: openSide }],
    });
    const { controller } = setup({ composers: [main] });
    expect(openSide).toHaveBeenCalledExactlyOnceWith({
      sourceConversationId: "conv-9",
      hostId: "local",
      collaborationMode: { mode: "default", settings: { model: "ds" } },
    });
    expect(controller.status()).toMatchObject({ sideAvailable: true, sideOpen: false });
    controller.dispose();
  });

  it("keeps a started conversation on its own Model even though the draft id is still published", () => {
    // 原生在已有会话的 Composer 上同样保留 browserConversationId；只看草稿
    // ID 会把正常会话误判成新会话，追着改用户的模型。
    const main = fakeComposer({
      lane: "main",
      selected: "ds",
      props: [
        {
          browserConversationId: "client-new-thread:stale",
          conversationId: "conv-9",
          hostId: "local",
        },
      ],
    });
    const { controller } = setup({ composers: [main] });
    expect(main.menu?.onSelectModel).not.toHaveBeenCalled();
    expect(controller.status()).toMatchObject({ draft: false, mainApplied: false });
    controller.dispose();
  });

  it("does not try to open a pane before the conversation has started", () => {
    const openSide = vi.fn().mockResolvedValue("side-id");
    const draft = fakeComposer({
      lane: "main",
      selected: "free",
      props: [
        {
          browserConversationId: "client-new-thread:draft-9",
          hostId: "local",
          onCreateSideConversation: openSide,
        },
      ],
    });
    const { controller } = setup({ composers: [draft] });
    expect(openSide).not.toHaveBeenCalled();
    expect(controller.status()).toMatchObject({ draft: true, sideAvailable: false });
    controller.dispose();
  });

  it("does not reopen a pane the user closed for that conversation", () => {
    const openSide = vi.fn().mockResolvedValue("side-id");
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [{ conversationId: "conv-9", hostId: "local", onCreateSideConversation: openSide }],
    });
    const { controller, notify } = setup({ composers: [main] });
    notify();
    notify();
    expect(openSide).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("opens at most once per conversation even when notified repeatedly", () => {
    const openSide = vi.fn().mockResolvedValue("side-id");
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [{ conversationId: "conv-9", hostId: "local", onCreateSideConversation: openSide }],
    });
    const { controller, notify } = setup({ composers: [main] });
    notify();
    notify();
    expect(openSide).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("caps retries when the native hands back a new conversation id without materializing a pane", async () => {
    // 原生建侧边聊天有可能改掉主会话身份；按会话去重会失效。没有右栏出现
    // 时不能无限重试，否则页面会被反复重建拖死。
    const openSide = vi.fn().mockResolvedValue("side-id");
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [{ conversationId: "conv-9", hostId: "local", onCreateSideConversation: openSide }],
    });
    const { controller, notify } = setup({ composers: [main] });
    const props = main.props[0];
    for (let index = 0; index < 10; index += 1) {
      if (props) props.conversationId = `conv-${index + 10}`;
      notify();
      await flush();
    }
    expect(openSide.mock.calls.length).toBeGreaterThan(1);
    expect(openSide.mock.calls.length).toBeLessThanOrEqual(3);
    controller.dispose();
  });

  it("refills the retry budget once the right pane is actually visible", async () => {
    const openSide = vi.fn().mockResolvedValue("side-id");
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [{ conversationId: "conv-9", hostId: "local", onCreateSideConversation: openSide }],
    });
    const { controller, notify, setPaneOpen } = setup({ composers: [main] });
    const props = main.props[0];
    for (let index = 0; index < 6; index += 1) {
      if (props) props.conversationId = `conv-a${index}`;
      notify();
      await flush();
    }
    const capped = openSide.mock.calls.length;
    expect(capped).toBe(3);
    // 右栏真的出现了，随后用户自己关掉；预算应回满，新会话仍能展开。
    setPaneOpen(true);
    notify();
    await flush();
    expect(openSide.mock.calls.length).toBe(capped);
    setPaneOpen(false);
    if (props) props.conversationId = "conv-b1";
    notify();
    await flush();
    expect(openSide.mock.calls.length).toBe(capped + 1);
    controller.dispose();
  });

  it("keeps working when the native entry throws synchronously", () => {
    const openSide = vi.fn(() => {
      throw new Error("native-boom");
    });
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [{ conversationId: "conv-9", hostId: "local", onCreateSideConversation: openSide }],
    });
    const { controller, notify } = setup({ composers: [main] });
    expect(openSide).toHaveBeenCalledOnce();
    expect(controller.status().error).toBe("native-boom");
    // 同步抛错不能把“正在打开”的闸门永久卡住。
    const props = main.props[0];
    if (props) props.conversationId = "conv-10";
    notify();
    expect(openSide).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("does nothing while split view is turned off", () => {
    const openSide = vi.fn();
    const draft = fakeComposer({
      lane: "main",
      selected: "translate",
      props: [
        { browserConversationId: "client-new-thread:abc", onCreateSideConversation: openSide },
      ],
    });
    const { controller } = setup({
      composers: [draft],
      storage: {
        [DUAL_LANE_STORAGE_KEY]: JSON.stringify({
          enabled: false,
          mainModel: "free",
          sideModel: "ds",
        }),
      },
    });
    expect(draft.menu?.onSelectModel).not.toHaveBeenCalled();
    expect(openSide).not.toHaveBeenCalled();
    expect(controller.status().enabled).toBe(false);
    controller.dispose();
  });

  it("waits for the native side chat entry instead of failing when it is not published yet", () => {
    const main = fakeComposer({ lane: "main", selected: "free" });
    const { controller } = setup({ composers: [main] });
    expect(controller.status()).toMatchObject({
      sideAvailable: false,
      sideOpen: false,
      error: null,
    });
    controller.dispose();
  });

  it("collapses only a pane this feature opened when split view is turned off", () => {
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [{ conversationId: "conv-3", hostId: "local", onCreateSideConversation: vi.fn() }],
    });
    const { controller, store, events, closeClicks, setPaneOpen } = setup({ composers: [main] });
    setPaneOpen(true);
    expect(closeClicks).toHaveLength(0);
    store.set(
      DUAL_LANE_STORAGE_KEY,
      JSON.stringify({ enabled: false, mainModel: "free", sideModel: "ds" }),
    );
    events.dispatchEvent(new Event(DUAL_LANE_CHANGE_EVENT));
    expect(closeClicks).toHaveLength(1);
    controller.dispose();
  });

  it("never closes the native side chat just because the controller is disposed", () => {
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [{ conversationId: "conv-4", hostId: "local", onCreateSideConversation: vi.fn() }],
    });
    const { controller, closeClicks } = setup({ composers: [main], sideOpen: true });
    controller.dispose();
    expect(closeClicks).toHaveLength(0);
  });

  it("still opens the pane when the side Model is left empty", () => {
    const openSide = vi.fn().mockResolvedValue("side-id");
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [{ conversationId: "conv-5", hostId: "local", onCreateSideConversation: openSide }],
    });
    const { controller } = setup({
      composers: [main],
      storage: {
        [DUAL_LANE_STORAGE_KEY]: JSON.stringify({
          enabled: true,
          mainModel: "auto",
          sideModel: "",
        }),
      },
    });
    expect(openSide).toHaveBeenCalledExactlyOnceWith({
      sourceConversationId: "conv-5",
      hostId: "local",
      collaborationMode: { mode: "default", settings: { model: "auto" } },
    });
    controller.dispose();
  });

  it("reacts to the preference change event", () => {
    const openSide = vi.fn().mockResolvedValue("side-id");
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [{ conversationId: "conv-7", hostId: "local", onCreateSideConversation: openSide }],
    });
    const { controller, store, events } = setup({
      composers: [main],
      storage: {
        [DUAL_LANE_STORAGE_KEY]: JSON.stringify({
          enabled: false,
          mainModel: "free",
          sideModel: "ds",
        }),
      },
    });
    expect(openSide).not.toHaveBeenCalled();
    store.set(
      DUAL_LANE_STORAGE_KEY,
      JSON.stringify({ enabled: true, mainModel: "free", sideModel: "ds" }),
    );
    events.dispatchEvent(new Event(DUAL_LANE_CHANGE_EVENT));
    expect(openSide).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
