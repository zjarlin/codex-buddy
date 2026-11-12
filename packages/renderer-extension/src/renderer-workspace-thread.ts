import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import { restoreRemoteProject } from "./renderer-remote-project-restore.js";

type Request = (method: string, params: unknown) => Promise<unknown>;

// 原生 Thread 创建后登记项目归属，确保新会话能进入 Desktop 的项目列表。
export async function createWorkspaceThread(request: Request, cwd: string): Promise<string> {
  const response = await request("thread/start", {
    cwd,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  });
  const thread: unknown =
    response && typeof response === "object" ? Reflect.get(response, "thread") : null;
  const id = hostThreadIdSchema.safeParse(
    thread && typeof thread === "object" ? Reflect.get(thread, "id") : null,
  );
  if (!id.success) throw new Error("创建会话未返回有效的会话 ID，请检查会话列表后再重试。");
  if (!thread || typeof thread !== "object" || Reflect.get(thread, "cwd") !== cwd) {
    throw new Error(`会话 ${id.data} 的工作目录与冲突仓库不一致，未发送解决任务。`);
  }
  try {
    await restoreRemoteProject(request, {
      key: id.data.replaceAll("-", "").slice(0, 16),
      name: cwd.split(/[/\\]/u).filter(Boolean).at(-1) ?? cwd,
      roots: [cwd],
      threads: [{ id: id.data, name: "", updatedAt: Date.now() }],
    });
  } catch (error) {
    throw new Error(
      `会话 ${id.data} 已创建，但项目登记失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return id.data;
}
