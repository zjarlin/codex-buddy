import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

/**
 * 双栏依赖的 Desktop 原生结构。这些都不是公开 API：每条选择器都对应一个
 * 在原生 App Shell 里可观察的标记，读取失败时上层按“不支持”处理而不是猜测。
 */

export type Lane = "main" | "side";

export const COMPOSER_SELECTOR = "[data-codex-composer-root]";
export const FOCUS_AREA_ATTRIBUTE = "data-app-shell-focus-area";
export const RIGHT_PANEL = "right-panel";
export const SIDE_TAB_PREFIX = "sidechat:";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fiberOf(element: Element): unknown {
  const key = Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
  return key ? Object.getOwnPropertyDescriptor(element, key)?.value : undefined;
}

/** Composer 是否位于原生右栏。右栏内的 Composer 属于 side chat，不是主会话。 */
export function laneForComposer(composer: Element): Lane {
  return composer.closest(`[${FOCUS_AREA_ATTRIBUTE}="${RIGHT_PANEL}"]`) ? "side" : "main";
}

/** 可见的 Composer；隐藏标签页保留在 DOM 里但宽度为 0。 */
export function visibleComposers(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(COMPOSER_SELECTOR)].filter((composer) => {
    const bounds = composer.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  });
}

export interface NativeModelOption {
  id: string;
  displayName: string;
  disabled: boolean;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: readonly string[];
}

/** 原生模型菜单在 React props 上的契约：目录 + 选择回调。 */
export interface NativeModelMenu {
  selected: string | null;
  reasoningEffort: string | null;
  options: readonly NativeModelOption[];
  disabled: boolean;
  /** 目录外模型（例如账号级锁定）不接受选择。 */
  unavailable: readonly string[];
}

export interface NativeModelMenuBinding {
  view: NativeModelMenu;
  select(id: string, reasoningEffort?: string | null): void;
}

function isModelMenuProps(props: Record<string, unknown>): boolean {
  return Array.isArray(props.modelOptions) && typeof props.onSelectModel === "function";
}

/**
 * 从 Composer 内的模型触发按钮向上找模型菜单 props。只接受同时发布目录与
 * 选择回调的那一层，避免命中外围只读投影。
 */
