/**
 * Git 远程仓库身份。
 *
 * 同一仓库可能通过 SSH、HTTPS 或不同用户名引用；项目去重只关心主机和仓库路径，
 * 与 `project-sync` 的清单身份保持一致。无法识别的地址返回 null，调用方应退回
 * 项目名，而不是把本地绝对路径或任意字符串当成跨主机身份。
 */

const SCP_REMOTE = /^[a-z0-9._-]+@[a-z0-9.-]+:[a-z0-9._/-]+(?:\.git)?$/iu;
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//iu;
const HOST = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/iu;
const IPV6_HOST = /^\[[0-9a-f:.]+\]$/iu;
const MAX_ORIGIN_LENGTH = 2048;
// `git+ssh://` 与 `ssh+git://` 是同一传输方式的不同写法。
const TRANSPORTS: Record<string, "https" | "ssh" | "git"> = {
  https: "https",
  ssh: "ssh",
  git: "git",
  "git+ssh": "ssh",
  "ssh+git": "ssh",
};

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/gu, "");
}

function repositoryPath(value: string): string | null {
  const repository = trimSlashes(value).replace(/\.git$/iu, "");
  if (
    !repository ||
    repository.includes("\\") ||
    repository.split("/").includes("..") ||
    /%(?:2f|5c|2e)/iu.test(repository)
  ) {
    return null;
  }
  return repository.toLowerCase();
}

function validHost(host: string): boolean {
  return (HOST.test(host) || IPV6_HOST.test(host)) && !host.includes("..") && !host.startsWith(".");
}

/** 返回 `host/path` 形式的稳定仓库身份；没有可识别来源时返回 null。 */
export function normalizeProjectOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  const value = origin.trim();
  if (
    !value ||
    value.length > MAX_ORIGIN_LENGTH ||
    /\s|[\x00-\x1f]/u.test(value) ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return null;
  }
  if (SCP_REMOTE.test(value)) {
    const separator = value.indexOf(":");
    const host = value.slice(0, separator).split("@").at(-1)?.toLowerCase() ?? "";
    const repository = repositoryPath(value.slice(separator + 1));
    return validHost(host) && repository ? `${host}/${repository}` : null;
  }
  const match = SCHEME.exec(value);
  const transport = match ? TRANSPORTS[match[1]?.toLowerCase() ?? ""] : undefined;
  if (!match || !transport) return null;
  const rest = value.slice(match[0].length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const authority = rest.slice(0, slash);
  const repository = repositoryPath(rest.slice(slash + 1));
  if (!repository) return null;
  const at = authority.lastIndexOf("@");
  const userinfo = at >= 0 ? authority.slice(0, at) : "";
  const hostPort = authority.slice(at + 1);
  let host: string;
  let port = "";
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close < 0) return null;
    host = hostPort.slice(0, close + 1);
    const suffix = hostPort.slice(close + 1);
    if (suffix) {
      if (!suffix.startsWith(":")) return null;
      port = suffix.slice(1);
    }
  } else {
    const separator = hostPort.lastIndexOf(":");
    host = separator >= 0 ? hostPort.slice(0, separator) : hostPort;
    port = separator >= 0 ? hostPort.slice(separator + 1) : "";
  }
  // 凭据不进入项目身份；HTTPS 不允许用户名，SSH 只允许通用的 git 用户。
  if (
    userinfo.includes(":") ||
    (transport === "https" && userinfo !== "") ||
    (transport !== "https" && userinfo !== "" && userinfo !== "git")
  ) {
    return null;
  }
  if (!validHost(host) || (port !== "" && !/^\d{1,5}$/u.test(port))) return null;
  // 与项目清单同步一致：协议、端口和用户名不产生新的仓库身份。
  return `${host.toLowerCase()}/${repository}`;
}
