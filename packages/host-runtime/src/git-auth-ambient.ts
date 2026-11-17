import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { GitAuthSource } from "@codexhost/shared-contracts";

const execute = promisify(execFile);
const CLI_TIMEOUT_MS = 5_000;
// 凭据助手可能等待交互或不可达的钥匙串服务；它只是“可复用”的来源之一，不能拖住调用方。
const HELPER_TIMEOUT_MS = 2_000;

export interface AmbientCredential {
  source: Exclude<GitAuthSource, "stored">;
  username: string | null;
  /** 令牌只用于本次进程内的 Git 命令，不写入任何文件。 */
  token: string;
  detail: string;
}

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * gh 的 hosts.yml 只用到固定形状：主机键下 `users:` 再下一层用户名，键为 `oauth_token`。
 * 这里按缩进解析而不引入 YAML 依赖，未识别的结构直接视为没有令牌。
 */
export function parseGhHosts(source: string): Map<string, { token: string; user: string | null }> {
  const hosts = new Map<string, { token: string; user: string | null }>();
  const lines = source.split(/\r?\n/u);
  let host: string | null = null;
  let inUsers = false;
  let user: string | null = null;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const depth = indentation(line);
    const text = line.trim();
    if (depth === 0) {
      host = text.endsWith(":") ? text.slice(0, -1).trim().toLowerCase() : null;
      inUsers = false;
      user = null;
      continue;
    }
    if (!host) continue;
    if (/^users:\s*$/u.test(text)) {
      inUsers = true;
      continue;
    }
    if (inUsers && /^[^:]+:\s*$/u.test(text)) {
      user = text.slice(0, -1).trim();
      continue;
    }
    const token = /^oauth_token:\s*(\S+)\s*$/u.exec(text);
    if (token?.[1] && user) {
      hosts.set(host, { token: token[1], user });
    }
  }
  return hosts;
}

/** glab 的 config.yml 里 `hosts:` 下每个主机一段，用户名与令牌都是顶层键。 */
export function parseGlabHosts(
  source: string,
): Map<string, { token: string; user: string | null }> {
  const hosts = new Map<string, { token: string; user: string | null }>();
  const lines = source.split(/\r?\n/u);
  let inHosts = false;
  let current: string | null = null;
  let token: string | null = null;
  let user: string | null = null;
  const flush = (): void => {
    if (current && token) hosts.set(current, { token, user });
    token = null;
    user = null;
  };
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const depth = indentation(line);
    const text = line.trim();
    if (depth === 0) {
      flush();
      current = null;
      inHosts = /^hosts:\s*$/u.test(text);
      continue;
    }
    if (!inHosts) continue;
    if (depth === 4 && /^[^:]+:\s*$/u.test(text)) {
      flush();
      current = text.slice(0, -1).trim().toLowerCase();
      continue;
    }
    if (!current) continue;
    const tokenMatch = /^token:\s*(\S+)\s*$/u.exec(text);
    if (tokenMatch?.[1]) token = tokenMatch[1];
    const userMatch = /^user:\s*(\S+)\s*$/u.exec(text);
    if (userMatch?.[1]) user = userMatch[1];
  }
  flush();
  return hosts;
}

function ghConfigFiles(environment: NodeJS.ProcessEnv): string[] {
  const explicit = environment.GH_CONFIG_DIR;
  if (explicit) return [path.join(explicit, "hosts.yml")];
  if (environment.XDG_CONFIG_HOME)
    return [path.join(environment.XDG_CONFIG_HOME, "gh", "hosts.yml")];
  return [path.join(os.homedir(), ".config", "gh", "hosts.yml")];
}

