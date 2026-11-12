/**
 * 服务端解不开历史里的加密推理或工具输出时，同一份历史无论重发还是换模型都会
 * 再次失败；这类失败只由用户用原生压缩或新会话处理。Host 自动续接与 Desktop
 * 中断队列必须用同一判断，否则两边会互相把失败的回合重新拉起。
 *
 * 这里只判断“历史内容无法解密”。请求参数校验、权限和上下文超限各有独立的
 * 处理路径，不在此合并。
 */
const UNDECRYPTABLE_HISTORY =
  /encrypted[_ -]?(?:function|reasoning|tool)[\w -]*content|encrypted function output|could not be decrypt(?:ed)?|cannot decrypt|failed to decrypt|decryption (?:failed|error)|fully decrypt the conversation|unable to decrypt|encrypted reasoning.{0,40}(?:another|different) (?:account|upstream)|无法解密|解密失败/iu;

// 原生回合错误通常是 `{ message }`；网关转述时可能包成 `{ error: { message } }`
// 或只填 `reason` / `detail`。逐个字段检查，不把几段无关文本拼在一起判断。
function errorTexts(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (value === null || typeof value !== "object" || depth > 2) return [];
  const record = value as {
    message?: unknown;
    reason?: unknown;
    detail?: unknown;
    error?: unknown;
  };
  return [record.message, record.reason, record.detail, record.error].flatMap((field) =>
    errorTexts(field, depth + 1),
  );
}

export function isUndecryptableHistoryError(value: unknown): boolean {
  return errorTexts(value).some((text) => UNDECRYPTABLE_HISTORY.test(text));
}
