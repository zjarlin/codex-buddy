import { describe, expect, it, vi } from "vitest";

import { RendererSettingsPageScope } from "../../src/settings/core.js";
import { rendererSettingsMessages } from "../../src/settings/localization.js";
import { mountTerminalControls } from "../../src/settings/terminal-controls.js";
import { createThreadTerminalPreferenceStore } from "../../src/thread-terminal-preference.js";

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();
  className = "";
  disabled = false;
  htmlFor = "";
  id = "";
  textContent = "";
  title = "";
  type = "";
  value = "";

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.splice(0, this.children.length);
    this.append(...children);
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners.set(name, listener);
  }

  removeEventListener(name: string): void {
    this.listeners.delete(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  dispatch(name: string): void {
    this.listeners.get(name)?.();
  }

  parentElement: FakeElement | null = null;
}

class FakeDocument {
  readonly defaultView = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("terminal settings control", () => {
  it("lists installed terminals and persists the selected terminal", async () => {
    const document = new FakeDocument();
    const content = document.createElement("main");
    const preference = createThreadTerminalPreferenceStore(storage());
    const client = {
      listThreadTerminals: vi.fn(async () => ({
        terminals: [
          { id: "apple-terminal" as const, name: "Terminal", installed: true, default: true },
          { id: "ghostty" as const, name: "Ghostty", installed: true, default: false },
          { id: "warp" as const, name: "Warp", installed: false, default: false },
        ],
      })),
    };
    const scope = new RendererSettingsPageScope();

    const dispose = mountTerminalControls(
      {
        content: content as unknown as HTMLElement,
        signal: scope.signal,
        runLatest: (operation, handlers) => scope.runLatest(operation, handlers),
      },
      rendererSettingsMessages("en"),
      () => client,
      preference,
    );
    await vi.waitFor(() => expect(client.listThreadTerminals).toHaveBeenCalledOnce());
    await Promise.resolve();

    const select = content.children[0]?.children[1]?.children[0]?.children[1];
    if (!select) throw new Error("terminal select was not rendered");
    expect(select.children.map((option) => option.textContent)).toEqual([
      "System default",
      "Terminal",
      "Ghostty",
      "Warp (Not installed)",
    ]);
    expect(select.children[3]?.disabled).toBe(true);

    select.value = "ghostty";
    select.dispatch("change");
    expect(preference.get()).toBe("ghostty");
    dispose();
    scope.dispose();
  });
});
