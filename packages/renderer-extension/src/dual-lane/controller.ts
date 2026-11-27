import { getDomMutationHub } from "../renderer-mutation-hub.js";
import {
  COMPOSER_SELECTOR,
  FOCUS_AREA_ATTRIBUTE,
  SIDE_TAB_PREFIX,
  closeSideChat,
  hasSideChat,
  laneForComposer,
  nativeModelMenu,
  sideChatTarget,
  visibleComposers,
} from "./native.js";
import {
  DUAL_LANE_CHANGE_EVENT,
  readDualLaneSettings,
  type DualLaneSettings,
} from "./preference.js";

/** 原生把新会话草稿的浏览器身份写成这个前缀；有它才说明会话还没开始。 */
const DRAFT_PREFIX = "client-new-thread:";

/** 原生异步建 side chat，右栏 DOM 会晚到；按固定间隔补扫有限次数。 */
const MATERIALIZE_INTERVAL_MS = 400;
const MATERIALIZE_ATTEMPTS = 15;

const WATCHED_ATTRIBUTES = [
  "data-codex-composer-root",
  "data-tab-id",
  FOCUS_AREA_ATTRIBUTE,
] as const;

export interface DualLaneStatus {
  enabled: boolean;
  /** 当前主栏是新会话草稿，默认模型会写进去。 */
  draft: boolean;
  /** 主栏草稿已写入默认模型。 */
  mainApplied: boolean;
  /** 右栏侧边聊天已展开。 */
  sideOpen: boolean;
  /** 现在具备展开右栏的条件：会话已开始且原生提供入口。 */
  sideAvailable: boolean;
  /** 最近一次失败原因；成功后清空。 */
  error: string | null;
}

export interface DualLaneController {
  refresh(): void;
  status(): DualLaneStatus;
  dispose(): void;
}

/** 新会话草稿身份来自 Composer 上的原生 browserConversationId。 */
function draftIdOf(composer: Element): string | null {
  const key = Object.getOwnPropertyNames(composer).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return null;
  let fiber = Object.getOwnPropertyDescriptor(composer, key)?.value as
    { memoizedProps?: unknown; return?: unknown } | undefined;
  for (let depth = 0; fiber && depth < 250; depth += 1) {
    const props = fiber.memoizedProps;
    if (typeof props === "object" && props !== null) {
      const value = (props as Record<string, unknown>).browserConversationId;
      if (typeof value === "string" && value.startsWith(DRAFT_PREFIX)) return value;
    }
    fiber = fiber.return as typeof fiber;
  }
  return null;
}

/**
 * 双栏：主栏的新会话默认用 `mainModel`，右栏用 `sideModel` 展开一个原生
 * side chat。两条 lane 是各自独立的原生会话，模型互不影响。
 *
 * 所有写入都走原生接口：模型走原生模型菜单的选择回调，右栏走 Composer 上
 * 原生注入的 side chat 创建入口。这里不伪造会话，也不改写发送请求。
 */
