import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

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
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        let len = 0;
        res.on("data", (c: Buffer) => {
          len += c.length;
          if (len > maxResponseBytes) {
            res.destroy();
            reject(new Error("Too large"));
          }
          chunks.push(c);
        });
        res.on("error", () => reject(new Error("Read failed")));
        res.on("end", () => {
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
