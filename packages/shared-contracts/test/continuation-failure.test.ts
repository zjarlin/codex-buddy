import { describe, expect, it } from "vitest";
import { isUndecryptableHistoryError } from "../src/continuation-failure.js";

describe("undecryptable history detection", () => {
  it.each([
    "stream disconnected before completion: Encrypted function output content could not be decrypted or decoded.",
    "encrypted reasoning content belongs to another upstream account",
    "encrypted_reasoning_content could not be processed",
    "upstream could not be decrypted or parsed",
    "the server could not fully decrypt the conversation",
    "cannot decrypt the encrypted reasoning items in this request",
    "failed to decrypt encrypted tool output",
    "decryption failed for the conversation history",
  ])("recognises a request that replays undecryptable history: %s", (message) => {
    expect(isUndecryptableHistoryError({ message })).toBe(true);
    expect(isUndecryptableHistoryError(message)).toBe(true);
  });

  it.each([
    "upstream error: 524 (failover)",
    "HTTP 429 Too Many Requests",
    "invalid_string: input[9].name does not match pattern",
    "context_length_exceeded",
    null,
    undefined,
    {},
    { message: "" },
    { message: "connection reset by peer", error: { message: "HTTP 502" } },
  ])("leaves other failures to their own handling: %j", (error) => {
    expect(isUndecryptableHistoryError(error)).toBe(false);
  });

  it("reads wrapped gateway errors without joining their text", () => {
    expect(
      isUndecryptableHistoryError({
        message: "",
        error: {
          message:
            "stream disconnected before completion: Encrypted function output content could not be decrypted or decoded.",
        },
      }),
    ).toBe(true);
    // 外层摘要与内层原因同时存在时，任一层说明历史无法解密都要命中。
    expect(
      isUndecryptableHistoryError({
        message: "upstream 500",
        error: { message: "unable to decrypt encrypted reasoning items" },
      }),
    ).toBe(true);
    expect(
      isUndecryptableHistoryError({ error: { message: "unable to decrypt request payload" } }),
    ).toBe(true);
    // 只有明确描述“历史内容无法解密”的错误才算；普通 401/429 不能因为带 error 字段就命中。
    expect(isUndecryptableHistoryError({ error: { message: "unauthorized" } })).toBe(false);
  });
});
