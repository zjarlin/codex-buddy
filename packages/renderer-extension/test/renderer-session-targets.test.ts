import { describe, expect, it, vi } from "vitest";

import { sessionDraftCleanup } from "../src/renderer-session-targets.js";

function emptyDocument(size = 3) {
  const empty = { empty: true };
  return {
    content: { size },
    type: {
      createAndFill: () => empty,
    },
  };
}

function editorFixture(ancestorProps: (controller: object) => Record<string, unknown>[]) {
  const doc = emptyDocument();
  const dispatch = vi.fn();
  const editor = {
    isConnected: true,
    tagName: "DIV",
    parentElement: null,
  } as unknown as HTMLElement;
  const controller = {
    view: {
      dom: editor,
      state: {
        doc,
        tr: { delete: () => ({ deleted: true }) },
      },
      posAtDOM: () => 0,
      dispatch,
    },
    insertMentionNodeInRange: () => {},
  };
  let returnFiber: Record<string, unknown> | null = null;
  for (const props of ancestorProps(controller).toReversed()) {
    returnFiber = { memoizedProps: props, return: returnFiber };
  }
  Reflect.set(editor, "__reactFiber$test", returnFiber);
  return { editor, controller, doc, dispatch };
}

describe("session draft cleanup", () => {
  it("uses the save callback from the same Composer without initialDocument", () => {
    const save = vi.fn();
    const { editor, dispatch } = editorFixture((controller) => [
      { composerController: controller, onDocumentChange: save },
    ]);

    expect(() => sessionDraftCleanup(editor)()).not.toThrow();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({ empty: true }, false);
  });

  it("falls back to the nearest document owner when no ancestor carries the controller", () => {
    const nearest = vi.fn();
    const outer = vi.fn();
    const { editor } = editorFixture(() => [
      { onDocumentChange: nearest },
      { onDocumentChange: outer },
    ]);

    sessionDraftCleanup(editor)();

    expect(nearest).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });
});