export function nativeModelMenu(composer: Element): NativeModelMenuBinding | null {
  for (const trigger of composer.querySelectorAll('button[aria-haspopup="menu"]')) {
    for (const fiber of committedReactAncestors(fiberOf(trigger))) {
      const props = record(fiber.memoizedProps);
      if (!props || !isModelMenuProps(props)) continue;
      const options: NativeModelOption[] = [];
      for (const value of props.modelOptions as unknown[]) {
        const option = record(value);
        const model = record(option?.model);
        if (typeof model?.model !== "string" || typeof model.displayName !== "string") continue;
        const efforts = Array.isArray(model.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts
              .map((entry) => record(entry)?.reasoningEffort)
              .filter((entry): entry is string => typeof entry === "string")
          : [];
        options.push({
          id: model.model,
          displayName: model.displayName,
          disabled: option?.disabledReason != null || model.hidden === true,
          defaultReasoningEffort:
            typeof model.defaultReasoningEffort === "string" ? model.defaultReasoningEffort : null,
          supportedReasoningEfforts: efforts,
        });
      }
      const daybreak = record(props.daybreak);
      const disabled =
        props.disabled === true ||
        props.modelOptionsDisabled === true ||
        daybreak?.disabled === true ||
        daybreak?.isSaving === true;
      const unavailable = options.filter(({ disabled: off }) => off).map(({ id }) => id);
      if (typeof props.lockedModelSlug === "string") unavailable.push(props.lockedModelSlug);
      const selectModel = props.onSelectModel as (id: string, effort: string | null) => void;
      return {
        view: {
          selected: typeof props.model === "string" ? props.model : null,
          reasoningEffort: typeof props.reasoningEffort === "string" ? props.reasoningEffort : null,
          options,
          disabled,
          unavailable,
        },
        select(id, reasoningEffort) {
          if (disabled || unavailable.includes(id))
            throw new Error("Model selection is unavailable");
          const option = options.find((entry) => entry.id === id);
          const effort =
            reasoningEffort !== undefined
              ? reasoningEffort
              : option?.supportedReasoningEfforts.includes(
                    typeof props.reasoningEffort === "string" ? props.reasoningEffort : "",
                  )
                ? (props.reasoningEffort as string)
                : (option?.defaultReasoningEffort ?? null);
          selectModel(id, effort);
          if (typeof props.onSelectModelOption === "function") props.onSelectModelOption();
          if (typeof props.onSelectComplete === "function") props.onSelectComplete();
        },
      };
    }
  }
  return null;
}

/** 原生把新会话草稿的浏览器身份写成这个前缀；有它才说明会话还没开始。 */
export const DRAFT_PREFIX = "client-new-thread:";

export interface ComposerIdentity {
  /** 新会话草稿身份；已有会话也可能带上它，所以不能单独用来判断草稿。 */
  draftId: string | null;
  /** 原生会话 ID；新会话草稿阶段为 null。 */
  conversationId: string | null;
  hostId: string | null;
}

/**
 * Composer 上原生发布的三段身份。草稿判定必须同时看 `draftId` 与
 * `conversationId`：原生在已有会话的 Composer 上也会保留草稿 ID，只看草稿
 * ID 会把正常会话误判成新会话。
 */
export function composerIdentity(composer: Element): ComposerIdentity {
  let draftId: string | null = null;
  let conversationId: string | null = null;
  let hostId: string | null = null;
  for (const fiber of committedReactAncestors(fiberOf(composer))) {
    const props = record(fiber.memoizedProps);
    if (!props) continue;
    if (draftId === null && typeof props.browserConversationId === "string") {
      if (props.browserConversationId.startsWith(DRAFT_PREFIX))
        draftId = props.browserConversationId;
    }
    if (conversationId === null && typeof props.conversationId === "string")
      conversationId = props.conversationId;
    if (hostId === null && typeof props.hostId === "string") hostId = props.hostId;
  }
  return { draftId, conversationId, hostId };
}

/** 右栏 side chat 的原生会话身份，用于判断同一会话是否已经展开。 */
export interface SideChatTarget {
  conversationId: string;
  hostId: string | null;
  open(collaborationMode?: { model: string; reasoningEffort?: string | null }): Promise<unknown>;
}

/**
 * 主 Composer 上原生注入的 side chat 创建入口。Desktop 只在已有会话内提供它，
 * 且只在当前会话已经开始后才赋值，所以缺失就表示现在不能开侧边聊天。
 */
export function sideChatTarget(composer: Element): SideChatTarget | null {
  let create: ((input: Record<string, unknown>) => Promise<unknown>) | null = null;
  for (const fiber of committedReactAncestors(fiberOf(composer))) {
    const props = record(fiber.memoizedProps);
    if (!props) continue;
    if (!create && typeof props.onCreateSideConversation === "function") {
      create = props.onCreateSideConversation as (
        input: Record<string, unknown>,
      ) => Promise<unknown>;
      break;
    }
  }
  const { conversationId, hostId } = composerIdentity(composer);
  if (!create || !conversationId) return null;
  // hostId 只在解析到时传入：显式 null 会让原生改用默认 Host 而不是当前会话。
  const source: Record<string, unknown> = { sourceConversationId: conversationId };
  if (hostId !== null) source.hostId = hostId;
  return {
    conversationId,
    hostId,
    open(collaborationMode) {
      // 原生入口返回 Promise；包一层保证调用方永远拿到 thenable。
      return Promise.resolve(
        create({
          ...source,
          ...(collaborationMode
            ? {
                collaborationMode: {
                  mode: "default",
                  settings: {
                    model: collaborationMode.model,
                    ...(collaborationMode.reasoningEffort
                      ? { reasoning_effort: collaborationMode.reasoningEffort }
                      : {}),
                  },
                },
              }
            : {}),
        }),
      );
    },
  };
}

/**
 * 右栏是否已展开 side chat。原生给每张标签页写 `data-tab-id="sidechat:<id>"`，
 * 只有当前可见的那张内容面板宽度大于 0。
 */
export function hasSideChat(root: ParentNode = document): boolean {
  return [...root.querySelectorAll(`[data-tab-id^="${SIDE_TAB_PREFIX}"]`)].some((element) => {
    const bounds = (element as HTMLElement).getBoundingClientRect?.();
    return Boolean(bounds && bounds.width > 0 && bounds.height > 0);
  });
}

/** 关闭当前 side chat，走原生标签页关闭按钮（含原生确认流程）。 */
export function closeSideChat(root: ParentNode = document): boolean {
  for (const tab of root.querySelectorAll(`[data-tab-id^="${SIDE_TAB_PREFIX}"]`)) {
    const button = tab.querySelector<HTMLButtonElement>("[data-app-shell-tab-close-button]");
    if (button) {
      button.click();
      return true;
    }
  }
  return false;
}
