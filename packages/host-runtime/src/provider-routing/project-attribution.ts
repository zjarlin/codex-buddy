import { createHash } from "node:crypto";

interface GatewayProject {
  code: string;
  repository: string;
}

interface CatalogEntry {
  expiresAt: number;
  projects: Promise<GatewayProject[]>;
}

// 与网关仓库标识保持一致：仅在本机规范化，绝不发送原始地址、凭据或工作目录。
function repositoryKey(remote: string): string | null {
  const scp = /^git@([a-zA-Z0-9.-]+):([^\s]+)$/u.exec(remote.trim());
  const value = scp ? `ssh://git@${scp[1]}/${scp[2]}` : remote.trim();
  if (!URL.canParse(value)) {
    return null;
  }
  const url = new URL(value);
  if (
    !["https:", "ssh:"].includes(url.protocol) ||
    !url.hostname ||
    url.password ||
    url.search ||
    url.hash ||
    (url.username && (url.protocol !== "ssh:" || url.username !== "git"))
  ) {
    return null;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  path = path
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "")
    .replace(/^\/+|\/+$/gu, "");
  if (
    !path ||
    /[\s\\]/u.test(path) ||
    path.includes("//") ||
    path.split("/").some((part) => part === "." || part === "..")
  ) {
    return null;
  }
  const host = ["", "443", "22"].includes(url.port)
    ? url.hostname.toLowerCase()
    : url.host.toLowerCase();
  return `${host}/${path}`;
}

export class GatewayProjectAttribution {
  readonly #catalogs = new Map<string, CatalogEntry>();
  #repository: ((threadId: string) => Promise<string | null>) | undefined;

  setRepositoryResolver(resolve: (threadId: string) => Promise<string | null>): void {
    this.#repository = resolve;
  }

  async project(
    baseUrl: string,
    authorization: string | undefined,
    threadId: string,
  ): Promise<string | null> {
    if (!this.#repository || !authorization || !threadId) {
      return null;
    }
    const projects = await this.#catalog(baseUrl, authorization);
    if (!projects.length) {
      return null;
    }
    try {
      const remote = await this.#repository(threadId);
      const repository = remote ? repositoryKey(remote) : null;
      return projects.find((project) => project.repository === repository)?.code ?? null;
    } catch {
      // 无 Git 仓库、无法读取会话时保留未分配，由网关 Key 默认项目兜底。
      return null;
    }
  }

  #catalog(baseUrl: string, authorization: string): Promise<GatewayProject[]> {
    const key = createHash("sha256").update(`${baseUrl}\0${authorization}`).digest("hex");
    const cached = this.#catalogs.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.projects;
    }
    const oldest = this.#catalogs.keys().next().value;
    if (this.#catalogs.size >= 128 && oldest !== undefined) {
      this.#catalogs.delete(oldest);
    }
    const projects = this.#fetch(baseUrl, authorization);
    this.#catalogs.set(key, { expiresAt: Date.now() + 30_000, projects });
    return projects;
  }

  async #fetch(baseUrl: string, authorization: string): Promise<GatewayProject[]> {
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/sub2api/projects`, {
        headers: { authorization, accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return [];
      }
      // 项目目录有大小上限，避免供应商错误返回巨大正文影响模型转发。
      const reader = response.body?.getReader();
      if (!reader) {
        return [];
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        length += value.byteLength;
        if (length > 1024 * 1024) {
          await reader.cancel();
          return [];
        }
        chunks.push(value);
      }
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!result || typeof result !== "object" || !("data" in result)) {
        return [];
      }
      const data = result.data;
      if (
        !data ||
        typeof data !== "object" ||
        !("protocol" in data) ||
        data.protocol !== "sub2api-projects-v1" ||
        !("projects" in data) ||
        !Array.isArray(data.projects)
      ) {
        return [];
      }
      return data.projects.flatMap((project: unknown) => {
        if (
          !project ||
          typeof project !== "object" ||
          !("code" in project) ||
          !("repository" in project) ||
          typeof project.code !== "string" ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(project.code) ||
          typeof project.repository !== "string" ||
          project.repository.length > 500
        ) {
          return [];
        }
        return [{ code: project.code, repository: project.repository }];
      });
    } catch {
      // 能力探测失败不会阻断普通供应商；所有归属仍由网关再次校验。
      return [];
    }
  }
}
