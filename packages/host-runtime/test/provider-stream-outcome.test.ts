import { describe, expect, it } from "vitest";
import { createResponsesStreamObserver } from "../src/provider-routing/stream-outcome.js";

function observer() {
  const value = createResponsesStreamObserver({
    "content-type": "text/event-stream; charset=utf-8",
  });
  if (!value) {
    throw new Error("Missing observer");
  }
  return value;
}

function event(type: string, extra: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`;
}

describe("Responses stream outcome observation", () => {
  it.each(["application/json", "text/plain", undefined])(
    "does not inspect non-SSE content (%s)",
    (contentType) => {
      expect(createResponsesStreamObserver({ "content-type": contentType })).toBeNull();
    },
  );

  it.each(["gzip", "br", "zstd", "deflate"])("does not inspect %s bytes", (encoding) => {
    expect(
      createResponsesStreamObserver({
        "content-type": "text/event-stream",
        "content-encoding": encoding,
      }),
    ).toBeNull();
  });

  it("accepts media type parameters and identity encoding case insensitively", () => {
    expect(
      createResponsesStreamObserver({
        "content-type": "Text/Event-Stream; charset=utf-8",
        "content-encoding": "Identity",
      }),
    ).not.toBeNull();
  });

  it.each(["response.completed", "response.incomplete"])(
    "accepts %s across every byte boundary without changing the input",
    (type) => {
      const stream = observer();
      const input = Buffer.from(
        ": heartbeat\r\n\r\n" +
          event(type, { response: { output: "你好" } }).replaceAll("\n", "\r\n"),
      );
      const original = Buffer.from(input);
      for (const byte of input) {
        stream.write(Uint8Array.of(byte));
      }
      expect(stream.end()).toBeNull();
      expect(input).toEqual(original);
    },
  );

  it.each([
    ["server_error", 500, true],
    ["rate_limit_exceeded", 429, true],
    ["invalid_api_key", 401, false],
    ["permission_denied", 403, false],
    ["invalid_request_error", 400, false],
    ["context_length_exceeded", 400, false],
  ])("classifies response.failed code %s", (code, status, retryable) => {
    const stream = observer();
    stream.write(Buffer.from(event("response.failed", { response: { error: { code } } })));
    expect(stream.end()).toEqual({ kind: "http", status, retryable });
  });

  it.each([
    { type: "error", code: "server_error" },
    { type: "error", error: { type: "server_error" } },
  ])("recognizes data-only error events %j", (error) => {
    const stream = observer();
    stream.write(Buffer.from(`data: ${JSON.stringify(error)}\n\n`));
    expect(stream.end()).toEqual({ kind: "http", status: 500, retryable: true });
  });

  it("does not classify arbitrary error messages as transient", () => {
    const stream = observer();
    stream.write(Buffer.from(event("error", { message: "server_error and an upstream secret" })));
    expect(stream.end()).toEqual({ kind: "stream", retryable: false });
  });

  it.each(["constructor", "toString", "__proto__"])(
    "does not treat inherited object properties as error codes: %s",
    (code) => {
      const stream = observer();
      stream.write(Buffer.from(event("error", { code })));
      expect(stream.end()).toEqual({ kind: "stream", retryable: false });
    },
  );

  it.each([
    "",
    ": heartbeat\n\n",
    event("response.created"),
    "data: [DONE]\n\n",
    'event: response.completed\ndata: {"type":"response.completed"}',
    "event: response.completed\ndata: invalid json\n\n",
    "event: response.completed\ndata: null\n\n",
    "event: response.completed\ndata: []\n\n",
  ])("detects an ended stream without a valid terminal event: %j", (body) => {
    const stream = observer();
    stream.write(Buffer.from(body));
    expect(stream.end()).toEqual({ kind: "stream", retryable: true });
  });

  it("handles multiline data and CR-only event separators", () => {
    const stream = observer();
    stream.write(Buffer.from('data: {"type":"error",\rdata: "code":"rate_limit_exceeded"}\r\r'));
    expect(stream.end()).toEqual({ kind: "http", status: 429, retryable: true });
  });

  it.each([true, false])(
    "recognizes a large terminal event with explicit event name %s",
    (named) => {
      const stream = observer();
      const body = event("response.completed", { response: { output: "x".repeat(1024 * 1024) } });
      stream.write(Buffer.from(named ? body : body.slice(body.indexOf("data:"))));
      expect(stream.end()).toBeNull();
    },
  );

  it("recovers event boundaries after an oversized nonterminal event", () => {
    const stream = observer();
    const body = event("response.output_text.delta", { delta: "x".repeat(128 * 1024) });
    for (let offset = 0; offset < body.length; offset += 1024) {
      stream.write(Buffer.from(body.slice(offset, offset + 1024)));
    }
    stream.write(Buffer.from(event("response.completed")));
    expect(stream.end()).toBeNull();
  });

  it("keeps the first failure even if a completed event follows", () => {
    const stream = observer();
    stream.write(
      Buffer.from(event("error", { code: "server_error" }) + event("response.completed")),
    );
    expect(stream.end()).toEqual({ kind: "http", status: 500, retryable: true });
    expect(stream.end()).toEqual({ kind: "http", status: 500, retryable: true });
  });
});
