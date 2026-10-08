import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

interface NativeScope {
  value: { routeKind: "local-thread"; conversationId: string };
  get: (...args: unknown[]) => unknown;
  set: (...args: unknown[]) => unknown;
}

interface ReviewRoute {
  kind: "review";
  payloadVersion: 1;
  params: {
    conversationId: string;
    hostId: string;
    cwd: string;
    repositoryRoot?: string | null;
    diffFilter: string;
  };
}

interface NativeReviewTab {
  tabId: string;
  durableRoute: ReviewRoute;
  tabType: {
    kind: "review";
    durableRoute: {
      restore(input: {
        scope: NativeScope;
        descriptor: ReviewRoute & { tabId: string };
        target: "right";
        revealAndFocus: true;
      }): boolean | Promise<boolean>;
    };
  };
}

export interface NativeGitReviewRequest {
  threadId: string;
  hostId: string;
  cwd?: string;
  repository?: string;
  path: string;
  staged: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// 使用官方命令入口，保持原生面板、Provider 和文件读取链路的所有权。
export function runNativeWorkspaceCommand(
  document: Document,
  id: "openReviewTab" | "toggleFileTreePanel",
): void {
  const ownerWindow = document.defaultView;
  if (!ownerWindow) {
    throw new Error("官方工作区窗口不可用。");
  }
  ownerWindow.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "run-command", id },
      source: ownerWindow,
      origin: ownerWindow.location.origin,
    }),
  );
}

function reviewTab(value: unknown, request: NativeGitReviewRequest): NativeReviewTab | null {
  const tab = record(value);
  const type = record(tab?.tabType);
  const route = record(tab?.durableRoute);
  const params = record(route?.params);
  if (
    typeof tab?.tabId !== "string" ||
    type?.kind !== "review" ||
    typeof record(type.durableRoute)?.restore !== "function" ||
    route?.kind !== "review" ||
    route.payloadVersion !== 1 ||
    params?.conversationId !== request.threadId ||
    params.hostId !== request.hostId ||
    typeof params.cwd !== "string" ||
    !params.cwd
  ) {
    return null;
  }
  return tab as unknown as NativeReviewTab;
}

function threadScope(value: unknown, threadId: string): NativeScope | null {
  const scope = record(value);
  const route = record(scope?.value);
  return route?.routeKind === "local-thread" &&
    route.conversationId === threadId &&
    typeof scope?.get === "function" &&
    typeof scope.set === "function"
    ? (scope as unknown as NativeScope)
    : null;
}

// 只读取已提交的原生标签祖先；不缓存私有组件、混淆导出名或其他会话的 Scope。
function nativeReviewTarget(document: Document, request: NativeGitReviewRequest) {
  for (const element of document.querySelectorAll<HTMLElement>('[role="tab"]')) {
    if (element.getClientRects().length === 0) {
      continue;
    }
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
    if (!key) {
      continue;
    }
    let tab: NativeReviewTab | null = null;
    let scope: NativeScope | null = null;
    for (const fiber of committedReactAncestors(Reflect.get(element, key))) {
      const props = record(fiber.memoizedProps);
      tab ??= reviewTab(props?.tab, request);
      scope ??= threadScope(props?.scope, request.threadId);
      scope ??= threadScope(props?.value, request.threadId);
      const seen = new Set<unknown>();
      for (
        let context = record(record(fiber.dependencies)?.firstContext);
        context && seen.size < 32 && !seen.has(context);
        context = record(context.next)
      ) {
        seen.add(context);
        scope ??= threadScope(context.memoizedValue, request.threadId);
      }
    }
    if (tab && scope) {
      return { tab, scope };
    }
  }
  return null;
}

async function waitFor<T>(
  document: Document,
  read: () => T | null,
  isCurrent: () => boolean,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (isCurrent()) {
    const value = read();
    if (value !== null) {
      return value;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await new Promise<void>((resolve) => document.defaultView?.setTimeout(resolve, 50));
  }
  return null;
}

function revealReviewPath(document: Document, path: string): boolean {
  for (const element of document.querySelectorAll<HTMLElement>("[data-review-path]")) {
    if (element.getAttribute("data-review-path") === path) {
      element.scrollIntoView({ block: "start" });
      return true;
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>("button[data-item-path]")) {
    if (element.getAttribute("data-item-path") === path) {
      element.click();
      return true;
    }
  }
  return false;
}

export async function openNativeGitReview(
  document: Document,
  request: NativeGitReviewRequest,
  isCurrent: () => boolean,
): Promise<"opened" | "path-unavailable" | "cancelled"> {
  if (!isCurrent()) {
    return "cancelled";
  }
  runNativeWorkspaceCommand(document, "openReviewTab");
  const target = await waitFor(
    document,
    () => nativeReviewTarget(document, request),
    isCurrent,
    3000,
  );
  if (!isCurrent()) {
    return "cancelled";
  }
  if (!target) {
    throw new Error("未能打开当前会话的官方审查面板，请使用顶部审查入口。");
  }
  const diffFilter = request.staged ? "staged" : "uncommitted";
  const descriptor = {
    ...target.tab.durableRoute,
    tabId: target.tab.tabId,
    params: {
      conversationId: request.threadId,
      hostId: request.hostId,
      cwd: request.cwd ?? target.tab.durableRoute.params.cwd,
      repositoryRoot: request.repository ?? null,
      diffFilter,
    },
  };
  const restored = await target.tab.tabType.durableRoute.restore({
    scope: target.scope,
    descriptor,
    target: "right",
    revealAndFocus: true,
  });
  if (!isCurrent()) {
    return "cancelled";
  }
  if (!restored) {
    throw new Error("官方审查未接受当前仓库或比较范围。");
  }
  const updated = await waitFor(
    document,
    () => {
      const next = nativeReviewTarget(document, request);
      const params = next?.tab.durableRoute.params;
      return params?.diffFilter === diffFilter &&
        params.cwd === descriptor.params.cwd &&
        (params.repositoryRoot ?? null) === (request.repository ?? null)
        ? next
        : null;
    },
    isCurrent,
    1500,
  );
  if (!isCurrent()) {
    return "cancelled";
  }
  if (!updated) {
    throw new Error("官方审查无法显示所选仓库或比较范围，请在官方面板中选择仓库。");
  }
  if (!request.path) {
    return "opened";
  }
  const revealed = await waitFor(
    document,
    () => (revealReviewPath(document, request.path) ? true : null),
    isCurrent,
    1000,
  );
  if (!isCurrent()) {
    return "cancelled";
  }
  return revealed ? "opened" : "path-unavailable";
}
