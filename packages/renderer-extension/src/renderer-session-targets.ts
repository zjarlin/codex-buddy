import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";
import { PROJECT_ROW_SELECTOR, rowProject } from "./project-tabs/native-binding.js";
import { findNativeComposerController } from "./renderer-native-composer-controller.js";
import { nativeProjectStart } from "./renderer-native-project-start.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export interface SessionProject {
  hostId: string;
  cwd: string;
  title: string;
  open(): void;
}

/** 使用项目行的原生新建入口，让 Desktop 决定项目、Host 和草稿配置。 */
export function sessionProjects(hostId: string): SessionProject[] {
  const projects: SessionProject[] = [];
  for (const row of document.querySelectorAll<HTMLElement>(PROJECT_ROW_SELECTOR)) {
    const project = rowProject(row);
    const cwd = record(project)?.path;
    if (
      !project ||
      (project.hostId ?? "local") !== hostId ||
      typeof cwd !== "string" ||
      !cwd ||
      projects.some((item) => item.cwd === cwd) ||
      !nativeProjectStart(row, project.projectId)
    ) {
      continue;
    }
    projects.push({
      hostId,
      cwd,
      title: project.label,
      open: () => {
        const current = rowProject(row);
        const start = nativeProjectStart(row, project.projectId);
        if (
          !row.isConnected ||
          !current ||
          (current.hostId ?? "local") !== hostId ||
          record(current)?.path !== cwd ||
          !start
        ) {
          throw new Error("项目的新建会话入口已变化，请重新选择");
        }
        start();
      },
    });
  }
  return projects;
}

/** 获取编辑器正文时保留换行；当前会话发送仍完整使用原生草稿。 */
export function sessionDraftText(editor: HTMLElement | null): string {
  if (!editor) {
    return "";
  }
  if (editor.tagName === "TEXTAREA") {
    return (editor as HTMLTextAreaElement).value;
  }
  return editor.innerText ?? editor.textContent ?? "";
}

export function hasSessionAttachments(composer: Element): boolean {
  if (typeof composer?.querySelectorAll !== "function") return false;
  return [
    ...composer.querySelectorAll("[data-composer-attachments-row], [data-appshot-attachment]"),
  ].some((element) => element.childElementCount > 0 || Boolean(element.textContent?.trim()));
}

/**
 * 图片草稿的原生身份。`id` 由 Desktop 附件 store 分配，`src` 是原始 data URL；
 * 预览地址（`previewSrc`）会被异步替换成本地资源，不能用作身份或字节来源。
 */
export interface SessionDraftImage {
  id: string;
  dataUrl: string;
  filename: string;
}

interface DraftAttachmentState {
  /** 原生声明的图片 id；预览地址变化不影响身份。 */
  ids: string[];
  /** 可以按原生粘贴重建的图片；任何一张读不出来时为空。 */
  images: SessionDraftImage[];
  /** 图片、文件、长文本、应用截图、评论等附件以外的草稿内容项数。 */
  others: number;
}

/** Desktop 26.1029 的附件托盘同时持有图片、文件、长文本、应用截图和评论等独立状态。 */
const OTHER_ATTACHMENT_FIELDS = [
  "fileAttachments",
  "pastedTextAttachments",
  "pendingPastedTextAttachments",
  "pendingPastes",
  "addedFiles",
  "appshotContexts",
  "pendingAppshotCaptures",
  "uploadedFileAttachments",
  "sharedThreadAttachments",
  "commentAttachments",
  "imageCommentDrafts",
  "imageCommentGroups",
  "selectedTextAttachments",
  "mcpAppModelContextAttachments",
  "responseTextAnnotations",
  "threadReferences",
  "chatGptConversationContexts",
  "computerUseAppMentions",
  "pullRequestChecks",
] as const;

