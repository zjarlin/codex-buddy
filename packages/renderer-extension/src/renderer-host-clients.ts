import type {
  RendererHostRoute,
  RendererHostRouting,
} from "@codexhost/desktop-control/renderer-bindings";
import { AUTO_MODEL_ROUTES_METHOD, sshGitMethods } from "@codexhost/shared-contracts";
import { createRendererModelClient, type RendererModelClient } from "./renderer-model-client.js";
import { installRendererExternalQueue } from "./renderer-external-queue.js";
import { installRendererExternalSteering } from "./renderer-external-steering.js";
import type { RendererRequestOptions } from "./renderer-request-sender.js";
import { createRendererSshGitSender } from "./renderer-ssh-git.js";
import { createRendererSshAutoModelRoutesSender } from "./renderer-ssh-auto-model-routes.js";
import { installRendererThreadArchive } from "./renderer-thread-archive.js";

/** Model clients follow native connection identities, never the active Composer.
 * A captured client may finish an in-flight request after replacement, but may
 * not dispatch another request through a retired manager. */
export function createRendererHostClients(readRouting: () => RendererHostRouting | undefined) {
  let disposed = false;
  const entries = new Map<
    string,
    {
      route: RendererHostRoute;
      client: RendererModelClient;
      cleanups: (() => void)[];
    }
  >();
  const retire = (hostId: string): void => {
    const entry = entries.get(hostId);
    entries.delete(hostId);
    for (const cleanup of entry?.cleanups ?? []) {
      try {
        cleanup();
      } catch {
        /* Release the remaining hooks too. */
      }
    }
  };
  const forRoute = (route: RendererHostRoute | null): RendererModelClient | null => {
    if (disposed || !route) return null;
    const cached = entries.get(route.hostId);
    if (cached?.route === route) return cached.client;
    retire(route.hostId);
    const target = route.manager;
    const isCurrent = () => !disposed && readRouting()?.forHost(route.hostId) === route;
    const sendRequest = (method: string, params: unknown, options?: RendererRequestOptions) => {
      if (!isCurrent())
        throw new Error(`Renderer request manager is unavailable for Host ${route.hostId}`);
      return options === undefined
        ? target.sendRequest(method, params)
        : target.sendRequest(method, params, options);
    };
    let send = sendRequest;
    if (route.hostId !== "local" && !route.hostId.startsWith("remote-control:")) {
      const ssh = {
        hostId: route.hostId,
        isCurrent,
        sendLocal(method: string, params: unknown, options?: RendererRequestOptions) {
          const local = readRouting()?.forHost("local")?.manager;
          if (!local) throw new Error("本机 SSH 执行服务不可用，请重新连接。");
          return options === undefined
            ? local.sendRequest(method, params)
            : local.sendRequest(method, params, options);
        },
      };
      const git = createRendererSshGitSender({ ...ssh, send: sendRequest });
      const auto = createRendererSshAutoModelRoutesSender({ ...ssh, send: sendRequest });
      const gitMethods = new Set<string>(sshGitMethods);
      send = (method, params, options) => {
        if (method === AUTO_MODEL_ROUTES_METHOD) return auto(method, params, options);
        if (gitMethods.has(method)) return git(method, params, options);
        return sendRequest(method, params, options);
      };
    }
    const client = createRendererModelClient([
      {
        sendRequest: (method, params, options) =>
          send(method, params, options as RendererRequestOptions | undefined),
        ...(target.addNotificationCallback
          ? { addNotificationCallback: target.addNotificationCallback.bind(target) }
          : {}),
      },
    ]);
    if (!client) return null;
    const cleanups: (() => void)[] = [];
    entries.set(route.hostId, { route, client, cleanups });
    try {
      for (const install of [
        installRendererExternalQueue,
        installRendererExternalSteering,
        installRendererThreadArchive,
      ]) {
        const cleanup = install(target);
        if (cleanup) cleanups.push(cleanup);
      }
    } catch (error) {
      retire(route.hostId);
      throw error;
    }
    return client;
  };
  return {
    forRoute,
    forHost(hostId: string): RendererModelClient | null {
      if (disposed) return null;
      const route = readRouting()?.forHost(hostId) ?? null;
      if (!route) retire(hostId);
      return forRoute(route);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const hostId of entries.keys()) retire(hostId);
    },
  };
}
