import { SSH_GIT_METHOD, sshGitMethods, sshGitParamsSchema } from "@codexhost/shared-contracts";
import {
  createRendererRequestSender,
  RendererMethodUnavailableError,
  type RendererRequestOptions,
} from "./renderer-request-sender.js";

type Send = (method: string, params: unknown, options?: RendererRequestOptions) => unknown;

// 原生 SSH 没有扩展 Git RPC 时，只把 Git 操作交给本机 Host 的 SSH 执行器。
export function createRendererSshGitSender(input: {
  hostId: string;
  send: Send;
  sendLocal: Send;
  isCurrent(): boolean;
}): Send {
  const remote = createRendererRequestSender(input.send);
  const local = createRendererRequestSender(input.sendLocal);
  const methods = new Set<string>(sshGitMethods);
  const ensureCurrent = () => {
    if (!input.isCurrent()) throw new Error("SSH 连接已变化，请刷新后重试 Git 操作。");
  };
  return async (method, params, options) => {
    ensureCurrent();
    try {
      return await remote(method, params, options);
    } catch (error) {
      if (!(error instanceof RendererMethodUnavailableError) || !methods.has(method)) throw error;
    }
    ensureCurrent();
    if (!params || typeof params !== "object") throw new Error("Git 参数无效。");
    const { threadId, ...workspace } = params as Record<string, unknown>;
    if (typeof threadId === "string") {
      const result = await remote("thread/read", { threadId, includeTurns: false }, options);
      const thread = (result as { thread?: { cwd?: unknown } } | null)?.thread;
      workspace.cwd = thread?.cwd;
    }
    ensureCurrent();
    const request = sshGitParamsSchema.parse({ hostId: input.hostId, method, params: workspace });
    try {
      return await local(SSH_GIT_METHOD, request, options);
    } catch (error) {
      if (error instanceof RendererMethodUnavailableError) {
        throw new Error("本机版本未提供 SSH Git 通道，请更新 Codex Buddy 后重试。", {
          cause: error,
        });
      }
      throw error;
    }
  };
}
