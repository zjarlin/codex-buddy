import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

const PANE_ATTRIBUTE = "data-codexhost-native-file-tree-left";
const HANDLE_ATTRIBUTE = "data-codexhost-native-file-tree-resizer";
const SEPARATOR_SELECTOR = '[role="separator"][aria-orientation="vertical"]';

interface NativeTreeResize {
  edge: "left";
  defaultSize: number;
  getCurrentSize(): number;
  setSize(size: number): void;
}

interface TreeTarget {
  pane: HTMLElement;
  handle: HTMLElement;
  separator: HTMLElement;
  resize: NativeTreeResize;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// 以官方文件树和尺寸回调共同确认锚点，避免把终端或整个工作区的分隔条移位。
function nativeTreeTarget(separator: HTMLElement): TreeTarget | null {
  const handle = separator.parentElement;
  const pane = handle?.parentElement;
  const key = Object.keys(separator).find((name) => name.startsWith("__reactFiber$"));
  if (!key || !handle || !pane || !pane.classList.contains("shrink-0")) {
    return null;
  }
  let resize: NativeTreeResize | null = null;
  let ownsPane = false;
  for (const fiber of committedReactAncestors(Reflect.get(separator, key))) {
    const props = record(fiber.memoizedProps);
    if (
      !resize &&
      props?.edge === "left" &&
      typeof props.defaultSize === "number" &&
      typeof props.getCurrentSize === "function" &&
      typeof props.setSize === "function"
    ) {
      resize = props as unknown as NativeTreeResize;
    }
    ownsPane ||= fiber.stateNode === pane;
    const workspaceTree =
      props?.type === "workspace" &&
      Array.isArray(props.roots) &&
      typeof props.hostId === "string" &&
      typeof props.onSelectFile === "function";
    if (ownsPane && resize && (workspaceTree || props?.type === "changed-files")) {
      return { pane, handle, separator, resize };
    }
  }
  return null;
}

export function installNativeFileTreeLayout(document: Document): { dispose(): void } {
  const ownerWindow = document.defaultView;
  if (!ownerWindow) {
    return { dispose() {} };
  }
  const style = document.createElement("style");
  style.textContent = `
    [${PANE_ATTRIBUTE}] {
      order:-1;
      border-left-width:0 !important;
      border-right:1px solid var(--color-border, currentColor);
    }
    [${HANDLE_ATTRIBUTE}] {
      left:auto !important;
      right:0 !important;
      translate:50% 0 !important;
      transform:none !important;
    }
  `;
  document.head.append(style);
  const targets = new Map<HTMLElement, TreeTarget>();
  let cancelDrag: (() => void) | null = null;
  let frame = 0;

  const forget = (target: TreeTarget): void => {
    target.pane.removeAttribute(PANE_ATTRIBUTE);
    target.handle.removeAttribute(HANDLE_ATTRIBUTE);
    targets.delete(target.separator);
  };
  const sync = (): void => {
    frame = 0;
    for (const target of targets.values()) {
      if (!target.separator.isConnected || !nativeTreeTarget(target.separator)) {
        cancelDrag?.();
        forget(target);
      }
    }
    for (const separator of document.querySelectorAll<HTMLElement>(SEPARATOR_SELECTOR)) {
      if (targets.has(separator)) {
        continue;
      }
      const target = nativeTreeTarget(separator);
      if (target) {
        target.pane.setAttribute(PANE_ATTRIBUTE, "v1");
        target.handle.setAttribute(HANDLE_ATTRIBUTE, "v1");
        targets.set(separator, target);
      }
    }
  };

  // 只改变视觉顺序；原生节点、React Provider、文件状态和尺寸持久化仍由官方维护。
  const observer = new MutationObserver((records) => {
    const changed = records.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) =>
          node instanceof Element &&
          (node.matches(SEPARATOR_SELECTOR) || node.querySelector(SEPARATOR_SELECTOR)),
      ),
    );
    if (changed && !frame) {
      frame = ownerWindow.requestAnimationFrame(sync);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const pointerDown = (event: PointerEvent): void => {
    const separator =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(SEPARATOR_SELECTOR)
        : null;
    if (event.button !== 0 || !separator || !targets.has(separator)) {
      return;
    }
    const target = nativeTreeTarget(separator);
    if (!target) {
      return;
    }
    const startSize = target.resize.getCurrentSize();
    const cssWidth = Number.parseFloat(ownerWindow.getComputedStyle(target.pane).width);
    const zoom = target.pane.getBoundingClientRect().width / cssWidth;
    if (!Number.isFinite(startSize) || !Number.isFinite(zoom) || zoom <= 0) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelDrag?.();
    const startX = event.clientX;
    const pointerId = event.pointerId;
    separator.setPointerCapture(pointerId);
    const move = (next: PointerEvent): void => {
      if (next.pointerId !== pointerId) {
        return;
      }
      const current = separator.isConnected ? nativeTreeTarget(separator) : null;
      if (!current) {
        cancelDrag?.();
        return;
      }
      next.preventDefault();
      // 左侧文件树的右边界向右拖动时增宽，限制和折叠规则交给原生 setSize。
      current.resize.setSize(startSize + (next.clientX - startX) / zoom);
    };
    const end = (next: PointerEvent): void => {
      if (next.pointerId === pointerId) {
        cancelDrag?.();
      }
    };
    cancelDrag = () => {
      ownerWindow.removeEventListener("pointermove", move, true);
      ownerWindow.removeEventListener("pointerup", end, true);
      ownerWindow.removeEventListener("pointercancel", end, true);
      if (separator.hasPointerCapture(pointerId)) {
        separator.releasePointerCapture(pointerId);
      }
      cancelDrag = null;
    };
    ownerWindow.addEventListener("pointermove", move, true);
    ownerWindow.addEventListener("pointerup", end, true);
    ownerWindow.addEventListener("pointercancel", end, true);
  };
  ownerWindow.addEventListener("pointerdown", pointerDown, true);
  sync();
  return {
    dispose() {
      observer.disconnect();
      ownerWindow.cancelAnimationFrame(frame);
      ownerWindow.removeEventListener("pointerdown", pointerDown, true);
      cancelDrag?.();
      for (const target of targets.values()) {
        forget(target);
      }
      style.remove();
    },
  };
}
