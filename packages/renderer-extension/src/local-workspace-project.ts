import { GIT_ORIGIN_METHOD, gitOriginResultSchema } from "@codexhost/shared-contracts";
import { createRendererSshGitSender } from "./renderer-ssh-git.js";
import type { LocalWorkspaceContext } from "./local-workspace-context.js";

interface Manager {
  sendRequest(method: string, params: unknown, options?: unknown): unknown;
}
const CACHE_KEY = "codexhost.local-workspace-projects.v1";
type Project = { hostId: string; cwd: string; remote: string; capturedAt: number };

function read(storage: Pick<Storage, "getItem">): Project[] {
  const value: unknown = JSON.parse(storage.getItem(CACHE_KEY) ?? "[]");
  if (!Array.isArray(value)) throw new Error("Invalid project cache");
  return value.filter(
    (entry): entry is Project =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.hostId === "string" &&
      typeof entry.cwd === "string" &&
      typeof entry.remote === "string" &&
      typeof entry.capturedAt === "number",
  );
}

/** 离线打开旧聊天时，同项目后来保存的来源优先于该聊天的旧快照。 */
export function cachedLocalWorkspaceProject(
  storage: Pick<Storage, "getItem">,
  context: LocalWorkspaceContext,
): LocalWorkspaceContext {
  const project = read(storage).find(
    (entry) => entry.hostId === context.hostId && entry.cwd === context.cwd,
  );
  return project ? { ...context, remote: project.remote } : context;
}

/** 项目身份由主机和目录共同确定；成功读取为空会清除旧 origin，失败保留缓存。 */
export async function resolveLocalWorkspaceProject(input: {
  context: LocalWorkspaceContext;
  cwd: string;
  manager: Manager;
  local: Manager | null;
  isCurrent(): boolean;
  storage: Pick<Storage, "getItem" | "setItem">;
}): Promise<{ context: LocalWorkspaceContext; cached: boolean; warning: string }> {
  let warning = "";
  let entries: Project[] = [];
  try {
    entries = read(input.storage);
  } catch (error) {
    warning = String(error);
  }
  const previous = entries.find(
    (entry) => entry.hostId === input.context.hostId && entry.cwd === input.cwd,
  );
  let remote = previous?.remote ?? (input.cwd === input.context.cwd ? input.context.remote : "");
  let cached = true;
  const send = createRendererSshGitSender({
    hostId: input.context.hostId,
    send: (method, params, options) => input.manager.sendRequest(method, params, options),
    sendLocal: (method, params, options) => {
      if (!input.local) throw new Error("Local Host unavailable");
      return input.local.sendRequest(method, params, options);
    },
    isCurrent: input.isCurrent,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      Promise.resolve(
        send(GIT_ORIGIN_METHOD, { cwd: input.cwd }, { priority: "background", timeoutMs: 8000 }),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Git origin read timed out")), 8000);
      }),
    ]);
    if (!input.isCurrent()) throw new Error("Connection changed");
    remote = gitOriginResultSchema.parse(response).remote ?? "";
    cached = false;
  } catch {
    // 离线时只能使用已知的项目来源，不猜测同名仓库。
  } finally {
    clearTimeout(timer);
  }
  if (!input.isCurrent()) throw new Error("Connection changed");
  if (!cached || remote) {
    const project = {
      hostId: input.context.hostId,
      cwd: input.cwd,
      remote,
      capturedAt: cached ? (previous?.capturedAt ?? input.context.capturedAt) : Date.now(),
    };
    try {
      // 其它聊天可能在等待网络期间写入项目，落盘前重新合并。
      entries = read(input.storage);
      input.storage.setItem(
        CACHE_KEY,
        JSON.stringify(
          [
            project,
            ...entries.filter(
              (entry) => entry.hostId !== project.hostId || entry.cwd !== project.cwd,
            ),
          ].slice(0, 64),
        ),
      );
    } catch (error) {
      warning = String(error);
    }
  }
  return { context: { ...input.context, cwd: input.cwd, remote }, cached, warning };
}
