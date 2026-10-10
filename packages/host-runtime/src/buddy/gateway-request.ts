import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export class GatewayHttpError extends Error {
  constructor(statusCode: number | undefined, body: string, requestId?: string) {
    let reason = "";
    try {
      const payload = JSON.parse(body) as Record<string, unknown>;
      const detail = payload.error;
      const message =
        typeof detail === "object" && detail !== null
          ? ((detail as Record<string, unknown>).message ?? payload.message)
          : (payload.message ?? detail);
      if (typeof message === "string") {
        reason = message.replace(/\s+/gu, " ").trim().slice(0, 300);
      }
    } catch {
      // HTML 错误页和非 JSON 响应只显示状态码，不把页面正文当作错误原因。
    }
    let attempts = "";
    try {
      const payload = JSON.parse(body) as Record<string, unknown>;
      const data = payload.data as { attempts?: unknown } | undefined;
      if (Array.isArray(data?.attempts)) {
        attempts = data.attempts
          .slice(0, 16)
          .map((attempt: unknown) => {
            if (!attempt || typeof attempt !== "object") return "";
            const row = attempt as Record<string, unknown>;
            const fields = [row.provider, row.status, row.reason].filter(
              (value): value is string => typeof value === "string",
            );
            return fields.map((value) => value.slice(0, 500)).join(" · ");
          })
          .filter(Boolean)
          .join("\n");
      }
    } catch {
      // 非 JSON 错误页不作为诊断正文展示。
    }
    const id = requestId && /^[\w.:-]{1,128}$/u.test(requestId) ? requestId : null;
    super(
      `HTTP ${statusCode ?? "unknown"}${reason ? `：${reason}` : ""}${id ? `（请求 ID：${id}）` : ""}${attempts ? `\n${attempts}` : ""}`,
    );
    this.name = "GatewayHttpError";
  }
}

/**
 * 通过当前 Codex 网关连接发送 JSON 请求并读取 JSON 响应。
 * 供 Buddy 的翻译与语音合成共用：都不携带工具、不跟随重定向、不继承环境代理，
 * 并在读取阶段强制上限，避免上游异常响应把 Host 内存撑爆。
 */
export async function gatewayJsonRequest(
  url: URL,
  headers: Headers,
  body: unknown,
  signal: AbortSignal,
  maxResponseBytes: number,
): Promise<unknown> {
  const payload = JSON.stringify(body);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: "POST",
        agent: false,
        signal,
        headers: {
          ...Object.fromEntries(headers),
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const failed = res.statusCode !== 200;
        const limit = failed ? Math.min(maxResponseBytes, 32768) : maxResponseBytes;
        const requestId = res.headers["x-request-id"];
        const httpError = (body = "") =>
          new GatewayHttpError(
            res.statusCode,
            body,
            typeof requestId === "string" ? requestId : undefined,
          );
        const chunks: Buffer[] = [];
        let len = 0;
        res.on("data", (c: Buffer) => {
          len += c.length;
          if (len > limit) {
            res.destroy();
            reject(failed ? httpError() : new Error("Too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("error", () => reject(failed ? httpError() : new Error("Read failed")));
        res.on("end", () => {
          if (failed) {
            reject(httpError(Buffer.concat(chunks).toString()));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error("Invalid JSON"));
          }
        });
      },
    );
    req.on("error", (e) => reject(signal.aborted ? new Error("Aborted") : e));
    req.end(payload);
  });
}