const MAX_TRANSFER_IMAGE_BYTES = 20 * 1024 * 1024;
/** Desktop 的图片草稿只把这几种格式落成临时文件，其余格式重放也放不进目标。 */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function imageType(dataUrl: string): string {
  // MIME 子类型本身含 `/`（`image/png`），字符类必须收录，否则所有图片都会被判为不可读。
  return /^data:([a-z0-9.+\/-]+);base64,/iu.exec(dataUrl)?.[1]?.toLowerCase() ?? "";
}

function attachmentRow(composer: Element): Element | null {
  return composer.querySelector?.("[data-composer-attachments-row]") ?? null;
}

/** 附件托盘里的磁贴数量；只用于判断托盘有没有内容，不反推附件个数。 */
function sessionAttachmentCount(composer: Element): number {
  return attachmentRow(composer)?.childElementCount ?? 0;
}

/**
 * 取图片的原始字节来源。`src` 会被预览流程换成本地资源地址，只在这些字段里
 * 仍有 base64 data URL 时才认为可以重建；扩展名必须来自同一份数据。
 */
function imageSource(
  image: Record<string, unknown> | null,
): { dataUrl: string; extension: string } | null {
  for (const candidate of [image?.src, image?.uploadSrc, image?.previewSrc]) {
    if (typeof candidate !== "string") continue;
    const extension = IMAGE_EXTENSIONS[imageType(candidate)];
    if (extension) return { dataUrl: candidate, extension };
  }
  return null;
}

function draftAttachmentState(props: Record<string, unknown>): DraftAttachmentState | null {
  const images = props.imageAttachments;
  if (!Array.isArray(images)) return null;
  const ids: string[] = [];
  const parsed: SessionDraftImage[] = [];
  // `src` 被预览流程换成本地资源地址后仍要能识别图片身份，因此 id 与可重建
  // 字节分开判断：读不出字节的图片也占着草稿，只是不能被转移。
  let readable = true;
  for (const value of images) {
    const image = record(value);
    const id = image?.id;
    const source = imageSource(image);
    if (typeof id !== "string") {
      readable = false;
      continue;
    }
    ids.push(id);
    if (!source) {
      readable = false;
      continue;
    }
    const named = typeof image?.filename === "string" ? image.filename.trim() : "";
    parsed.push({
      id,
      dataUrl: source.dataUrl,
      filename: !named
        ? `image.${source.extension}`
        : /\.[a-z0-9]+$/iu.test(named)
          ? named
          : `${named}.${source.extension}`,
    });
  }
  if (!readable) parsed.length = 0;
  let others = 0;
  for (const name of OTHER_ATTACHMENT_FIELDS) {
    const value = props[name];
    others += Array.isArray(value) ? value.length : 0;
  }
  for (const value of [props.chromeExtensionPageSelection, props.pullRequestMergeConflict]) {
    others += value === null || value === undefined ? 0 : 1;
  }
  return { ids, images: parsed, others };
}

/**
 * 读取 Composer 自己的附件草稿状态。缩略图在预览生成后会换成本地资源地址，
 * 因此只能读原生 `imageAttachments`，不能读磁贴上的 DOM `src`。
 * 由近及远取第一层携带附件声明的 Composer 容器，避免外层页面的旧草稿。
 */
function sessionDraftAttachmentState(composer: Element): DraftAttachmentState | null {
  const row = attachmentRow(composer);
  const element = row ?? composer;
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return null;
  for (const fiber of committedReactAncestors(Reflect.get(element, key))) {
    const state = draftAttachmentState(record(fiber.memoizedProps) ?? {});
    if (state) return state;
  }
  return null;
}

/** 草稿指纹里的附件身份。图片只取原生 id，预览地址异步更新不会让草稿被判为已修改。 */
export function sessionAttachmentSignature(composer: Element): string[] {
  const state = sessionDraftAttachmentState(composer);
  if (state) {
    return [
      ...state.ids.map((id) => `image:${id}`),
      ...Array.from({ length: state.others }, () => "other"),
    ];
  }
  // 原生状态读不出来时，磁贴数量变化仍说明草稿变了。
  return Array.from({ length: sessionAttachmentCount(composer) }, (_, index) => `tile:${index}`);
}

