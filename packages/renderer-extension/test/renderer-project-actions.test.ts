import { afterEach, describe, expect, it, vi } from "vitest";

import type { RendererModelClient } from "../src/renderer-model-client.js";
import {
  installRendererProjectActions,
  type RendererProjectActionsBridge,
} from "../src/renderer-project-actions.js";

const ERROR_ATTRIBUTE = "data-codexhost-project-actions-error";

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<() => void>>();
  parentElement: FakeElement | null = null;
  textContent = "";
  title = "";
  type = "";

  constructor(readonly tagName: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  appendChild(node: FakeElement): FakeElement {
    this.append(node);
    return node;
  }

  remove(): void {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index >= 0) {
      this.parentElement?.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  addEventListener(name: string, listener: () => void): void {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) {
      listener();
    }
  }
}

class FakeDocument {
  readonly head = new FakeElement("head");
  readonly body = new FakeElement("body");

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return this.createElement(tagName);
  }

  get alert(): FakeElement | undefined {
    return this.body.children.find((element) => element.attributes.has(ERROR_ATTRIBUTE));
  }
}

const controls: { dispose(): void }[] = [];

function fixture(
  getClient: () => Partial<RendererModelClient> | null = () => ({}),
  getLocale: () => "en" | "zh-CN" = () => "en",
) {
  const document = new FakeDocument();
  const window: { __codexhostProjectActionsV1?: RendererProjectActionsBridge } = {};
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  const control = installRendererProjectActions({
    getClient: () => getClient() as RendererModelClient | null,
    getLocale,
  });
  controls.push(control);
  const bridge = window.__codexhostProjectActionsV1;
  if (!bridge) {
    throw new Error("Project actions bridge is missing");
  }
  return { document, window, control, bridge };
}

afterEach(() => {
  for (const control of controls.splice(0)) {
    control.dispose();
  }
  vi.unstubAllGlobals();
});

describe("native project actions Renderer bridge", () => {
  it("publishes the current locale label for the native menu", () => {
    const getLocale = vi.fn<() => "en" | "zh-CN">(() => "en");
    const { bridge } = fixture(undefined, getLocale);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(bridge.label()).toBe("Open in Doubao");
    getLocale.mockReturnValue("zh-CN");
    expect(bridge.label()).toBe("在 Doubao 中打开");
  });

  it("starts Doubao through the current local client with no folder arguments", async () => {
    const previousOpen = vi.fn(async () => ({ application: "doubao" as const }));
    const currentOpen = vi.fn(async () => ({ application: "doubao" as const }));
    const getClient = vi.fn(() => ({ openDoubao: previousOpen }));
    const { bridge, document } = fixture(getClient);
    getClient.mockReturnValue({ openDoubao: currentOpen });

    await bridge.openDoubao();
    expect(previousOpen).not.toHaveBeenCalled();
    expect(currentOpen).toHaveBeenCalledExactlyOnceWith();
    expect(document.alert).toBeUndefined();
  });

  it("prevents repeated launches while a native launch is pending", async () => {
    let finish!: (value: { application: "doubao" }) => void;
    const openDoubao = vi.fn(
      () => new Promise<{ application: "doubao" }>((resolve) => (finish = resolve)),
    );
    const { bridge } = fixture(() => ({ openDoubao }));
    const pending = bridge.openDoubao();
    await bridge.openDoubao();
    expect(openDoubao).toHaveBeenCalledOnce();
    finish({ application: "doubao" });
    await pending;

    const second = bridge.openDoubao();
    expect(openDoubao).toHaveBeenCalledTimes(2);
    finish({ application: "doubao" });
    await second;
  });

  it("shows the actual launch failure in a dismissible alert", async () => {
    const openDoubao = vi.fn(async () => {
      throw new Error("Doubao application is not installed");
    });
    const { document, bridge } = fixture(() => ({ openDoubao }));
    await bridge.openDoubao();

    expect(document.alert?.attributes.get("role")).toBe("alert");
    expect(document.alert?.children[0].textContent).toBe(
      "Open in Doubao: Doubao application is not installed",
    );
    expect(document.alert?.children[1].attributes.get("aria-label")).toBe("Dismiss");
    document.alert?.children[1].click();
    expect(document.alert).toBeUndefined();
  });

  it.each([null, {}])("surfaces an unavailable launch connection: %j", async (client) => {
    const { document, bridge } = fixture(
      () => client,
      () => "zh-CN",
    );
    await bridge.openDoubao();
    expect(document.alert?.children[0].textContent).toBe("在 Doubao 中打开: Doubao 启动连接不可用");
    expect(document.alert?.children[1].attributes.get("aria-label")).toBe("关闭");
  });

  it("clears the previous error when a retry succeeds", async () => {
    const openDoubao = vi
      .fn<NonNullable<RendererModelClient["openDoubao"]>>()
      .mockRejectedValueOnce(new Error("Temporary launch failure"))
      .mockResolvedValue({ application: "doubao" });
    const { document, bridge } = fixture(() => ({ openDoubao }));
    await bridge.openDoubao();
    expect(document.alert).toBeDefined();
    await bridge.openDoubao();
    expect(document.alert).toBeUndefined();
    expect(openDoubao).toHaveBeenCalledTimes(2);
  });

  it("removes the bridge, styles and alert on disposal and rejects stale actions", async () => {
    const openDoubao = vi.fn(async () => {
      throw new Error("Launch failed");
    });
    const { document, window, control, bridge } = fixture(() => ({ openDoubao }));
    await bridge.openDoubao();
    expect(document.alert).toBeDefined();
    control.dispose();
    control.dispose();

    expect(window.__codexhostProjectActionsV1).toBeUndefined();
    expect(document.head.children).toHaveLength(0);
    expect(document.alert).toBeUndefined();
    await bridge.openDoubao();
    expect(openDoubao).toHaveBeenCalledOnce();
  });

  it("does not publish a late failure after the Renderer bridge is disposed", async () => {
    let fail!: (error: Error) => void;
    const openDoubao = vi.fn(
      () => new Promise<{ application: "doubao" }>((_resolve, reject) => (fail = reject)),
    );
    const { document, control, bridge } = fixture(() => ({ openDoubao }));
    const pending = bridge.openDoubao();
    control.dispose();
    fail(new Error("Late failure"));
    await pending;
    expect(document.alert).toBeUndefined();
  });

  it("keeps a replacement bridge when disposing an older installation", () => {
    const { window, control, bridge } = fixture();
    const replacement = installRendererProjectActions({
      getClient: () => null,
      getLocale: () => "en",
    });
    controls.push(replacement);
    const current = window.__codexhostProjectActionsV1;
    expect(current).not.toBe(bridge);
    control.dispose();
    expect(window.__codexhostProjectActionsV1).toBe(current);
    replacement.dispose();
    expect(window.__codexhostProjectActionsV1).toBeUndefined();
  });
});
