import { describe, expect, it, vi } from "vitest";

import {
  assertTransferableSessionDraft,
  pasteSessionImages,
  sessionAttachmentSignature,
  sessionDraftCleanup,
  sessionDraftImageCount,
  sessionDraftImages,
  sessionDraftImagesUploading,
} from "../src/renderer-session-targets.js";

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
    querySelector: () => null,
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

const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
/** 原生草稿里的图片用 `src` 持有原始 data URL。 */
const nativeImage = () => ({ id: "image-1", src: imageDataUrl, filename: "image-1.png" });
/** 转移用的图片按 `dataUrl` 命名，避免和原生字段混淆。 */
const transferImage = { id: "image-1", dataUrl: imageDataUrl, filename: "image-1.png" };

function imageDraft(extraProps: Record<string, unknown> = {}, draftImage = nativeImage()) {
  const fiber: { memoizedProps: Record<string, unknown>; return: null } = {
    memoizedProps: { imageAttachments: [draftImage], ...extraProps },
    return: null,
  };
  const row = {
    childElementCount: 1,
    textContent: "",
    isConnected: true,
    __reactFiber$test: fiber,
  };
  // 原生移除入口会同时更新磁贴与 `imageAttachments`。
  const removeImage = fiber.memoizedProps.onRemoveImage;
  if (typeof removeImage === "function") {
    fiber.memoizedProps.onRemoveImage = (id: string) => {
      removeImage(id);
      fiber.memoizedProps.imageAttachments = [];
      row.childElementCount = 0;
    };
  }
  const composer = {
    querySelector: (selector: string) => (selector.includes("attachments-row") ? row : null),
    querySelectorAll: () => [row],
  } as unknown as Element;
  return { composer, row, image: draftImage };
}

function transferEditor() {
  return editorFixture((controller) => [
    { composerController: controller, onDocumentChange: vi.fn() },
  ]).editor;
}

describe("session draft image attachments", () => {
  it("reads native image identity instead of the DOM preview source", () => {
    const { composer } = imageDraft();
    expect(sessionDraftImages(composer)).toEqual([
      { id: "image-1", dataUrl: imageDataUrl, filename: "image-1.png" },
    ]);
    expect(assertTransferableSessionDraft(composer, transferEditor())).toHaveLength(1);
  });

  it("keeps the draft untransferable when another attachment shares the tray", () => {
    const { composer } = imageDraft({ fileAttachments: [{ id: "file-1" }] });
    expect(sessionDraftImages(composer)).toBeNull();
    expect(() => assertTransferableSessionDraft(composer, transferEditor())).toThrow(
      "含附件、引用或格式的草稿暂不能跨会话发送",
    );
  });

  it("keeps the draft untransferable when the tray contents are unreadable", () => {
    const row = {
      childElementCount: 1,
      textContent: "attached.txt",
      isConnected: true,
      __reactFiber$test: { memoizedProps: { imageAttachments: [] }, return: null },
    };
    const composer = {
      querySelector: (selector: string) => (selector.includes("attachments-row") ? row : null),
      querySelectorAll: () => [row],
    } as unknown as Element;
    expect(sessionDraftImages(composer)).toBeNull();
    expect(() => assertTransferableSessionDraft(composer, transferEditor())).toThrow(
      "含附件、引用或格式的草稿暂不能跨会话发送",
    );
  });

  it("falls back to the upload source once the preview replaces src", () => {
    const draftImage = {
      ...nativeImage(),
      src: "app://cache/image-1.png",
      uploadSrc: imageDataUrl,
    };
    const { composer } = imageDraft({}, draftImage);
    expect(sessionDraftImages(composer)).toEqual([transferImage]);
  });

  it("does not treat image preview churn as a draft change", () => {
    const { composer, image: draftImage } = imageDraft();
    const before = sessionAttachmentSignature(composer);
    // Desktop 在预览就绪后把显示地址换成本地资源，附件身份不变。
    draftImage.src = "app://cache/image-1.png";
    expect(sessionAttachmentSignature(composer)).toEqual(before);
    // 显示地址被替换、又读不到原始字节时，目标收图确认仍按原生图片数进行。
    expect(sessionDraftImageCount(composer)).toBe(1);
  });

  it("reports a target image still uploading as not ready to send", () => {
    const draftImage = { ...nativeImage(), uploadStatus: "uploading" };
    const uploading = imageDraft({}, draftImage);
    // 云模式下 Desktop 在图片上传完成前禁用发送按钮，只能等它落成临时文件。
    expect(sessionDraftImagesUploading(uploading.composer)).toBe(true);
    expect(sessionDraftImagesUploading(imageDraft().composer)).toBe(false);
  });

  it("notices a removed attachment in the draft fingerprint", () => {
    const { composer, row } = imageDraft();
    expect(sessionAttachmentSignature(composer)).toEqual(["image:image-1"]);
    // Desktop 的移除入口会同时更新磁贴和原生 `imageAttachments`。
    row.childElementCount = 0;
    row.__reactFiber$test.memoizedProps.imageAttachments = [];
    expect(sessionAttachmentSignature(composer)).toEqual([]);
  });

  it("replays images through the native paste handler", () => {
    const consumed = pasteView(true);
    expect(pasteSessionImages(consumed.editor, [transferImage])).toBe(true);
    expect(consumed.files).toHaveLength(1);
    expect(consumed.files[0]).toMatchObject({
      name: "image-1.png",
      options: { type: "image/png" },
    });
    // 输入框没有消费粘贴时不能继续写正文，否则目标只会有文字没有图片。
    expect(pasteSessionImages(pasteView(false).editor, [transferImage])).toBe(false);
  });

  it("refuses to replay an unreadable data URL", () => {
    expect(() =>
      pasteSessionImages(pasteView(true).editor, [
        { id: "image-1", dataUrl: "data:image/png;base64,@@", filename: "image-1.png" },
      ]),
    ).toThrow("来源图片附件无法读取");
  });
});