/**
 * 读取可以按原生粘贴重建的图片附件。文件、应用截图、评论等附件由各自原生状态
 * 持有，缺少对应搬运契约时整份草稿保持不可转移，不能只搬走能读的部分。
 * 托盘里的磁贴可能打包进少量容器节点，因此只看原生状态是否声明了其他附件，
 * 不拿子节点数反推附件个数。
 */
export function sessionDraftImages(composer: Element): SessionDraftImage[] | null {
  if (!hasSessionAttachments(composer)) return [];
  // 应用截图有独立的原生状态和磁盘文件，重放粘贴无法复现。
  if (composer.querySelector?.("[data-appshot-attachment]")) return null;
  const state = sessionDraftAttachmentState(composer);
  if (!state || state.others > 0) return null;
  // 有附件托盘却读不到任何图片，说明这里认不出托盘内容，不能只搬图片。
  return state.images.length > 0 ? state.images : null;
}

/**
 * 目标会话已登记的原生图片数量。Desktop 在登记图片后会替换显示地址，
 * 因此确认收下时只看原生声明的图片数，不再要求仍能读回原始字节。
 */
export function sessionDraftImageCount(composer: Element): number | null {
  return sessionDraftAttachmentState(composer)?.ids.length ?? null;
}

function decodeSessionImage(image: SessionDraftImage): {
  type: string;
  bytes: Uint8Array<ArrayBuffer>;
} {
  const type = imageType(image.dataUrl);
  const data =
    /^data:[a-z0-9.+\/-]+;base64,([A-Za-z0-9+/]*={0,2})$/iu.exec(image.dataUrl)?.[1] ?? "";
  if (!IMAGE_EXTENSIONS[type] || !data || data.length % 4 !== 0) {
    throw new Error("来源图片附件无法读取，草稿已保留");
  }
  if (data.length > Math.ceil(MAX_TRANSFER_IMAGE_BYTES / 3) * 4) {
    throw new Error("来源图片附件超过 20 MiB，草稿已保留");
  }
  const decoded = atob(data);
  if (decoded.length > MAX_TRANSFER_IMAGE_BYTES || btoa(decoded) !== data) {
    throw new Error("来源图片附件无法读取，草稿已保留");
  }
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return { type, bytes };
}

/**
 * 在目标输入框重放一次原生粘贴，让 Desktop 自己登记图片并生成发送用的附件路径。
 * 直接写草稿状态会绕过上传、预览和路径生成，这里只使用输入框已有的粘贴处理。
 */
export function pasteSessionImages(
  editor: HTMLElement,
  images: readonly SessionDraftImage[],
): boolean {
  const view = editor.ownerDocument?.defaultView;
  if (!images.length || !view?.DataTransfer || !view.ClipboardEvent || !view.File) return false;
  const data = new view.DataTransfer();
  for (const image of images) {
    const decoded = decodeSessionImage(image);
    data.items.add(new view.File([decoded.bytes], image.filename, { type: decoded.type }));
  }
  const event = new view.ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: data,
  });
  editor.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * 来源的附件移除入口。Desktop 自己用 `onRemoveImage(id)` 删除草稿里的图片，
 * 调用它会同时更新预览和持久草稿；目标已发出后来源会话可能已卸载，
 * 因此这里在确认转移时先取到处理器，不能等到清理时再查 DOM。
 */
function sessionDraftAttachmentRemover(composer: Element): ((id: string) => void) | null {
  const row = attachmentRow(composer);
  const element = row ?? composer;
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return null;
  for (const fiber of committedReactAncestors(Reflect.get(element, key))) {
    const props = record(fiber.memoizedProps);
    if (typeof props?.onRemoveImage === "function" && Array.isArray(props.imageAttachments)) {
      const remove = props.onRemoveImage as (value: string) => void;
      return (id) => remove.call(props, id);
    }
  }
  return null;
}

