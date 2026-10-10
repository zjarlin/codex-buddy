import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BuddyTranslator } from "../../src/buddy/translator.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((clean) => clean()));
});

async function fixture(respond: (body: Record<string, unknown>, res: ServerResponse) => void) {
  const requests: Record<string, unknown>[] = [];
  const instance = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as Record<string, unknown>;
      requests.push(body);
      respond(body, res);
    });
  });
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("fixture address missing");
  const home = await mkdtemp(join(tmpdir(), "buddy-translator-test-"));
  await writeFile(join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "fixture-key" }), {
    mode: 0o600,
  });
  await writeFile(
    join(home, "config.toml"),
    `model_provider = "gateway"\n[model_providers.gateway]\nbase_url = ${JSON.stringify(`http://127.0.0.1:${address.port}/v1`)}\nrequires_openai_auth = true\n`,
  );
  cleanups.push(async () => {
    instance.closeAllConnections();
    await new Promise<void>((resolve) => instance.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });
  return { translator: new BuddyTranslator({ CODEX_HOME: home }), requests };
}

describe("gateway translation", () => {
  it("keeps messages with a shared prefix separate in the translation cache", async () => {
    const f = await fixture((body, res) => {
      const text = (body.q as string[])[0];
      res.end(JSON.stringify({ translations: [{ text }], provider: "baidu" }));
    });
    const prefix = "Let me inspect the server capacity. ".repeat(20);
    const first = { text: `${prefix}First result.`, targetLocale: "zh-CN" };
    const second = { text: `${prefix}Updated result.`, targetLocale: "zh-CN" };

    expect((await f.translator.translate(first)).translated).toBe(first.text);
    expect((await f.translator.translate(second)).translated).toBe(second.text);
    await f.translator.translate(second);
    expect(f.requests).toHaveLength(2);
  });

  it("reads the Sub2API {code,message,data} envelope", async () => {
    const f = await fixture((_body, res) => {
      res.end(
        JSON.stringify({
          code: 0,
          message: "success",
          data: { translations: [{ text: "Session completed" }], provider: "baidu" },
        }),
      );
    });

    const result = await f.translator.translate({ text: "会话已完成", targetLocale: "en" });

    expect(result.translated).toBe("Session completed");
    expect(result.model).toBe("sub2api:baidu");
    expect(f.requests[0]).not.toHaveProperty("provider");
    expect(f.requests[0]).toMatchObject({ q: ["会话已完成"], source: "zh-CN", target: "en" });
  });

  it("still accepts an unwrapped payload and rejects a response without a translation", async () => {
    const f = await fixture((body, res) => {
      res.end(
        body.q && Array.isArray(body.q) && body.q[0] === "裸响应"
          ? JSON.stringify({ translations: [{ text: "Bare" }], provider: "youdao" })
          : JSON.stringify({ code: 0, message: "success", data: { provider: "baidu" } }),
      );
    });

    await expect(
      f.translator.translate({ text: "裸响应", targetLocale: "en" }),
    ).resolves.toMatchObject({ translated: "Bare", model: "sub2api:youdao" });
    await expect(f.translator.translate({ text: "无结果", targetLocale: "en" })).rejects.toThrow(
      "翻译服务未返回结果",
    );
  });

  it.each([
    [500, { message: "所有翻译服务均不可用" }],
    [503, { error: { message: "Provider temporarily unavailable" } }],
    [429, { error: "Translation quota exceeded" }],
  ])("reports HTTP %i with the gateway reason and request ID", async (status, payload) => {
    const f = await fixture((_body, res) => {
      res.writeHead(status, { "x-request-id": "translation-fixture-123" });
      res.end(JSON.stringify(payload));
    });
    const reason =
      "message" in payload
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : payload.error.message;

    await expect(
      f.translator.translate({ text: "Please translate this message.", targetLocale: "zh-CN" }),
    ).rejects.toThrow(`翻译服务返回 HTTP ${status}：${reason}（请求 ID：translation-fixture-123）`);
    expect(f.requests).toHaveLength(1);
  });

  it.each([
    ["HTML error page", 502, "<html>private upstream error page</html>", "翻译服务返回 HTTP 502"],
    [
      "oversized error",
      503,
      JSON.stringify({ message: "x".repeat(5000) }),
      "翻译服务返回 HTTP 503",
    ],
    ["invalid JSON", 200, "not JSON", "翻译服务返回了无效的 JSON 响应"],
    ["oversized result", 200, "x".repeat(1_048_577), "翻译服务响应超过大小限制"],
  ])("reports %s without dumping the response body", async (_name, status, body, message) => {
    const f = await fixture((_body, res) => {
      res.writeHead(status);
      res.end(body);
    });

    await expect(
      f.translator.translate({ text: "Please translate this message.", targetLocale: "zh-CN" }),
    ).rejects.toThrow(new Error(message));
  });

  it("bounds JSON error reasons and does not expose other response fields", async () => {
    const f = await fixture((_body, res) => {
      res.writeHead(500);
      res.end(JSON.stringify({ message: "x".repeat(1000), diagnostic: "fixture-private-detail" }));
    });

    await expect(
      f.translator.translate({ text: "Please translate this message.", targetLocale: "zh-CN" }),
    ).rejects.toThrow(new Error(`翻译服务返回 HTTP 500：${"x".repeat(300)}`));
  });

  it("reports the translation timeout instead of a generic abort", async () => {
    const f = await fixture(() => {});
    const realTimeout = AbortSignal.timeout;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(25));

    await expect(
      f.translator.translate({ text: "Please translate this message.", targetLocale: "zh-CN" }),
    ).rejects.toThrow("翻译请求超时（15 秒），网关未及时返回结果");
    expect(timeout).toHaveBeenCalledWith(15_000);
  });
});
