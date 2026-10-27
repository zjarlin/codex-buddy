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
