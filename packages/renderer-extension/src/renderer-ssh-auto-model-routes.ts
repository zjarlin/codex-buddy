import {
  AUTO_MODEL_ROUTES_METHOD,
  SSH_AUTO_MODEL_ROUTES_METHOD,
  autoModelRoutesParamsSchema,
  sshAutoModelRoutesParamsSchema,
} from "@codexhost/shared-contracts";
import {
  createRendererRequestSender,
  RendererMethodUnavailableError,
  type RendererRequestOptions,
} from "./renderer-request-sender.js";

type Send = (method: string, params: unknown, options?: RendererRequestOptions) => unknown;

// 原生 SSH 缺少观察接口时，由本机 Host 经已保存的 SSH 连接在远端读取调度记录。
export function createRendererSshAutoModelRoutesSender(input: {
  hostId: string;
  send: Send;
  sendLocal: Send;
  isCurrent(): boolean;
}): Send {
  const remote = createRendererRequestSender(input.send);
  const local = createRendererRequestSender(input.sendLocal);
  const ensureCurrent = () => {
    if (!input.isCurrent()) throw new Error("SSH 连接已变化，请重新读取 Auto 路由记录。");
  };
  return async (method, params, options) => {
    ensureCurrent();
    try {
      return await remote(method, params, options);
    } catch (error) {
      if (!(error instanceof RendererMethodUnavailableError) || method !== AUTO_MODEL_ROUTES_METHOD)
        throw error;
    }
    ensureCurrent();
    const query = autoModelRoutesParamsSchema.parse(params);
    const result = (await remote(
      "thread/read",
      { threadId: query.threadId, includeTurns: false },
      options,
    )) as { thread?: { id?: unknown; modelProvider?: unknown; path?: unknown } } | null;
    ensureCurrent();
    const thread = result?.thread;
    if (thread?.id !== query.threadId) throw new Error("无法确认 Auto 路由记录所属的远程会话。");
    const request = sshAutoModelRoutesParamsSchema.parse({
      ...query,
      hostId: input.hostId,
      modelProvider: thread.modelProvider,
      rolloutPath: thread.path,
    });
    const response = await local(SSH_AUTO_MODEL_ROUTES_METHOD, request, options);
    ensureCurrent();
    return response;
  };
}
