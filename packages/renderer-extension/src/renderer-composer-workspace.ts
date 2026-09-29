import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function workspaceFromProps(props: Record<string, unknown>, hostId: string): string | undefined {
  if (
    (props.composerMode !== "local" && props.composerMode !== "worktree") ||
    typeof props.setComposerMode !== "function"
  ) {
    return undefined;
  }
  // Desktop 26.924 的运行位置菜单将当前远程草稿选择单独传入，不等于最近预热目录。
  const remote = record(props.remoteSelectionState);
  const selection = record(remote?.draftNewThreadRemoteSelectionState);
  if (remote?.isAttachedToStartedTask === false && hostId !== "local") {
    return selection?.hostId === hostId && typeof selection.projectPath === "string"
      ? selection.projectPath || undefined
      : undefined;
  }
  const target = record(props.executionTargetOverride) ?? record(props.localRemoteExecutionTarget);
  return target?.hostId === hostId && typeof target.cwd === "string"
    ? target.cwd || undefined
    : undefined;
}

/** 从当前输入框的原生运行位置控件读取目录；不借用 Host 预热缓存或侧栏高亮。 */
export function composerDraftWorkspace(composer: Element, hostId: string): string | undefined {
  const paths = new Set<string>();
  const visited = new Set<unknown>();
  for (const element of composer.querySelectorAll("button")) {
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
    const ancestors = key ? committedReactAncestors(Reflect.get(element, key)) : [];
    for (const fiber of ancestors) {
      if (visited.has(fiber)) {
        break;
      }
      visited.add(fiber);
      const props = record(fiber.memoizedProps);
      const cwd = props ? workspaceFromProps(props, hostId) : undefined;
      if (cwd) {
        paths.add(cwd);
      }
      // 输入框外的页面祖先可能仍持有其他项目或后台会话的状态。
      if (fiber.stateNode === composer) {
        break;
      }
    }
  }
  return paths.size === 1 ? paths.values().next().value : undefined;
}
