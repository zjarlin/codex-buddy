function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Codex app-server 只在会话确实不存在时返回这些错误；其它读取失败只表示暂时读不到。
const MISSING_THREAD =
  /no rollout found for thread id|thread not loaded|thread not found|invalid thread id/i;

export function isMissingNativeThreadError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return MISSING_THREAD.test(text);
}

// subagent 是主会话派生出的执行单元，不接受直接输入，也没有独立的“继续”语义；
// 它的失败属于父会话的过程细节，不能当作可恢复的普通会话列进中断队列。
// `canAcceptDirectInput` 是官方直接给出的同名判断，与其余字段一起作为冗余证据。
export function isSubagentNativeThread(thread: unknown): boolean {
  const value = isRecord(thread) ? thread : {};
  const source = isRecord(value.source) ? value.source : {};
  if (source.subAgent !== undefined && source.subAgent !== null) return true;
  if (value.threadSource === "subagent" || value.threadSource === "subAgentThreadSpawn")
    return true;
  if (value.canAcceptDirectInput === false) return true;
  if (typeof value.parentThreadId === "string" && value.parentThreadId.length > 0) return true;
  return typeof value.agentNickname === "string" && value.agentNickname.length > 0;
}

// 原生 `thread/read` 不返回归档标记，只把 rollout 移进 archived_sessions；
// 归档是用户已经处理过的终态，既不能恢复也不该继续留在队列里。
export function isArchivedNativeThread(thread: unknown): boolean {
  const value = isRecord(thread) ? thread : {};
  if (value.archived === true) return true;
  const path = typeof value.path === "string" ? value.path : "";
  return /(^|[\\/])archived_sessions([\\/]|$)/.test(path);
}

// 外部投影保留这两个标记；缺少 Host 方法不能作为原生会话归属的证据。
export function assertNativeCodexThread(
  thread: unknown,
  threadId: string,
): asserts thread is Record<string, unknown> {
  if (
    !isRecord(thread) ||
    thread.id !== threadId ||
    typeof thread.modelProvider !== "string" ||
    !thread.modelProvider ||
    thread.modelProvider === "codexhost" ||
    typeof thread.cliVersion !== "string" ||
    !thread.cliVersion ||
    thread.cliVersion === "codexhost"
  ) {
    throw new Error("Native Thread response cannot establish Codex ownership");
  }
}

// 在同一连接上读取原生元数据并核对归属。
export async function verifyNativeCodexThread(
  sendRequest: (method: string, params: unknown) => Promise<unknown> | unknown,
  threadId: string,
): Promise<void> {
  const native = await sendRequest("thread/read", { threadId, includeTurns: false });
  assertNativeCodexThread(isRecord(native) ? native.thread : null, threadId);
}