/** 校验草稿可搬运，并返回需要在目标会话重建的图片附件。 */
export function assertTransferableSessionDraft(
  composer: Element,
  editor: HTMLElement,
): readonly SessionDraftImage[] {
  // 附件由原生草稿独立持有：图片可以按原生粘贴重建，其他附件缺少搬运契约。
  const images = sessionDraftImages(composer);
  if (
    !images ||
    editor.querySelector(
      '[contenteditable="false"], img, strong, em, a, pre, code, ul, ol, blockquote',
    )
  ) {
    throw new Error("含附件、引用或格式的草稿暂不能跨会话发送，草稿已保留");
  }
  if (!findNativeComposerController(editor)) {
    throw new Error("当前桌面版的草稿转移接口不可用，草稿已保留");
  }
  return images;
}

/** 等待原生状态反映图片移除；返回仍未移除的数量。 */
async function pendingImageCount(
  composer: Element,
  view: Window | null | undefined,
): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const remaining = sessionDraftImageCount(composer);
    // 读不出原生状态时不能假定已经移除。
    if (remaining === null) return 1;
    if (remaining === 0) return 0;
    await new Promise<void>((resolve) => {
      if (view?.requestAnimationFrame) view.requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }
  return sessionDraftImageCount(composer) ?? 1;
}

/**
 * 成功搬运后清理原生持久草稿；目标未接受发送时不清理来源。
 * `images` 是确认转移时固定下来的图片附件。切到目标会话后输入框可能被复用，
 * 因此图片移除入口在确认转移时就已经取好，不能等清理时再按当前 DOM 查找。
 */
export function sessionDraftCleanup(
  editor: HTMLElement,
  composer: Element,
  images: readonly SessionDraftImage[],
): () => Promise<void> {
  const controller = findNativeComposerController(editor);
  const doc = record(controller?.view.state.doc);
  const type = record(doc?.type);
  if (!controller || !doc || typeof type?.createAndFill !== "function") {
    throw new Error("无法安全清理来源草稿，未转移消息");
  }
  const key = Object.keys(editor).find((name) => name.startsWith("__reactFiber$"));
  const candidates = (key ? committedReactAncestors(Reflect.get(editor, key)) : [])
    .map((fiber) => record(fiber.memoizedProps))
    .filter((props) => typeof props?.onDocumentChange === "function");
  // Desktop 26.1027 may omit initialDocument from the owning wrapper while
  // still passing onDocumentChange. Prefer the callback bound to this exact
  // Composer controller; otherwise the nearest document owner is the save entry.
  const props =
    candidates.find((props) => props?.composerController === controller) ?? candidates[0];
  if (typeof props?.onDocumentChange !== "function") {
    throw new Error("无法确认来源草稿的保存入口，未转移消息");
  }
  const save = props.onDocumentChange as (document: unknown, plainTextMode: boolean) => void;
  const empty = type.createAndFill.call(type);
  // 拿不到移除入口时保留图片，也保留正文：附件与正文必须作为一份草稿一起留下或一起清空。
  const remove = images.length > 0 ? sessionDraftAttachmentRemover(composer) : null;
  const row = attachmentRow(composer);
  return async () => {
    // 同一编辑器被复用或用户已修改来源时，不能清除新输入。
    if (controller.view.state.doc !== doc) {
      return;
    }
    if (images.length > 0) {
      if (!remove) return;
      try {
        for (const image of images) remove(image.id);
      } catch {
        return;
      }
      // 来源会话仍挂载时用原生状态确认图片真的移除了；会话已卸载后托盘不再
      // 更新，只能以移除调用成功为准，否则会留下“正文清空、图片还在”的半份草稿。
      if (row?.isConnected) {
        const view = composer.ownerDocument?.defaultView;
        const remaining = await pendingImageCount(composer, view);
        if (remaining > 0) return;
      }
    }
    if (controller.view.state.doc !== doc) {
      return;
    }
    if (editor.isConnected) {
      const size = record(doc.content)?.size;
      if (typeof size === "number") {
        controller.view.dispatch(controller.view.state.tr.delete(0, size));
      }
    }
    save(empty, false);
  };
}
