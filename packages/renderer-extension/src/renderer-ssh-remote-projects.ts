import {
  REMOTE_PROJECTS_SYNC_METHOD,
  remoteProjectsInspectParamsSchema,
  remoteProjectsSnapshotSchema,
  remoteProjectsSyncParamsSchema,
  type RemoteProjectsSnapshot,
} from "@codexhost/shared-contracts";
import { type RendererRequestOptions } from "./renderer-request-sender.js";

type Send = (method: string, params: unknown, options?: RendererRequestOptions) => unknown;

// 原生 SSH 没有共享项目接口时，由本机 Host 经已保存连接读取远端 Codex 元数据。
export function createRendererSshRemoteProjectsSender(input: {
  hostId: string;
  /** Reserved for signature parity; shared-project discovery always uses sendLocal. */
  send: Send;
  sendLocal: Send;
  isCurrent(): boolean;
}): Send {
  const ensureCurrent = () => {
    if (!input.isCurrent()) throw new Error("SSH 连接已变化，请重新读取共享项目。");
  };
  return async (method, params, options): Promise<RemoteProjectsSnapshot> => {
    ensureCurrent();
    const request =
      method === REMOTE_PROJECTS_SYNC_METHOD
        ? remoteProjectsSyncParamsSchema.parse({
            ...(params && typeof params === "object" ? params : {}),
            hostId: input.hostId,
          })
        : remoteProjectsInspectParamsSchema.parse({ hostId: input.hostId });
    const result = remoteProjectsSnapshotSchema.parse(
      await input.sendLocal(method, request, options),
    );
    ensureCurrent();
    return result;
  };
}
