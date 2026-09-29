import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface DesktopSshConnection {
  arguments: string[];
  authority: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() && !/[\0\r\n]/u.test(value)
    ? value.trim()
    : null;
}

// SSH 连接参数只从 Desktop 保存的连接读取，Renderer 不能传入任意 SSH 选项。
export async function desktopSshConnection(
  hostId: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DesktopSshConnection> {
  const home = environment.CODEX_HOME ?? path.join(environment.HOME ?? homedir(), ".codex");
  const state = JSON.parse(await readFile(path.join(home, ".codex-global-state.json"), "utf8"));
  const connections: unknown = state["codex-managed-remote-connections"];
  const connection = Array.isArray(connections)
    ? connections.find((entry) => entry?.hostId === hostId)
    : null;
  if (!connection || !["discovered", "codex-managed"].includes(connection.source)) {
    throw new Error("未找到该项目的 SSH 连接，请在 Desktop 的连接设置中重新连接。");
  }
  const alias = text(connection.alias ?? connection.sshAlias);
  if (alias) {
    if (alias.startsWith("-") || /\s/u.test(alias)) throw new Error("SSH 别名无效。");
    return { arguments: [alias], authority: alias };
  }
  const hostname = text(connection.hostname ?? connection.sshHost);
  if (!hostname || hostname.startsWith("-") || /\s/u.test(hostname)) {
    throw new Error("SSH 主机名无效。");
  }
  const arguments_: string[] = [];
  const identity = text(connection.identity);
  if (identity) arguments_.push("-i", identity);
  const port: unknown = connection.sshPort;
  if (port != null) {
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("SSH 端口无效。");
    }
    arguments_.push("-p", String(port));
  }
  arguments_.push(hostname);
  // VS Code 的 SSH authority 只支持主机、用户及端口；独立密钥必须通过 SSH 别名配置。
  const at = hostname.lastIndexOf("@");
  const configuration = {
    hostName: at < 0 ? hostname : hostname.slice(at + 1),
    ...(at < 0 ? {} : { user: hostname.slice(0, at) }),
    ...(port == null ? {} : { port }),
  };
  return {
    arguments: arguments_,
    authority: identity ? null : Buffer.from(JSON.stringify(configuration)).toString("hex"),
  };
}
