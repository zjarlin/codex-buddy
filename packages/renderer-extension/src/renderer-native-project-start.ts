import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * 读取项目自身的新建会话入口。Desktop 在项目行内提供 “+” 按钮，其 Fiber 上的
 * `group`、`canStartNewThread` 与 `onStartNewThread` 共同声明该入口；调用它由
 * Desktop 决定项目、Host、草稿配置与导航，扩展不自行拼装 `thread/start`。
 */
export function nativeProjectStart(scope: HTMLElement, projectId: string): (() => void) | null {
  for (const element of scope.querySelectorAll<HTMLElement>("button")) {
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
    const ancestors = key ? committedReactAncestors(Reflect.get(element, key)) : [];
    const props = ancestors
      .map((fiber) => record(fiber.memoizedProps))
      .find(
        (props) =>
          record(props?.group)?.projectId === projectId &&
          props?.canStartNewThread === true &&
          typeof props.onStartNewThread === "function",
      );
    if (typeof props?.onStartNewThread === "function") {
      return props.onStartNewThread as () => void;
    }
  }
  return null;
}
