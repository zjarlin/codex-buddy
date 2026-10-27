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
  return { translator: new BuddyTranslator({ CODEX_HOME: home }), requests, home };
}

describe("gateway translation", () => {
  it.each(["zh", "zh-CN", "zh-TW"])(
    "skips Chinese technical prose for %s without contacting the gateway",
    async (targetLocale) => {
      const f = await fixture((_body, res) => res.end("unexpected request"));
      const text =
        "3D 是「Qt 宿主 + Web(Three.js) 应用」。拉 RWebThree.dll / ShapeWebThree.dll 与 webview-vs、样例 web3d 资源。";
      expect(await f.translator.translate({ text, targetLocale })).toEqual({
        translated: text,
        model: "noop",
        latencyMs: 0,
      });
      expect(f.requests).toHaveLength(0);
    },
  );

  it("skips same-language prose and code without requiring gateway configuration", async () => {
    const home = await mkdtemp(join(tmpdir(), "buddy-translator-no-config-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const translator = new BuddyTranslator({ CODEX_HOME: home });
    for (const [text, targetLocale] of [
      ["请检查 RWebThree.dll 和 ShapeWebThree.dll。", "zh-TW"],
      ["Check the component before changing the configuration.", "en"],
      ["```typescript\nconst value = 'English and 中文';\n```", "zh-CN"],
      ["QWebEngineView RWebThree.dll /qwebchannel.js", "zh-CN"],
    ]) {
      expect(await translator.translate({ text, targetLocale })).toEqual({
        translated: text,
        model: "noop",
        latencyMs: 0,
      });
    }
  });

  it.each([
    [
      "Check the QWebEngineView and the label 中文 before calling runScript(QString,bool).",
      "zh-CN",
      "en",
    ],
    ["请检查 RWebThree.dll 和 ShapeWebThree.dll 的加载状态。", "en", "zh-CN"],
  ])("preserves technical names when translating %s", async (text, targetLocale, source) => {
    const f = await fixture((_body, res) => {
      res.end(JSON.stringify({ translations: [{ text: "Translated" }], provider: "baidu" }));
    });
    await expect(f.translator.translate({ text, targetLocale })).resolves.toMatchObject({
      translated: "Translated",
      model: "sub2api:baidu",
    });
    expect(f.requests).toEqual([{ q: [text], source, target: targetLocale, format: "text" }]);
  });

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
      JSON.stringify({ message: "x".repeat(33000) }),
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

describe("batch translation", () => {
  it("translates every unique English item in a single gateway request", async () => {
    const f = await fixture((body, res) => {
      const texts = body.q as string[];
      res.end(
        JSON.stringify({
          translations: texts.map((text) => ({ text: `中文：${text}` })),
          provider: "caiyun",
        }),
      );
    });

    const result = await f.translator.translateBatch({
      targetLocale: "zh-CN",
      items: [
        { id: "turn:1", text: "Check which services are listening before changing the rules." },
        { id: "turn:2", text: "Now let me verify the adapter wiring and account state." },
      ],
    });

    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toEqual({
      q: [
        "Check which services are listening before changing the rules.",
        "Now let me verify the adapter wiring and account state.",
      ],
      source: "en",
      target: "zh-CN",
      format: "text",
    });
    expect(result.items).toEqual([
      {
        id: "turn:1",
        translated: "中文：Check which services are listening before changing the rules.",
        model: "sub2api:caiyun",
        latencyMs: expect.any(Number),
      },
      {
        id: "turn:2",
        translated: "中文：Now let me verify the adapter wiring and account state.",
        model: "sub2api:caiyun",
        latencyMs: expect.any(Number),
      },
    ]);
  });

  it("deduplicates repeated text and preserves request order", async () => {
    const f = await fixture((body, res) => {
      const texts = body.q as string[];
      res.end(
        JSON.stringify({
          translations: texts.map((text) => ({ text: `[${text}]` })),
          provider: "caiyun",
        }),
      );
    });

    const result = await f.translator.translateBatch({
      targetLocale: "zh-CN",
      items: [
        { id: "a", text: "Repeated English explanation that must be translated once." },
        { id: "b", text: "Repeated English explanation that must be translated once." },
      ],
    });

    // 网关只收到去重后的唯一文本。
    expect(f.requests).toHaveLength(1);
    expect((f.requests[0]?.q as string[]).length).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.items[0]?.translated).toBe(result.items[1]?.translated);
  });

  it("skips Chinese and code items without contacting the gateway", async () => {
    const f = await fixture((_body, res) => res.end("unexpected request"));
    const result = await f.translator.translateBatch({
      targetLocale: "zh-CN",
      items: [
        { id: "zh", text: "请检查服务器容量，再决定模型。" },
        { id: "code", text: "```typescript\nconst value = 'English and 中文';\n```" },
      ],
    });
    expect(f.requests).toHaveLength(0);
    expect(result.items).toEqual([
      { id: "zh", translated: "请检查服务器容量，再决定模型。", model: "noop", latencyMs: 0 },
      {
        id: "code",
        translated: "```typescript\nconst value = 'English and 中文';\n```",
        model: "noop",
        latencyMs: 0,
      },
    ]);
  });

  it("serves cached items and only sends new text to the gateway", async () => {
    const f = await fixture((body, res) => {
      const texts = body.q as string[];
      res.end(
        JSON.stringify({
          translations: texts.map((text) => ({ text: `[${text}]` })),
          provider: "caiyun",
        }),
      );
    });
    const first = { id: "a", text: "A stable English sentence that is translated once." };
    await f.translator.translateBatch({ targetLocale: "zh-CN", items: [first] });
    expect(f.requests).toHaveLength(1);

    const result = await f.translator.translateBatch({
      targetLocale: "zh-CN",
      items: [first, { id: "b", text: "A second English sentence that needs translation." }],
    });
    expect(f.requests).toHaveLength(2);
    expect((f.requests[1]?.q as string[]).length).toBe(1);
    expect(result.items[0]?.translated).toBe(`[${first.text}]`);
    expect(result.items[1]?.id).toBe("b");
  });

  it("rejects malformed batches and incomplete gateway responses", async () => {
    const f = await fixture((body, res) => {
      const texts = body.q as string[];
      res.end(JSON.stringify({ translations: [texts[0]].map((text) => ({ text: `[${text}]` })) }));
    });
    await expect(f.translator.translateBatch({ targetLocale: "zh-CN", items: [] })).rejects.toThrow(
      "批量翻译请求无效",
    );
    await expect(
      f.translator.translateBatch({
        targetLocale: "zh-CN",
        items: [
          { id: "a", text: "First English sentence that needs translation." },
          { id: "b", text: "Second English sentence that needs translation." },
        ],
      }),
    ).rejects.toThrow("翻译服务未返回结果");
  });
});

it("preserves gateway provider failure details", async () => {
  const f = await fixture((_body, res) => {
    res.writeHead(502);
    res.end(
      JSON.stringify({
        message: "Translation providers failed",
        data: {
          attempts: [
            { provider: "hymt", status: "failed", reason: "upstream timeout" },
            { provider: "baidu", status: "cooldown" },
          ],
        },
      }),
    );
  });
  await expect(
    f.translator.translate({ text: "Please translate this message.", targetLocale: "zh-CN" }),
  ).rejects.toThrow("hymt · failed · upstream timeout\nbaidu · cooldown");
});

describe("gateway image translation", () => {
  const png = `data:image/png;base64,${"iVBORw0KGgo=".repeat(4)}`;

  function responsesText(text: string): string {
    return JSON.stringify({
      id: "resp_fixture",
      object: "response",
      status: "completed",
      model: "fixture-vision",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
    });
  }

  it("asks the vision model for the translation only, with image bytes inline", async () => {
    const f = await fixture((_body, res) => res.end(responsesText("构建失败：健康检查超时")));

    const result = await f.translator.translateImage({ image: png, targetLocale: "zh-CN" });

    expect(result.translated).toBe("构建失败：健康检查超时");
    expect(result.model).toBe("cn:glm-5v-turbo");
    expect(f.requests).toHaveLength(1);
    const body = f.requests[0] as {
      model: string;
      store: boolean;
      input: { role: string; content: Record<string, unknown>[] }[];
    };
    expect(body.model).toBe("cn:glm-5v-turbo");
    expect(body.store).toBe(false);
    const content = body.input[0]?.content ?? [];
    const prompt = content.find((part) => part.type === "input_text");
    const image = content.find((part) => part.type === "input_image");
    expect(String(prompt?.text)).toContain("简体中文");
    expect(String(prompt?.text)).toContain("Output only the translation");
    expect(image?.image_url).toBe(png);
  });

  it("honours the configured vision model", async () => {
    const f = await fixture((_body, res) => res.end(responsesText("done")));
    const translator = new BuddyTranslator({
      CODEX_HOME: f.home,
      CODEXHOST_TRANSLATE_VISION_MODEL: "cn:qwen-vl-max",
    });
    await expect(
      translator.translateImage({ image: png, targetLocale: "en" }),
    ).resolves.toMatchObject({ model: "cn:qwen-vl-max" });
    expect((f.requests[0] as { model: string }).model).toBe("cn:qwen-vl-max");
  });

  it("returns an empty translation when the image has no readable text", async () => {
    const f = await fixture((_body, res) => res.end(responsesText("")));
    await expect(
      f.translator.translateImage({ image: png, targetLocale: "zh-CN" }),
    ).resolves.toEqual({ translated: "", model: "cn:glm-5v-turbo", latencyMs: expect.any(Number) });
  });

  it("falls back to the next vision model when the primary has no capacity", async () => {
    const f = await fixture((body, res) => {
      const model = body.model as string;
      if (model === "cn:glm-5v-turbo") {
        res.writeHead(503);
        res.end(JSON.stringify({ error: { message: "No image assistance capacity" } }));
        return;
      }
      res.end(responsesText("降级后的译文"));
    });

    const result = await f.translator.translateImage({ image: png, targetLocale: "zh-CN" });

    expect(result).toMatchObject({ translated: "降级后的译文", model: "gpt-6.1-sol" });
    expect(f.requests.map((body) => (body as { model: string }).model)).toEqual([
      "cn:glm-5v-turbo",
      "gpt-6.1-sol",
    ]);
  });

  it("falls back when the gateway directory has no such model", async () => {
    const f = await fixture((body, res) => {
      const model = body.model as string;
      if (model === "cn:glm-5v-turbo") {
        res.writeHead(404);
        res.end(
          JSON.stringify({
            error: { message: `Model "${model}" is not supported by any account` },
          }),
        );
        return;
      }
      res.end(responsesText("另一个模型的译文"));
    });
    await expect(
      f.translator.translateImage({ image: png, targetLocale: "zh-CN" }),
    ).resolves.toMatchObject({ translated: "另一个模型的译文", model: "gpt-6.1-sol" });
  });

  it("does not fall back on a request the model rejects outright", async () => {
    const f = await fixture((_body, res) => {
      res.writeHead(400);
      res.end(JSON.stringify({ error: { message: "Invalid 'input[0].content[1].image_url'" } }));
    });
    await expect(
      f.translator.translateImage({ image: png, targetLocale: "zh-CN" }),
    ).rejects.toThrow("HTTP 400");
    expect(f.requests).toHaveLength(1);
  });

  it("reuses a fallback result for the same image instead of paying twice", async () => {
    let calls = 0;
    const f = await fixture((body, res) => {
      calls += 1;
      const model = body.model as string;
      if (model === "cn:glm-5v-turbo") {
        res.writeHead(429);
        res.end(JSON.stringify({ error: { message: "rate limit" } }));
        return;
      }
      res.end(responsesText("降级缓存"));
    });
    await f.translator.translateImage({ image: png, targetLocale: "zh-CN" });
    const before = calls;
    await expect(
      f.translator.translateImage({ image: png, targetLocale: "zh-CN" }),
    ).resolves.toMatchObject({ translated: "降级缓存" });
    expect(calls).toBe(before);
  });

  it("serves repeat requests from the image cache", async () => {
    const f = await fixture((_body, res) => res.end(responsesText("缓存")));
    await f.translator.translateImage({ image: png, targetLocale: "zh-CN" });
    await f.translator.translateImage({ image: png, targetLocale: "zh-CN" });
    expect(f.requests).toHaveLength(1);
  });

  it.each(["http://example.com/a.png", "file:///tmp/a.png", "/tmp/a.png", "not-an-image"])(
    "rejects %s before touching the gateway",
    async (image) => {
      const f = await fixture((_body, res) => res.end(responsesText("unused")));
      await expect(f.translator.translateImage({ image, targetLocale: "zh-CN" })).rejects.toThrow(
        "图片翻译请求无效",
      );
      expect(f.requests).toHaveLength(0);
    },
  );

  it("reports gateway errors with the upstream reason and request id", async () => {
    const f = await fixture((_body, res) => {
      res.writeHead(429, { "x-request-id": "vision-fixture-1" });
      res.end(JSON.stringify({ error: { message: "Concurrency limit exceeded for account" } }));
    });
    await expect(
      f.translator.translateImage({ image: png, targetLocale: "zh-CN" }),
    ).rejects.toThrow(
      "图片翻译服务返回 HTTP 429：Concurrency limit exceeded for account（请求 ID：vision-fixture-1）",
    );
  });

  it("surfaces an in-body error instead of returning an empty translation", async () => {
    const f = await fixture((_body, res) =>
      res.end(
        JSON.stringify({
          error: { message: "No image assistance capacity is currently available" },
        }),
      ),
    );
    await expect(
      f.translator.translateImage({ image: png, targetLocale: "zh-CN" }),
    ).rejects.toThrow("No image assistance capacity is currently available");
  });
});
