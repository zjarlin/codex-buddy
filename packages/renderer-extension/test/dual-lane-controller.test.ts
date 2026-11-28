import { afterEach, describe, expect, it, vi } from "vitest";
import { installDualLane } from "../src/dual-lane/controller.js";
import { DUAL_LANE_CHANGE_EVENT, DUAL_LANE_STORAGE_KEY } from "../src/dual-lane/preference.js";

const FIBER_PREFIX = "__reactFiber$";

interface FakeComposer {
  element: Element;
  menu?: { selected: string; onSelectModel: ReturnType<typeof vi.fn> };
  openSide?: ReturnType<typeof vi.fn>;
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
  const chain = fiberChain([
    {},
    ...(input.props ?? [{ conversationId: "conv-1", hostId: "local" }]),
  ]);
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
  return { element, menu: { selected: input.selected ?? "ds", onSelectModel } };
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

  it("opens the native right pane immediately, including for a new draft", () => {
    const openSide = vi.fn().mockResolvedValue("side-id");
    const main = fakeComposer({
      lane: "main",
      selected: "free",
      props: [
        {
          browserConversationId: "client-new-thread:draft-9",
          conversationId: "conv-9",
          hostId: "local",
          onCreateSideConversation: openSide,
        },
      ],
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
