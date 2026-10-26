import path from "node:path";

const FOLDER_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/iu;
const SCP_REMOTE = /^git@[a-z0-9.-]+:[a-z0-9._/-]+(?:\.git)?$/iu;

// 只接受无凭据的 HTTPS／SSH 远端；显式允许时也接受本机绝对路径。
// 拒绝空白、控制字符、以 - 开头的参数注入形状，以及带用户名密码或转义路径的 URL。
export function normalizeGitRemote(remote: string, allowLocalPath = false): string {
  const value = remote.trim();
  if (!value || value.length > 2048 || /\s|[\x00-\x1f]/u.test(value) || value.startsWith("-")) {
    throw new Error("Invalid Git remote");
  }
  if (SCP_REMOTE.test(value)) {
    if (value.split(":")[1]?.split("/").includes("..")) throw new Error("Invalid Git remote");
    return value;
  }
  if (allowLocalPath && path.isAbsolute(value)) return value;
  const url = new URL(value);
  if (
    !["https:", "ssh:"].includes(url.protocol) ||
    !url.hostname ||
    (url.protocol === "https:" && url.username !== "") ||
    (url.protocol === "ssh:" && url.username !== "" && url.username !== "git") ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname ||
    url.pathname === "/" ||
    /%(?:2f|5c|2e)/iu.test(url.pathname)
  ) {
    throw new Error("Only credential-free HTTPS or SSH Git remotes are supported");
  }
  return value;
}

// 远端目录名同时作为克隆目标目录名，必须能安全落在目标目录内。
export function repositoryDirectoryName(remote: string): string {
  const name =
    remote
      .replace(/\/+$/u, "")
      .replace(/\/?\.git$/iu, "")
      .split(/[/:\\]/u)
      .filter(Boolean)
      .at(-1) ?? "";
  if (!FOLDER_NAME.test(name) || name === "." || name === "..") {
    throw new Error("Remote repository name cannot be used as a local folder");
  }
  return name;
}
