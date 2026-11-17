import type { GitProvider } from "@codexhost/shared-contracts";

/**
 * 只从远端地址推断主机与站点来源；认证仍然按主机名与传输协议执行。
 * 主机名先按已知托管平台判断，域名无法判断时再由调用方探测 API。
 */
export interface GitRemoteTarget {
  /** 小写主机名，不含端口。 */
  host: string;
  /** 远端里出现端口时保留，用于拼接站点地址。 */
  port: string | null;
  /** 远端使用的传输协议；决定站点地址是 http 还是 https。 */
  transport: "https" | "http" | "ssh";
}

const SCP_SHAPE = /^(?:[a-z0-9._-]+)@([a-z0-9.-]+):(?!\/)(.*)$/iu;

export function gitRemoteTarget(remote: string): GitRemoteTarget | null {
  const value = remote.trim();
  if (!value) return null;
  const scp = SCP_SHAPE.exec(value);
  if (scp?.[1]) return { host: scp[1].toLowerCase(), port: null, transport: "ssh" };
  try {
    const url = new URL(value);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return null;
    if (!url.hostname) return null;
    return {
      host: url.hostname.toLowerCase(),
      port: url.port || null,
      transport: url.protocol === "http:" ? "http" : url.protocol === "https:" ? "https" : "ssh",
    };
  } catch {
    return null;
  }
}

/** 站点地址：SSH 远端没有协议信息，按 https 处理，本机 http 服务保留原协议。 */
export function gitWebUrl(target: GitRemoteTarget): string {
  const authority = target.port ? `${target.host}:${target.port}` : target.host;
  return `${target.transport === "http" ? "http" : "https"}://${authority}`;
}

/** 规范化用户输入的主机名：允许带协议、带端口、带路径，只保留主机与端口。 */
export function normalizeGitHost(value: string): { host: string; port: string | null } | null {
  const text = value.trim();
  if (!text) return null;
  const target = gitRemoteTarget(text.includes("://") ? text : `https://${text}`);
  if (!target || target.transport === "ssh") {
    const scp = gitRemoteTarget(`git@${text.replace(/^\/+/u, "")}:x`);
    return scp ? { host: scp.host, port: null } : null;
  }
  return { host: target.host, port: target.port };
}

const KNOWN_PROVIDERS: ReadonlyArray<{ match: RegExp; provider: GitProvider }> = [
  { match: /^(?:www\.)?github\.com$/u, provider: "github" },
  { match: /(?:^|\.)github\.(?:com|io|enterprise)$/u, provider: "github" },
  { match: /^(?:www\.)?gitee\.com$/u, provider: "gitee" },
  { match: /^(?:www\.)?gitlab\.com$/u, provider: "gitlab" },
  { match: /(?:^|\.)gitlab\./u, provider: "gitlab" },
];

export function namedGitProvider(host: string): GitProvider | null {
  for (const entry of KNOWN_PROVIDERS) if (entry.match.test(host)) return entry.provider;
  return null;
}

/** 各平台 HTTPS 认证使用的默认用户名；真实用户名在验证成功后被覆盖。 */
export function defaultGitUsername(provider: GitProvider): string {
  if (provider === "github") return "x-access-token";
  if (provider === "gitlab") return "oauth2";
  return "";
}

export function gitTokenVerificationRequest(
  provider: GitProvider,
  webUrl: string,
  token: string,
): { url: string; headers: Record<string, string>; loginPaths: readonly string[] } {
  if (provider === "gitee") {
    return {
      url: `${webUrl}/api/v5/user?access_token=${encodeURIComponent(token)}`,
      headers: { Accept: "application/json" },
      loginPaths: ["login", "name"],
    };
  }
  if (provider === "gitlab") {
    return {
      url: `${webUrl}/api/v4/user`,
      headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
      loginPaths: ["username", "name"],
    };
  }
  // GitHub 与通用主机优先企业接口，失败时由调用方回退到 api.github.com。
  const base =
    provider === "github" && /^https?:\/\/(?:www\.)?github\.com$/u.test(webUrl)
      ? "https://api.github.com"
      : `${webUrl}/api/v3`;
  return {
    url: `${base}/user`,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    loginPaths: ["login", "name"],
  };
}

export function gitProviderLabel(provider: GitProvider): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "gitee":
      return "Gitee";
    case "gitlab":
      return "GitLab";
    default:
      return "Git";
  }
}

/** 各平台的 Token 申请入口，界面直接给出可点击链接。 */
export function gitTokenUrl(provider: GitProvider, webUrl: string): string {
  if (provider === "github") {
    return /^https?:\/\/(?:www\.)?github\.com$/u.test(webUrl)
      ? "https://github.com/settings/tokens"
      : `${webUrl}/settings/tokens`;
  }
  if (provider === "gitee") return "https://gitee.com/profile/personal_access_tokens";
  if (provider === "gitlab") return `${webUrl}/-/user_settings/personal_access_tokens`;
  return `${webUrl}/-/user_settings/personal_access_tokens`;
}

/** 各平台的 SSH 公钥设置入口。 */
export function gitSshKeysUrl(provider: GitProvider, webUrl: string): string {
  if (provider === "github") {
    return /^https?:\/\/(?:www\.)?github\.com$/u.test(webUrl)
      ? "https://github.com/settings/keys"
      : `${webUrl}/settings/keys`;
  }
  if (provider === "gitee") return "https://gitee.com/profile/sshkeys";
  return `${webUrl}/-/user_settings/ssh_keys`;
}