function glabConfigFiles(environment: NodeJS.ProcessEnv): string[] {
  const home = os.homedir();
  const files: string[] = [];
  if (environment.XDG_CONFIG_HOME)
    files.push(path.join(environment.XDG_CONFIG_HOME, "glab-cli", "config.yml"));
  files.push(path.join(home, ".config", "glab-cli", "config.yml"));
  if (process.platform === "darwin") {
    files.push(path.join(home, "Library", "Application Support", "glab-cli", "config.yml"));
  }
  if (environment.APPDATA) files.push(path.join(environment.APPDATA, "glab-cli", "config.yml"));
  return [...new Set(files)];
}

async function firstExisting(files: readonly string[]): Promise<string | null> {
  for (const file of files) {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      return null;
    }
  }
  return null;
}

async function cliToken(
  command: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    const result = await execute(command, [...arguments_], {
      env: environment,
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    const token = result.stdout.trim();
    return token && !/\s/u.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** 系统 Git 凭据助手：只查询，不保存；没有输出即视为不可用。 */
export async function readGitCredentialHelper(
  host: string,
  webUrl: URL,
  environment: NodeJS.ProcessEnv,
): Promise<AmbientCredential | null> {
  const input = `protocol=${webUrl.protocol.replace(":", "")}\nhost=${host}\n\n`;
  const output = await new Promise<string | null>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", ["credential", "fill"], {
        env: { ...environment, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, HELPER_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 64 * 1024) child.kill();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? stdout : null);
    });
    // 助手可能在读到输入前就退出（例如凭据不存在）：写入会被内核拒绝，
    // 那是“没有可用凭据”，不是需要冒泡给调用方的错误。
    child.stdin?.on("error", () => undefined);
    if (child.stdin && !child.stdin.destroyed) child.stdin.end(input);
  });
  if (!output) return null;
  const fields = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const index = line.indexOf("=");
    if (index > 0) fields.set(line.slice(0, index), line.slice(index + 1));
  }
  const password = fields.get("password");
  if (!password) return null;
  return {
    source: "git-credential",
    username: fields.get("username") ?? null,
    token: password,
    detail: "系统 Git 凭据助手",
  };
}

/**
 * 依次尝试本机已有的登录态：显式配置的命令行工具优先，其次是系统凭据助手。
 * 任何一步失败都继续下一种来源，不把“工具不存在”当成登录失败提示。
 */
export async function detectAmbientCredential(
  host: string,
  webUrl: URL,
  environment: NodeJS.ProcessEnv,
  options: {
    /** SSH 远端用不上 HTTP 凭据，跳过可能阻塞的凭据助手查询。 */
    skipCredentialHelper?: boolean;
  } = {},
): Promise<AmbientCredential | null> {
  const normalized = host.toLowerCase();
  // 配置文件先读：它是 gh 自己的权威状态，且不依赖子进程；令牌存在钥匙串时
  // hosts.yml 只有用户名，再由 `gh auth token` 补齐。
  const ghSource = await firstExisting(ghConfigFiles(environment));
  const gh = ghSource ? parseGhHosts(ghSource).get(normalized) : undefined;
  if (gh) {
    return {
      source: "gh-cli",
      username: gh.user,
      token: gh.token,
      detail: "gh 命令行登录态",
    };
  }
  const explicitGh = await cliToken("gh", ["auth", "token", "--hostname", normalized], environment);
  if (explicitGh) {
    return { source: "gh-cli", username: null, token: explicitGh, detail: "gh 命令行登录态" };
  }
  const glabHosts = new Map(
    (
      await Promise.all(
        glabConfigFiles(environment).map(async (file) => {
          const source = await readFile(file, "utf8").catch(() => null);
          return source ? [...parseGlabHosts(source)] : [];
        }),
      )
    ).flat(),
  );
  const glab =
    glabHosts.get(normalized) ??
    glabHosts.get(`${normalized}:443`) ??
    glabHosts.get(`${normalized}:80`);
  if (glab) {
    return {
      source: "glab-cli",
      username: glab.user,
      token: glab.token,
      detail: "glab 命令行登录态",
    };
  }
  return options.skipCredentialHelper ? null : readGitCredentialHelper(host, webUrl, environment);
}
