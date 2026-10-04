import { afterEach, describe, expect, it, vi } from "vitest";

import { getDomMutationHub } from "../src/renderer-mutation-hub.js";

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];
  static lastConfig: MutationObserverInit | null = null;
  callback: MutationCallback;
  disconnected = false;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeMutationObserver.instances.push(this);
  }

  observe(_target: Node, config: MutationObserverInit): void {
    FakeMutationObserver.lastConfig = config;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  deliver(records: MutationRecord[]): void {
    this.callback(records, this as unknown as MutationObserver);
  }
}

function record(type: string, attributeName?: string): MutationRecord {
  return {
    type,
    target: {},
    attributeName,
    addedNodes: [],
    removedNodes: [],
  } as unknown as MutationRecord;
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeMutationObserver.instances = [];
  FakeMutationObserver.lastConfig = null;
});

describe("renderer mutation hub", () => {
  it("coalesces subscribers into one observer and applies per-subscriber attribute filters", () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const doc = { documentElement: {} } as unknown as Document;
    const hub = getDomMutationHub(doc);

    const childCalls: MutationRecord[][] = [];
    const attrCalls: MutationRecord[][] = [];
    hub.subscribe({
      kinds: ["childList"],
      test: () => true,
      onMutate: (records) => childCalls.push([...records]),
    });
    hub.subscribe({
      kinds: ["attributes"],
      attributeFilter: ["data-x"],
      test: () => true,
      onMutate: (records) => attrCalls.push([...records]),
    });

    const active = FakeMutationObserver.instances.filter((o) => !o.disconnected);
    expect(active).toHaveLength(1);
    expect(FakeMutationObserver.lastConfig).toMatchObject({
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-x"],
    });

    // A batch with both types: each subscriber only sees its own kinds.
    active[0]?.deliver([
      record("childList"),
      record("attributes", "data-x"),
      record("attributes", "data-y"),
    ]);
    expect(childCalls).toHaveLength(1);
    expect(childCalls[0]).toHaveLength(1);
    expect(attrCalls).toHaveLength(1);
    expect(attrCalls[0]?.map((r) => r.attributeName)).toEqual(["data-x"]);

    hub.dispose();
    expect(active[0]?.disconnected).toBe(true);
  });

  it("runs each subscriber's test so scoped subscribers only fire for their own region", () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const doc = { documentElement: {} } as unknown as Document;
    const hub = getDomMutationHub(doc);

    const a: MutationRecord[][] = [];
    const b: MutationRecord[][] = [];
    hub.subscribe({ kinds: ["childList"], test: (m) => m === r1, onMutate: (x) => a.push([...x]) });
    hub.subscribe({ kinds: ["childList"], test: (m) => m === r2, onMutate: (x) => b.push([...x]) });
    const r1 = record("childList");
    const r2 = record("childList");

    const active = FakeMutationObserver.instances.filter((o) => !o.disconnected);
    active[0]?.deliver([r1, r2]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);

    hub.dispose();
  });

  it("unsubscribe re-observes and stops delivery", () => {
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const doc = { documentElement: {} } as unknown as Document;
    const hub = getDomMutationHub(doc);

    const calls: MutationRecord[][] = [];
    const unsubscribe = hub.subscribe({
      kinds: ["childList"],
      test: () => true,
      onMutate: (x) => calls.push([...x]),
    });
    unsubscribe();
    expect(FakeMutationObserver.instances.filter((o) => !o.disconnected)).toHaveLength(0);
    expect(calls).toHaveLength(0);

    hub.dispose();
  });
});
