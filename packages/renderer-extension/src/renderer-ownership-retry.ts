import { RendererMethodUnavailableError } from "./renderer-request-sender.js";

const RETRY_DELAYS_MS = [500, 1_000, 2_000] as const;

export function ownershipFailureKind(error: unknown): "invalid" | "unavailable" | "transient" {
  if (error instanceof RendererMethodUnavailableError) {
    return "unavailable";
  }
  const record = typeof error === "object" && error !== null ? error : {};
  const code = "code" in record ? record.code : undefined;
  const name = "name" in record ? record.name : undefined;
  const message = "message" in record && typeof record.message === "string" ? record.message : "";
  if (code === -32601) {
    return "unavailable";
  }
  if (
    code === -32600 ||
    code === -32602 ||
    name === "ZodError" ||
    /invalid.*(?:thread|inspection|params)|cannot establish Codex ownership|Thread owner could not be applied|did not include configuration/i.test(
      message,
    )
  ) {
    return "invalid";
  }
  return "transient";
}

// 每个挂载实例独立限次；请求上下文由调用方在定时器执行前再次核对。
export function createOwnershipRetry<T extends object>(
  timers: Pick<Window, "setTimeout" | "clearTimeout">,
) {
  const pending = new Map<T, number>();
  const attempts = new WeakMap<T, number>();
  let disposed = false;
  const clear = (key: T): void => {
    const timer = pending.get(key);
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      pending.delete(key);
    }
    attempts.delete(key);
  };
  return {
    clear,
    schedule(key: T, isCurrent: () => boolean, retry: () => void): boolean {
      if (disposed || pending.has(key)) {
        return false;
      }
      const attempt = attempts.get(key) ?? 0;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        return false;
      }
      attempts.set(key, attempt + 1);
      const timer = timers.setTimeout(() => {
        pending.delete(key);
        if (!disposed && isCurrent()) {
          retry();
        } else {
          clear(key);
        }
      }, delay);
      pending.set(key, timer);
      return true;
    },
    dispose(): void {
      disposed = true;
      for (const key of pending.keys()) {
        clear(key);
      }
    },
  };
}
