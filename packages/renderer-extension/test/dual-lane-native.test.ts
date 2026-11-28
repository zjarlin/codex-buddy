import { describe, expect, it, vi } from "vitest";
import {
  composerIdentity,
  laneForComposer,
  nativeModelMenu,
  sideChatTarget,
} from "../src/dual-lane/native.js";

const FIBER_PREFIX = "__reactFiber$";

/** Minimal Element stub: React fiber pointers plus the few DOM reads the helpers use. */
class Node {
  parentElement: Node | null = null;
  attributes = new Map<string, string>();
  constructor(
    readonly tagName: string,
    focusArea: string | null = null,
    private readonly button?: unknown,
  ) {
    if (focusArea) this.attributes.set("data-app-shell-focus-area", focusArea);
  }
  closest(selector: string): Node | null {
    const match = /^\[([^=\]]+)="([^"]+)"\]$/u.exec(selector);
    if (!match) return null;
    const name = match[1] ?? "";
    const value = match[2] ?? "";
    const walk = (start: Node | null): Node | null => {
      for (let node = start; node; node = node.parentElement) {
        if (node.attributes.get(name) === value) return node;
      }
      return null;
    };
    return walk(this);
  }
  querySelectorAll(selector: string): unknown[] {
    return selector === 'button[aria-haspopup="menu"]' && this.button ? [this.button] : [];
  }
}

function fiberChain(propsList: Record<string, unknown>[]) {
  const nodes = propsList.map((props) => ({ memoizedProps: props, return: null as unknown }));
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const node = nodes[index];
    if (node) node.return = nodes[index + 1];
  }
  return nodes[0];
}

function withFiber(target: object, fiber: unknown): void {
  Object.defineProperty(target, `${FIBER_PREFIX}test`, { value: fiber, enumerable: false });
}

function composer(focusArea: string | null, rootProps: Record<string, unknown>[]) {
  // 模型菜单按钮与 Composer 各自持有自己的 fiber 指针。
  const button = {};
  withFiber(button, fiberChain(rootProps));
  const node = new Node("DIV", focusArea, button);
  withFiber(node, fiberChain(rootProps));
  return node as unknown as Element;
}

describe("dual lane native contract", () => {
  it("treats a Composer inside the right panel as the side lane", () => {
    expect(laneForComposer(composer(null, [{}]))).toBe("main");
    expect(laneForComposer(composer("right-panel", [{}]))).toBe("side");
  });

  it("reads the native Model menu and selects by ID with a compatible effort", () => {
    const onSelectModel = vi.fn();
    const onSelectComplete = vi.fn();
    const menu = nativeModelMenu(
      composer(null, [
        {
          model: "ds",
          reasoningEffort: "high",
          modelOptions: [
            {
              model: {
                model: "free",
                displayName: "free",
                defaultReasoningEffort: "none",
                supportedReasoningEfforts: [{ reasoningEffort: "none" }],
              },
            },
            {
              model: {
                model: "ds",
                displayName: "ds",
                defaultReasoningEffort: "medium",
                supportedReasoningEfforts: [
                  { reasoningEffort: "high" },
                  { reasoningEffort: "medium" },
                ],
              },
            },
            { model: { model: "auto", displayName: "auto", hidden: true } },
          ],
          onSelectModel,
          onSelectComplete,
        },
      ]),
    );
    expect(menu?.view.selected).toBe("ds");
    expect(menu?.view.options.map(({ id }) => id)).toEqual(["free", "ds", "auto"]);
    menu?.select("free");
    // free 不支持 high，退到它自己的默认强度。
    expect(onSelectModel).toHaveBeenCalledExactlyOnceWith("free", "none");
    expect(onSelectComplete).toHaveBeenCalledOnce();
  });

  it("refuses a hidden or account-locked Model instead of writing an unsupported choice", () => {
    const menu = nativeModelMenu(
      composer(null, [
        {
          model: "ds",
          reasoningEffort: "high",
          lockedModelSlug: "ds",
          modelOptions: [{ model: { model: "ds", displayName: "ds" } }],
          onSelectModel: vi.fn(),
        },
      ]),
    );
    expect(menu?.view.unavailable).toContain("ds");
    expect(() => menu?.select("ds")).toThrow();
  });

  it("returns no binding when the native menu is disabled", () => {
    const menu = nativeModelMenu(
      composer(null, [
        {
          model: "ds",
          modelOptions: [{ model: { model: "ds", displayName: "ds" } }],
          onSelectModel: vi.fn(),
          modelOptionsDisabled: true,
        },
      ]),
    );
    expect(menu?.view.disabled).toBe(true);
    expect(() => menu?.select("free")).toThrow();
  });

  it("opens a side chat through the native Composer entry with the requested Model", async () => {
    const onCreateSideConversation = vi.fn().mockResolvedValue("side-id");
    const target = sideChatTarget(
      composer("", [{ conversationId: "conv-1", hostId: "local", onCreateSideConversation }]),
    );
    expect(target?.conversationId).toBe("conv-1");
    await target?.open({ model: "free", reasoningEffort: "none" });
    expect(onCreateSideConversation).toHaveBeenCalledExactlyOnceWith({
      sourceConversationId: "conv-1",
      hostId: "local",
      collaborationMode: {
        mode: "default",
        settings: { model: "free", reasoning_effort: "none" },
      },
    });
  });

  it("omits the Mode override when no Model was requested", async () => {
    const onCreateSideConversation = vi.fn().mockResolvedValue("side-id");
    const target = sideChatTarget(
      composer("", [{ conversationId: "conv-2", hostId: null, onCreateSideConversation }]),
    );
    await target?.open();
    expect(onCreateSideConversation).toHaveBeenCalledExactlyOnceWith({
      sourceConversationId: "conv-2",
    });
  });

  it("reports no side chat entry until the conversation has started", () => {
    // 新会话草稿只有 browserConversationId，没有可用的会话 ID。
    expect(sideChatTarget(composer("", [{ onCreateSideConversation: vi.fn() }]))).toBeNull();
    expect(sideChatTarget(composer("", [{ conversationId: "conv-3" }]))).toBeNull();
  });

  it("reads the draft id and the conversation id as separate signals", () => {
    // 原生在已有会话上同样保留 browserConversationId；两个字段必须各自报告，
    // 让上层能区分“还没开始”和“已经开始但带着草稿 ID”。
    expect(
      composerIdentity(
        composer("", [{ browserConversationId: "client-new-thread:draft", conversationId: "c-1" }]),
      ),
    ).toEqual({
      draftId: "client-new-thread:draft",
      conversationId: "c-1",
      hostId: null,
    });
    expect(composerIdentity(composer("", [{ browserConversationId: "other-id" }]))).toEqual({
      draftId: null,
      conversationId: null,
      hostId: null,
    });
  });
});
