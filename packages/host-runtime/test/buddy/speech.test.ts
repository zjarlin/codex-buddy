import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BuddySpeech } from "../../src/buddy/speech.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((clean) => clean()));
});

async function gateway(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("fixture address missing");
  cleanups.push(async () => {
    instance.closeAllConnections();
    await new Promise<void>((resolve) => instance.close(() => resolve()));
  });
  return `http://127.0.0.1:${address.port}/v1`;
}

async function fixture(
  respond: (body: Record<string, unknown>, res: ServerResponse) => void,
  options: { configured?: boolean } = {},
) {
  const requests: {
    url: string;
    body: Record<string, unknown>;
    authorization: string | undefined;
  }[] = [];
  const base = await gateway((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push({ url: req.url ?? "", body, authorization: req.headers.authorization });
      respond(body, res);
    });
  });
  const home = await mkdtemp(join(tmpdir(), "buddy-speech-test-"));
  await writeFile(join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "fixture-key" }), {
    mode: 0o600,
  });
  if (options.configured !== false) {
    await writeFile(
      join(home, "config.toml"),
      `model_provider = "gateway"\n[model_providers.gateway]\nbase_url = ${JSON.stringify(base)}\nrequires_openai_auth = true\n`,
    );
  }
  cleanups.push(async () => {
    await rm(home, { recursive: true, force: true });
  });
  return {
    speech: new BuddySpeech({ CODEX_HOME: home, OPENAI_API_KEY: "unrelated-environment-key" }),
    requests,
  };
}

function audio(body: Record<string, unknown>, audioBase64: string, characters = 12) {
  return JSON.stringify({ data: [{ b64_json: audioBase64 }], format: body.format, characters });
}

describe("gateway speech synthesis", () => {
  it("requests Manbo TTS on the gateway media route and returns playable audio", async () => {
    const f = await fixture((_body, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(audio({ format: "wav" }, Buffer.from("RIFFfixture").toString("base64"), 14));
    });

    const result = await f.speech.synthesize({ text: "会话已完成", locale: "zh-CN" });

    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.url).toBe("/media/tts");
    expect(f.requests[0]?.authorization).toBe("Bearer fixture-key");
    expect(f.requests[0]?.body).toEqual({
      text: "会话已完成",
      language: "zh",
      response_format: "wav",
      return_base64: true,
    });
    expect(result.format).toBe("wav");
    // 字符数按实际发送的文本统计，不信任上游回显。
    expect(result.characters).toBe(5);
    expect(Buffer.from(result.audioBase64, "base64").toString()).toBe("RIFFfixture");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("maps locale to the synthesis language and lets unknown locales auto-detect", async () => {
    const f = await fixture((_body, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(audio({ format: "wav" }, "AAAA"));
    });

    await f.speech.synthesize({ text: "hello", locale: "en" });
    await f.speech.synthesize({ text: "你好", locale: "zh-TW" });
    await f.speech.synthesize({ text: "bonjour", locale: "fr" });
    await f.speech.synthesize({ text: "hello" });

    expect(f.requests.map((request) => request.body.language)).toEqual([
      "en",
      "zh",
      "auto",
      "auto",
    ]);
  });

  it("rejects invalid, empty, and oversized requests before contacting the gateway", async () => {
    const f = await fixture((_body, res) => {
      res.end(audio({ format: "wav" }, "AAAA"));
    });

    await expect(f.speech.synthesize({ text: "" })).rejects.toThrow("播报请求无效");
    await expect(f.speech.synthesize({ text: "   " })).rejects.toThrow("播报文本为空");
    await expect(f.speech.synthesize({ text: "a".repeat(241) })).rejects.toThrow("播报请求无效");
    await expect(f.speech.synthesize({ text: "hi", extra: true })).rejects.toThrow("播报请求无效");
    expect(f.requests).toHaveLength(0);
  });

  it("reports unavailable gateways and upstream failures without inventing audio", async () => {
    const unconfigured = await fixture(
      (_body, res) => {
        res.end("{}");
      },
      { configured: false },
    );
    await expect(unconfigured.speech.synthesize({ text: "hi" })).rejects.toThrow("未配置网关");

    const failing = await fixture((_body, res) => {
      res.writeHead(500);
      res.end("upstream down");
    });
    await expect(failing.speech.synthesize({ text: "hi" })).rejects.toThrow("HTTP 500");

    const empty = await fixture((_body, res) => {
      res.end(JSON.stringify({ data: [] }));
    });
    await expect(empty.speech.synthesize({ text: "hi" })).rejects.toThrow("语音服务未返回音频");

    const tooLarge = await fixture((_body, res) => {
      // 8.6MB 音频：低于读取上限（JSON 约 11.5MB），但超过 8MiB 可播报上限。
      res.end(audio({ format: "wav" }, Buffer.alloc(8_600_000, 1).toString("base64")));
    });
    await expect(tooLarge.speech.synthesize({ text: "hi" })).rejects.toThrow("合成音频过大");
  });
});
