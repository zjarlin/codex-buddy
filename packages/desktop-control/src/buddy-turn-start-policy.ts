// 此函数会序列化注入 Renderer，必须保持自包含；只调整原生请求的等待时限。
export function buddyTurnStartOptions(
  hostId: string,
  method: string,
  parameters: unknown,
  options: unknown,
): unknown {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (
    hostId !== "local" ||
    method !== "turn/start" ||
    !isRecord(parameters) ||
    !Array.isArray(parameters.input) ||
    parameters.input.length === 0 ||
    parameters.outputSchema != null ||
    parameters.toolOutput != null ||
    (typeof parameters.model === "string" && parameters.model.startsWith("codexhost/")) ||
    !isRecord(options) ||
    typeof options.timeoutMs !== "number" ||
    options.timeoutMs <= 0 ||
    options.timeoutMs >= 240_000
  ) {
    return options;
  }
  // Host 的只读规划最多三分钟，另留一分钟给模型发现、清理和执行确认。
  return { ...options, timeoutMs: 240_000 };
}