function pasteView(consumes: boolean) {
  const files: { name: string; options: unknown; parts: unknown[] }[] = [];
  const editor = {
    ownerDocument: {
      defaultView: {
        DataTransfer: class {
          readonly items = { add: (file: (typeof files)[number]) => files.push(file) };
        },
        ClipboardEvent: class {
          defaultPrevented = consumes;
          constructor(
            readonly type: string,
            readonly init: unknown,
          ) {}
        },
        File: class {
          constructor(
            readonly parts: unknown[],
            readonly name: string,
            readonly options: unknown,
          ) {}
        },
      },
    },
    dispatchEvent: vi.fn(() => true),
  } as unknown as HTMLElement;
  return { editor, files };
}

describe("session draft cleanup", () => {
  it("uses the save callback from the same Composer without initialDocument", async () => {
    const save = vi.fn();
    const { editor, dispatch } = editorFixture((controller) => [
      { composerController: controller, onDocumentChange: save },
    ]);

    await sessionDraftCleanup(editor, editor, [])();

    expect(dispatch).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({ empty: true }, false);
  });

  it("falls back to the nearest document owner when the controller is not bound to a saver", async () => {
    const nearest = vi.fn();
    const outer = vi.fn();
    const { editor } = editorFixture((controller) => [
      { onDocumentChange: nearest },
      { onDocumentChange: outer },
      // 控制器在外层 fiber 上，但没有任何 onDocumentChange 与它绑定。
      { composerController: controller },
    ]);

    await sessionDraftCleanup(editor, editor, [])();

    expect(nearest).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it("keeps the whole draft when image removal is unavailable", async () => {
    const save = vi.fn();
    const { editor, dispatch } = editorFixture((controller) => [
      { composerController: controller, onDocumentChange: save },
    ]);
    const { composer } = imageDraft();

    await sessionDraftCleanup(editor, composer, [transferImage])();

    expect(dispatch).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("removes the transferred images before clearing the text", async () => {
    const save = vi.fn();
    const { editor, dispatch } = editorFixture((controller) => [
      { composerController: controller, onDocumentChange: save },
    ]);
    const removed: string[] = [];
    const { composer } = imageDraft({
      onRemoveImage: (id: string) => {
        removed.push(id);
      },
    });

    await sessionDraftCleanup(editor, composer, [transferImage])();

    expect(removed).toEqual(["image-1"]);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({ empty: true }, false);
  });
});
