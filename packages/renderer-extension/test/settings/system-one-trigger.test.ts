import type { RendererModelClient } from "../../src/renderer-model-client.js";
import { describe, expect, it, vi } from "vitest";
import { installSystemOneModelHeaderControl } from "../../src/settings/trigger.js";
class FakeHeaderElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeHeaderElement[] = [];
  readonly listeners = new Map<string, (event: { stopPropagation(): void }) => void>();
  readonly classList = { add: vi.fn() };
  readonly style: Record<string, string | ((name: string, value: string) => void)> = {};
  disabled = false;
  isConnected = true;
  parentElement: FakeHeaderElement | null = null;
  title = "";
  type = "";
  value = "";

  constructor(
    readonly left = 0,
    readonly width = 80,
  ) {
    this.style.setProperty = (name: string, value: string) => {
      this.style[name] = value;
    };
  }

  get firstChild(): FakeHeaderElement | null {
    return this.children[0] ?? null;
  }
  get nextSibling(): FakeHeaderElement | null {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] ?? null;
  }
  addEventListener(name: string, listener: (event: { stopPropagation(): void }) => void): void {
    this.listeners.set(name, listener);
  }
  append(...children: FakeHeaderElement[]): void {
    for (const child of children) this.insertBefore(child, null);
  }
  appendChild(child: FakeHeaderElement): FakeHeaderElement {
    return this.insertBefore(child, null);
  }
  contains(node: FakeHeaderElement | null): boolean {
    if (!node) return false;
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }
  getBoundingClientRect(): DOMRect {
    return {
      left: this.left,
      right: this.left + this.width,
      top: 0,
      bottom: 46,
      width: this.width,
      height: 46,
    } as DOMRect;
  }
  insertBefore(child: FakeHeaderElement, before: FakeHeaderElement | null): FakeHeaderElement {
    child.remove();
    child.parentElement = this;
    child.isConnected = true;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }
  matches(selector: string): boolean {
    const attribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (!attribute) return false;
    const [, name, value] = attribute;
    return name !== undefined && this.attributes.get(name) === value;
  }
  querySelector(selector: string): FakeHeaderElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): FakeHeaderElement[] {
    const scoped = selector.startsWith(":scope > ");
    const target = scoped ? selector.slice(":scope > ".length) : selector;
    if (scoped) return this.children.filter((child) => child.matches(target));
    return this.children.flatMap((child) => [
      ...(child.matches(target) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  remove(): void {
    if (this.parentElement) {
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
    this.isConnected = false;
  }
  removeEventListener(name: string): void {
    this.listeners.delete(name);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  toggleAttribute(name: string, force: boolean): void {
    if (force) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }
}

interface FakeHeader {
  header: FakeHeaderElement;
  startSlot: FakeHeaderElement;
  surface: FakeHeaderElement;
  pageHeader: FakeHeaderElement;
  actionGroup: FakeHeaderElement | null;
  endSlot: FakeHeaderElement;
}

// Mirrors Codex Desktop 0.153.4: both shell slots carry the obstacle attribute, and the native
// action group is the trailing obstacle child of the header context menu surface.
function createFakeHeader(options: { nativeActions: boolean }): FakeHeader {
  const header = new FakeHeaderElement(0, 1510);
  const startSlot = new FakeHeaderElement(0, 216);
  startSlot.setAttribute("data-test-id", "header-shell-slot");
  startSlot.setAttribute("data-app-shell-header-obstacle", "true");
  const surface = new FakeHeaderElement(216, 1119);
  surface.setAttribute("data-testid", "app-shell-header-context-menu-surface");
  const pageHeader = new FakeHeaderElement(223, 1071);
  pageHeader.setAttribute("data-app-shell-page-header", "true");
  surface.append(pageHeader);
  let actionGroup: FakeHeaderElement | null = null;
  if (options.nativeActions) {
    actionGroup = new FakeHeaderElement(1299, 31);
    actionGroup.setAttribute("data-app-shell-header-obstacle", "true");
    surface.append(actionGroup);
  }
  const endSlot = new FakeHeaderElement(1447, 63);
  endSlot.setAttribute("data-test-id", "header-shell-slot");
  endSlot.setAttribute("data-app-shell-header-obstacle", "true");
  header.append(startSlot, surface, endSlot);
  return { header, startSlot, surface, pageHeader, actionGroup, endSlot };
}

function stubHeaderDocument(current: () => FakeHeaderElement): Document {
  const document = {
    createElement: () => new FakeHeaderElement(),
    createElementNS: () => new FakeHeaderElement(),
    querySelector: (selector: string) =>
      selector === 'header[data-pip-obstacle="app-shell-header"]' ? current() : null,
    querySelectorAll: () => [],
  } as unknown as Document;
  vi.stubGlobal("document", document);
  return document;
}

describe("System One model header control", () => {
  it("mounts beside the native actions and saves the selected System One model", async () => {
    const shell = createFakeHeader({ nativeActions: true });
    const document = stubHeaderDocument(() => shell.header);
    const buddyConfigure = vi.fn(async (settings) => ({
      settings,
      models: [],
      decisions: [],
      jevKeyConfigured: false,
      jevBaseUrl: null,
    }));
    const client = {
      buddyStatus: vi.fn(async () => ({
        settings: {
          enabled: true,
          privateMode: false,
          role: "auto",
          bypass: true,
          jev: true,
          systemOneModel: "typesafe/jev",
          executorModel: null,
        },
        models: [],
        decisions: [],
        jevKeyConfigured: false,
        jevBaseUrl: null,
      })),
      buddyConfigure,
    } as unknown as RendererModelClient;

    try {
      const control = installSystemOneModelHeaderControl({
        getClient: () => client,
        getLocale: () => "zh-CN",
        ownerDocument: document,
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(control.root).not.toBeNull();
      expect(shell.surface.children).toEqual([shell.pageHeader, control.root, shell.actionGroup]);
      const select = control.root?.children[1] as unknown as FakeHeaderElement;
      expect(select.value).toBe("typesafe/jev");
      select.value = "laya";
      select.listeners.get("change")?.({ stopPropagation: vi.fn() });
      await Promise.resolve();
      await Promise.resolve();
      expect(buddyConfigure).toHaveBeenCalledWith(
        expect.objectContaining({ systemOneModel: "laya" }),
      );
      control.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not issue status requests from MutationObserver-driven reposition calls", async () => {
    const shell = createFakeHeader({ nativeActions: true });
    const document = stubHeaderDocument(() => shell.header);
    const buddyStatus = vi.fn(async () => ({
      settings: {
        enabled: true,
        privateMode: false,
        role: "auto",
        bypass: true,
        jev: true,
        systemOneModel: "typesafe/jev",
        executorModel: null,
      },
      models: [],
      decisions: [],
      jevKeyConfigured: false,
      jevBaseUrl: null,
    }));
    const client = { buddyStatus } as unknown as RendererModelClient;

    try {
      const control = installSystemOneModelHeaderControl({
        getClient: () => client,
        getLocale: () => "zh-CN",
        ownerDocument: document,
      });
      await vi.waitFor(() => expect(buddyStatus).toHaveBeenCalledTimes(1));

      // 大量 DOM 变动触发的 scan 只重新定位，不得再次请求 buddyStatus。
      for (let index = 0; index < 500; index += 1) control.reposition();
      expect(buddyStatus).toHaveBeenCalledTimes(1);

      // 显式 refresh 会拉取一次新的状态。
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
      expect(control.refresh()).toBe(true);
      await Promise.resolve();
      expect(buddyStatus).toHaveBeenCalledTimes(2);
      control.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
