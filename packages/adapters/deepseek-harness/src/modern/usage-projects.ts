import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readMetadata(file: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(file, { encoding: "utf8", signal });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
  try {
    return record(JSON.parse(text));
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    // 元数据可能残缺；请求仍计入，无法证明的项目归属保持未知。
    return {};
  }
}

function sshProject(metadata: Record<string, unknown>): string | null {
  const { host, port = 22, user, remotePath } = metadata;
  if (
    typeof host !== "string" ||
    !host ||
    /[\s/@?#\\]/u.test(host) ||
    typeof remotePath !== "string" ||
    !remotePath.startsWith("/") ||
    /[\0\r\n]/u.test(remotePath) ||
    !Number.isInteger(port) ||
    (port as number) < 1 ||
    (port as number) > 65535 ||
    (user !== undefined && (typeof user !== "string" || /[\0\r\n]/u.test(user)))
  ) {
    return null;
  }
  try {
    const url = new URL(`ssh://${host}`);
    if (!url.hostname || url.port) {
      return null;
    }
    url.port = String(port);
    url.username = typeof user === "string" ? user : "";
    url.pathname = path.posix.normalize(remotePath).split("/").map(encodeURIComponent).join("/");
    const project = url.href.replace(/\/$/u, "");
    return project.length <= 4096 ? project : null;
  } catch {
    return null;
  }
}

export interface DshUsageProjects {
  fingerprint: string;
  resolve(sessionId: string | undefined, cwd: string | undefined): string | null | undefined;
}

/** 只读原生工作区关联；远端占位目录的旧名称通过精确 Session ID 恢复。 */
export async function readDshUsageProjects(
  home: string,
  signal: AbortSignal,
): Promise<DshUsageProjects> {
  const remoteRoot = path.resolve(home, "remote-workspaces");
  const isRemote = (cwd: string): boolean => {
    const relative = path.relative(remoteRoot, path.resolve(cwd));
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  };
  const metadata = await readMetadata(path.join(home, "storages", "workspace.json"), signal);
  const workspaces = record(record(metadata.tables).workspaces);
  const bySession = new Map<string, Set<string>>();
  const byDirectory = new Map<string, string | null>();
  for (const value of Object.values(workspaces)) {
    signal.throwIfAborted();
    const workspace = record(value);
    const directory = workspace.path;
    if (
      typeof directory !== "string" ||
      directory.length > 4096 ||
      !path.isAbsolute(directory) ||
      directory.includes("\0")
    ) {
      continue;
    }
    const canonical = path.resolve(directory);
    if (!byDirectory.has(canonical)) {
      const project = isRemote(canonical)
        ? sshProject(await readMetadata(path.join(canonical, ".remote-ssh.json"), signal))
        : canonical;
      byDirectory.set(canonical, project);
    }
    for (const id of Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []) {
      if (typeof id !== "string" || !id) {
        continue;
      }
      const directories = bySession.get(id) ?? new Set<string>();
      directories.add(canonical);
      bySession.set(id, directories);
    }
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([[...byDirectory], [...bySession].map(([id, dirs]) => [id, [...dirs]])]))
    .digest("hex");
  return {
    fingerprint,
    resolve(sessionId, cwd) {
      // 普通 cwd 是真实目录；不从当前侧栏组织推断历史请求在别的仓库运行。
      if (!cwd || !isRemote(cwd)) {
        return undefined;
      }
      const canonical = path.resolve(cwd);
      if (byDirectory.has(canonical)) {
        return byDirectory.get(canonical) ?? null;
      }
      const directories = sessionId ? bySession.get(sessionId) : undefined;
      if (directories?.size !== 1) {
        return null;
      }
      const directory = [...directories][0];
      return directory ? (byDirectory.get(directory) ?? null) : null;
    },
  };
}
