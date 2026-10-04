import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import { getDomMutationHub } from "./renderer-mutation-hub.js";

const TAB_SELECTOR = '[role="tab"]';
const LAYOUT_ATTRIBUTE = "data-codexhost-native-file-pane-layout";

interface FilePaneTarget {
  tab: Record<string, unknown>;
  getItems(): unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// 使用标签自己的原生菜单；right 是内容面板标识，其视觉位置由官方布局状态决定。
function filePaneTarget(element: HTMLElement): FilePaneTarget | null {
  if (!element.isConnected || element.getClientRects().length === 0) {
    return null;
  }
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  if (!key) {
    return null;
  }
  let getItems: (() => unknown) | null = null;
  for (const fiber of committedReactAncestors(Reflect.get(element, key))) {
    const props = record(fiber.memoizedProps);
    if (!getItems && typeof props?.getItems === "function") {
      getItems = props.getItems as () => unknown;
    }
    const tab = record(props?.tab);
    if (!tab) {
      continue;
    }
    const kind = record(tab.tabType)?.kind;
    const isFile = kind === "workspace-file" || kind === "review";
    return isFile &&
      props?.isActive === true &&
      record(props.controller)?.panelId === "right" &&
      typeof tab.tabId === "string" &&
      typeof tab.dndId === "string" &&
      getItems
      ? { tab, getItems }
      : null;
  }
  return null;
}

// 新打开的文件／审查面板放在聊天左侧。原生动作同时更新内容、标题栏、分隔条和持久化状态。
export function installNativeFilePanePlacement(document: Document): { dispose(): void } {
  const ownerWindow = document.defaultView;
  if (!ownerWindow) {
    return { dispose() {} };
  }
  const states = new Map<
    HTMLElement,
    {
      dndId: unknown;
      attempts: number;
      pending: boolean;
      requested: boolean;
      complete: boolean;
    }
  >();
  let disposed = false;
  let timer = 0;

  const schedule = (): void => {
    if (!disposed && !timer) {
      timer = ownerWindow.setTimeout(sync, 100);
    }
  };
  const place = async (
    element: HTMLElement,
    target: FilePaneTarget,
    state: NonNullable<ReturnType<typeof states.get>>,
  ): Promise<void> => {
    state.pending = true;
    const isCurrent = (): boolean =>
      !disposed && states.get(element) === state && filePaneTarget(element)?.tab === target.tab;
    try {
      const items = await target.getItems();
      if (!isCurrent() || !Array.isArray(items)) {
        return;
      }
      const actions = items.map(record);
      const left = actions.find((item) => item?.id === "unified-workspace-move-left");
      const right = actions.find((item) => item?.id === "unified-workspace-move-right");
      if (!left && right?.enabled !== false && typeof right?.onSelect === "function") {
        state.complete = true;
        element.setAttribute(LAYOUT_ATTRIBUTE, "left");
        return;
      }
      if (!state.requested && left?.enabled !== false && typeof left?.onSelect === "function") {
        state.requested = true;
        // 不伪造拖放事件，不调用混淆导出，也不挪动 React 管理的 DOM。
        await left.onSelect();
      }
    } catch (error) {
      if (isCurrent()) {
        console.warn("无法将官方文件面板移到对话左侧。", error);
      }
    } finally {
      state.pending = false;
      state.attempts += 1;
      if (!disposed && !state.complete) {
        if (state.attempts < 10) {
          schedule();
        } else if (isCurrent()) {
          element.setAttribute(LAYOUT_ATTRIBUTE, "unavailable");
        }
      }
    }
  };
  const sync = (): void => {
    timer = 0;
    for (const element of states.keys()) {
      if (!element.isConnected) {
        states.delete(element);
      }
    }
    for (const element of document.querySelectorAll<HTMLElement>(TAB_SELECTOR)) {
      const target = filePaneTarget(element);
      if (!target) {
        continue;
      }
      let state = states.get(element);
      if (!state || state.dndId !== target.tab.dndId) {
        state = {
          dndId: target.tab.dndId,
          attempts: 0,
          pending: false,
          requested: false,
          complete: false,
        };
        states.set(element, state);
        element.removeAttribute(LAYOUT_ATTRIBUTE);
      }
      if (!state.complete && !state.pending && state.attempts < 10) {
        void place(element, target, state);
      }
    }
  };
  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList", "attributes"],
    attributeFilter: ["aria-selected"],
    test: (mutation) => mutationAffectsElements(mutation, TAB_SELECTOR),
    onMutate: () => schedule(),
  });
  sync();
  return {
    dispose() {
      disposed = true;
      stopObserving();
      ownerWindow.clearTimeout(timer);
      for (const element of document.querySelectorAll(`[${LAYOUT_ATTRIBUTE}]`)) {
        element.removeAttribute(LAYOUT_ATTRIBUTE);
      }
      states.clear();
    },
  };
}
