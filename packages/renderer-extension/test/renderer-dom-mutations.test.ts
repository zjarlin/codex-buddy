import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RENDERER_INJECTED_ATTRIBUTE,
  mutationIsRendererOwnedWrite,
} from "../src/renderer-dom-mutations.js";

// 观察者只需要 Element 的 attributes/closest/parentElement 三件事；用最小桩避免
// 为纯判定引入 DOM 环境。
class FakeElement {
  attributes: Array<{ name: string }>;
  parentElement: FakeElement | null = null;

  constructor(...attributeNames: string[]) {
    this.attributes = attributeNames.map((name) => ({ name }));
  }

  closest(selector: string): FakeElement | null {
    return closestMatch(this, selector);
  }
}

function closestMatch(start: FakeElement | null, selector: string): FakeElement | null {
  const name = selector.replace(/^\[|\]$/gu, "");
  for (let current = start; current; current = current.parentElement) {
    if (current.attributes.some((attribute) => attribute.name === name)) return current;
  }
  return null;
}

function mutation(init: {
  type: "childList" | "attributes" | "characterData";
  target: FakeElement;
  attributeName?: string;
  added?: FakeElement[];
  removed?: FakeElement[];
}): MutationRecord {
  return {
    type: init.type,
    target: init.target,
    attributeName: init.attributeName ?? null,
    addedNodes: init.added ?? [],
    removedNodes: init.removed ?? [],
  } as unknown as MutationRecord;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderer owned writes", () => {
  it("ignores attribute and child mutations inside an injected node", () => {
    vi.stubGlobal("Element", FakeElement);
    const injected = new FakeElement(RENDERER_INJECTED_ATTRIBUTE);
    const child = new FakeElement();
    child.parentElement = injected;

    expect(
      mutationIsRendererOwnedWrite(
        mutation({ type: "attributes", target: child, attributeName: "aria-pressed" }),
      ),
    ).toBe(true);
    expect(mutationIsRendererOwnedWrite(mutation({ type: "childList", target: injected }))).toBe(
      true,
    );
  });

  it("ignores injected nodes added to a native parent", () => {
    vi.stubGlobal("Element", FakeElement);
    const native = new FakeElement();
    const injected = new FakeElement(RENDERER_INJECTED_ATTRIBUTE);

    expect(
      mutationIsRendererOwnedWrite(
        mutation({ type: "childList", target: native, added: [injected] }),
      ),
    ).toBe(true);
  });

  it("keeps native structure changes significant", () => {
    vi.stubGlobal("Element", FakeElement);
    const native = new FakeElement();
    const row = new FakeElement();

    expect(
      mutationIsRendererOwnedWrite(mutation({ type: "childList", target: native, added: [row] })),
    ).toBe(false);
    expect(
      mutationIsRendererOwnedWrite(
        mutation({ type: "attributes", target: native, attributeName: "aria-expanded" }),
      ),
    ).toBe(false);
  });

  it("ignores codexhost attributes written on native nodes", () => {
    vi.stubGlobal("Element", FakeElement);
    const row = new FakeElement();

    expect(
      mutationIsRendererOwnedWrite(
        mutation({
          type: "attributes",
          target: row,
          attributeName: "data-codexhost-project-tab-hidden",
        }),
      ),
    ).toBe(true);
  });
});
