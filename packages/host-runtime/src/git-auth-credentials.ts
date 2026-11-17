import type { GitRemoteTarget } from "./git-auth-detect.js";

/**
 * 通过进程环境把登录态交给单次 Git 调用：
 * - HTTPS 用 `http.<origin>/.extraheader`，只在本次进程生效，不写 `~/.gitconfig`；
 * - SSH 用 `GIT_SSH_COMMAND` 指定本产品密钥，同时保留系统已有身份作为备选。
 * 凭据只出现在子进程环境里，不落盘、不进日志。
 */
export interface GitCredential {
  kind: "https-token" | "ssh-key" | "ambient-token";
  /** HTTPS 认证用户名；为空时由调用方按平台补默认值。 */
  username: string | null;
  secret: string | null;
}

function existingConfigCount(environment: NodeJS.ProcessEnv): number {
  const parsed = Number(environment.GIT_CONFIG_COUNT);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function appendGitConfig(
  environment: NodeJS.ProcessEnv,
  entries: ReadonlyArray<readonly [string, string]>,
): NodeJS.ProcessEnv {
  if (entries.length === 0) return environment;
  const start = existingConfigCount(environment);
  const next: NodeJS.ProcessEnv = {
    ...environment,
    GIT_CONFIG_COUNT: String(start + entries.length),
  };
  entries.forEach(([key, value], index) => {
    next[`GIT_CONFIG_KEY_${start + index}`] = key;
    next[`GIT_CONFIG_VALUE_${start + index}`] = value;
  });
  return next;
}

function httpsOrigin(target: GitRemoteTarget): string {
  const authority = target.port ? `${target.host}:${target.port}` : target.host;
  return `${target.transport === "http" ? "http" : "https"}://${authority}`;
}

function authorizationValue(username: string, token: string): string {
  const basic = Buffer.from(`${username}:${token}`, "utf8").toString("base64");
  return `Authorization: Basic ${basic}`;
}

export function withHttpsToken(
  environment: NodeJS.ProcessEnv,
  target: GitRemoteTarget,
  username: string,
  token: string,
): NodeJS.ProcessEnv {
  return appendGitConfig(environment, [
    [`http.${httpsOrigin(target)}/.extraheader`, authorizationValue(username, token)],
  ]);
}

/** GIT_SSH_COMMAND 由 shell 解析：Windows 反斜杠会被当成转义，统一成正斜杠再引用。 */
function shellPath(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  return `"${normalized.replaceAll('"', '\\"')}"`;
}

export function withSshIdentity(
  environment: NodeJS.ProcessEnv,
  identityFile: string,
  /** 排他只在用户显式启用本产品 SSH 账号时使用；其余情况保留已有身份作为候选。 */
  exclusive = true,
): NodeJS.ProcessEnv {
  // 不覆盖用户自己的 GIT_SSH_COMMAND：已有的保持原样，只补一个身份。
  const base = environment.GIT_SSH_COMMAND?.trim() || "ssh";
  const identity = `${base} -i ${shellPath(identityFile)}`;
  return {
    ...environment,
    GIT_SSH_COMMAND: exclusive ? `${identity} -o IdentitiesOnly=yes` : identity,
  };
}

/** 未托管平台也可能要求用户名口令；失败时由上层给出登录提示，不猜测凭据。 */
export function withCredential(
  environment: NodeJS.ProcessEnv,
  target: GitRemoteTarget,
  credential: GitCredential,
  identityFile: string | null,
  exclusiveIdentity = true,
): NodeJS.ProcessEnv {
  if (credential.kind === "ssh-key") {
    return identityFile
      ? withSshIdentity(environment, identityFile, exclusiveIdentity)
      : environment;
  }
  if (!credential.secret) return environment;
  // SSH 远端用不上 HTTP 头；有本产品密钥时补一个身份，但不排他。
  if (target.transport === "ssh")
    return identityFile ? withSshIdentity(environment, identityFile, false) : environment;
  return withHttpsToken(environment, target, credential.username ?? "", credential.secret);
}
