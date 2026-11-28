import { describe, expect, it } from "vitest";
import {
  createRendererRequestSender,
  isMethodUnavailable,
  isUnsupportedMethod,
  RendererMethodUnavailableError,
} from "../src/renderer-request-sender.js";

describe("isMethodUnavailable", () => {
  it("treats the sender's own capability error as permanent", () => {
    const error = new RendererMethodUnavailableError("codexhost/settings/thread-folders/get", null);
    expect(isMethodUnavailable(error)).toBe(true);
  });

  it("treats a bare -32601 rejection as permanent", () => {
    expect(isMethodUnavailable(Object.assign(new Error("nope"), { code: -32601 }))).toBe(true);
  });

  it("keeps real failures retryable", () => {
    expect(isMethodUnavailable(new Error("socket hang up"))).toBe(false);
    expect(isMethodUnavailable(Object.assign(new Error("bad params"), { code: -32602 }))).toBe(
      false,
    );
    expect(isMethodUnavailable("boom")).toBe(false);
    expect(isMethodUnavailable(null)).toBe(false);
    expect(isMethodUnavailable(undefined)).toBe(false);
  });

  it("ignores the -32600 unknown-variant shape that isUnsupportedMethod accepts", () => {
    // -32600 只表示「本次请求写了未知方法」，可能是新旧版本协商问题；
    // 只有明确的 -32601 / 本连接缺能力才能当作永久缺失。
    const error = Object.assign(
      new Error("Invalid request: unknown variant `codexhost/settings/thread-folders/get`"),
      { code: -32600 },
    );
    expect(isUnsupportedMethod(error, "codexhost/settings/thread-folders/get")).toBe(true);
    expect(isMethodUnavailable(error)).toBe(false);
  });
});

describe("createRendererRequestSender capability memory", () => {
  it("remembers an absent method and stops probing the Host", async () => {
    let calls = 0;
    const sender = createRendererRequestSender(async (method) => {
      calls += 1;
      throw Object.assign(new Error("nope"), { code: -32601, method });
    });
    await expect(sender("codexhost/settings/thread-folders/get", {})).rejects.toBeInstanceOf(
      RendererMethodUnavailableError,
    );
    const first = calls;
    await expect(sender("codexhost/settings/thread-folders/get", {})).rejects.toBeInstanceOf(
      RendererMethodUnavailableError,
    );
    await expect(sender("codexhost/settings/thread-folders/get", {})).rejects.toBeInstanceOf(
      RendererMethodUnavailableError,
    );
    // 记住之后不再发第二轮请求：否则一个不支持的 Host 会被无限重试。
    expect(calls).toBe(first);
    expect(first).toBe(1);
  });

  it("still retries transient failures", async () => {
    let calls = 0;
    const sender = createRendererRequestSender(async () => {
      calls += 1;
      throw new Error("socket hang up");
    });
    await expect(sender("codexhost/settings/thread-folders/get", {})).rejects.toThrow(
      "socket hang up",
    );
    await expect(sender("codexhost/settings/thread-folders/get", {})).rejects.toThrow(
      "socket hang up",
    );
    expect(calls).toBe(2);
  });
});
