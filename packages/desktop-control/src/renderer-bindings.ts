import { committedReactAncestors } from "./renderer-react-ownership.js";
import { retainRendererHostResponses } from "./renderer-host-response-ownership.js";
import { buddyTurnStartOptions } from "./buddy-turn-start-policy.js";
import {
  createDraftPrewarmPolicyBridge,
  type DraftPrewarmPolicyTarget,
} from "./renderer-draft-prewarm-runtime.js";
import {
  discoverRendererHosts,
  requestManagerFromHookState,
  resolveRendererHostManager,
  type RendererHostRoot,
} from "./renderer-host-discovery.js";
import { installRendererHostRouting, type RendererHostRouting } from "./renderer-host-routing.js";

// 注入扩展和网页 Renderer 共用的浏览器入口，不依赖 Electron 或 Inspector。
export { committedReactAncestors } from "./renderer-react-ownership.js";
export type { RendererHostRoute, RendererHostRouting } from "./renderer-host-routing.js";
export { recentCompletedSessions, type RecentSessionsRequest } from "./recent-sessions.js";

// 复用原生连接的发现、响应归属和草稿策略；已有 Controller 路由保持同一实例。
export function installRendererWindowHostRouting(
  root: RendererHostRoot,
  target: object,
): RendererHostRouting {
  return installRendererHostRouting(
    root,
    target as DraftPrewarmPolicyTarget,
    (root) => discoverRendererHosts(root, committedReactAncestors, requestManagerFromHookState),
    (discovery, hostId) =>
      resolveRendererHostManager(discovery, hostId, requestManagerFromHookState),
    (manager, bridge, hostId, target, prewarmed, isCurrent) =>
      createDraftPrewarmPolicyBridge(
        manager,
        bridge,
        hostId,
        target,
        prewarmed,
        isCurrent,
        retainRendererHostResponses,
        buddyTurnStartOptions,
      ),
  );
}