export function installDualLane(
  options: {
    ownerDocument?: Document;
    ownerWindow?: Window;
    /**
     * 结构变化通知。默认订阅共享的 DOM 变更中心；宿主已有文档级扫描时改为
     * 直接调用 refresh()，不要在同一个文档上再挂一个观察者。
     */
    observe?: (refresh: () => void) => () => void;
    /** 异步建会话期间的补扫间隔；0 表示由宿主扫描负责。 */
    materializeIntervalMs?: number;
  } = {},
): DualLaneController {
  const doc = options.ownerDocument ?? document;
  const win = options.ownerWindow ?? window;
  /** 已写入默认模型的草稿；不反复覆盖用户在该草稿里的临时选择。 */
  const mainApplied = new Set<string>();
  /** 已尝试展开右栏的会话；用户自己关掉后不再重开。 */
  const sideAttempted = new Set<string>();
  /** 由本功能展开、仍未收起的会话；关闭双栏时只收起这些。 */
  const openedByUs = new Set<string>();
  const state: DualLaneStatus = {
    enabled: readDualLaneSettings(win).enabled,
    draft: false,
    mainApplied: false,
    sideOpen: false,
    sideAvailable: false,
    error: null,
  };
  let disposed = false;
  let remaining = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const applyMainDefault = (composer: Element, draftId: string, model: string): void => {
    if (!model || mainApplied.has(draftId)) return;
    const menu = nativeModelMenu(composer);
    // 原生菜单还没发布时留给下一次扫描，不抢写。
    if (!menu) return;
    if (menu.view.selected === model) {
      mainApplied.add(draftId);
      state.mainApplied = true;
      return;
    }
    try {
      menu.select(model);
      mainApplied.add(draftId);
      state.mainApplied = true;
      state.error = null;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "model-selection-failed";
    }
  };

  const openSide = (composer: Element, settings: DualLaneSettings): void => {
    const target = sideChatTarget(composer);
    state.sideAvailable = target !== null;
    if (!target) return;
    const key = `${target.hostId ?? "local"}:${target.conversationId}`;
    if (sideAttempted.has(key)) return;
    sideAttempted.add(key);
    openedByUs.add(key);
    remaining = MATERIALIZE_ATTEMPTS;
    const model = settings.sideModel || settings.mainModel;
    void target
      .open(model ? { model } : undefined)
      .then(() => {
        state.error = null;
      })
      .catch((error: unknown) => {
        state.error = error instanceof Error ? error.message : "side-chat-open-failed";
      });
  };

  const scan = (): void => {
    if (disposed) return;
    const settings = readDualLaneSettings(win);
    state.enabled = settings.enabled;
    const main = visibleComposers(doc).find((composer) => laneForComposer(composer) === "main");
    state.sideOpen = hasSideChat(doc);
    state.sideAvailable = false;
    if (!main) return;
    const draftId = draftIdOf(main);
    state.draft = draftId !== null;
    if (!settings.enabled) return;
    // 只有新会话才写主栏默认；已有会话保留它自己的模型。
    if (draftId) applyMainDefault(main, draftId, settings.mainModel);
    if (!draftId && !state.sideOpen) openSide(main, settings);
  };

  const materializeIntervalMs = options.materializeIntervalMs ?? MATERIALIZE_INTERVAL_MS;
  const scheduleMaterialize = (): void => {
    if (disposed || remaining <= 0 || materializeIntervalMs <= 0) return;
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      remaining -= 1;
      scan();
      scheduleMaterialize();
    }, materializeIntervalMs);
  };

  const refresh = (): void => {
    if (disposed) return;
    scan();
    scheduleMaterialize();
  };

  const observe =
    options.observe ??
    ((notify: () => void) =>
      getDomMutationHub(doc).subscribe({
        kinds: ["childList", "attributes"],
        attributeFilter: WATCHED_ATTRIBUTES,
        test: (mutation) => {
          const target = mutation.target instanceof Element ? mutation.target : null;
          if (!target) return false;
          return Boolean(
            target.closest(`${COMPOSER_SELECTOR}, [data-tab-id], [${FOCUS_AREA_ATTRIBUTE}]`) ??
            target.querySelector(`${COMPOSER_SELECTOR}, [data-tab-id^="${SIDE_TAB_PREFIX}"]`),
          );
        },
        onMutate: notify,
      }));
  // 关闭双栏只收起本功能展开的右栏；不碰用户自己开的侧边聊天。
  const collapseOpened = (): void => {
    if (openedByUs.size === 0) return;
    openedByUs.clear();
    sideAttempted.clear();
    closeSideChat(doc);
  };
  const onChange = (): void => {
    if (!readDualLaneSettings(win).enabled) collapseOpened();
    refresh();
  };
  const stopObserving = observe(refresh);
  win.addEventListener(DUAL_LANE_CHANGE_EVENT, onChange);
  refresh();

  return {
    refresh,
    status: () => ({ ...state }),
    dispose() {
      if (disposed) return;
      disposed = true;
      stopObserving();
      win.removeEventListener(DUAL_LANE_CHANGE_EVENT, onChange);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
