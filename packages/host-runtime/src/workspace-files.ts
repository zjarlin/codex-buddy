import { createHash, randomUUID } from "node:crypto";
import { open, lstat, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  WORKSPACE_DIRECTORY_ENTRY_LIMIT,
  WORKSPACE_FILE_READ_MAX_BYTES,
  WORKSPACE_FILE_WRITE_MAX_BYTES,
  type WorkspaceFileEntry,
  type WorkspaceFileReadResult,
  type WorkspaceFileWriteResult,
  type WorkspaceFilesListResult,
} from "@codexhost/shared-contracts";

export class WorkspaceFilesError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceFilesError";
  }
}

function normalizeRelativePath(value: string): string {
  const candidate = value.trim().replaceAll("\\", "/");
  if (!candidate || candidate === ".") return "";
  if (candidate.startsWith("/") || /^[a-zA-Z]:\//u.test(candidate)) {
    throw new WorkspaceFilesError("文件路径必须是工作区内的相对路径。");
  }
  const segments = candidate.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new WorkspaceFilesError("文件路径不能包含空目录或越级目录。");
  }
  return segments.join("/");
}

async function workspaceRoot(cwd: string): Promise<string> {
  try {
    return await realpath(path.resolve(cwd));
  } catch (error) {
    throw new WorkspaceFilesError("工作区路径不可用。", { cause: error });
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
}

async function resolveWorkspacePath(
  cwd: string,
  relativePath: string,
): Promise<{
  root: string;
  relativePath: string;
  absolutePath: string;
}> {
  const root = await workspaceRoot(cwd);
  const normalized = normalizeRelativePath(relativePath);
  const requested = normalized ? path.join(root, ...normalized.split("/")) : root;
  let resolved: string;
  try {
    resolved = await realpath(requested);
  } catch (error) {
    throw new WorkspaceFilesError(`路径不存在或不可访问：${normalized || "."}`, { cause: error });
  }
  if (resolved !== root && !isInside(root, resolved)) {
    throw new WorkspaceFilesError("文件路径超出工作区范围。");
  }
  return { root, relativePath: normalized, absolutePath: resolved };
}

function entryName(value: string): boolean {
  return value !== ".git";
}

export async function listWorkspaceFiles(
  cwd: string,
  relativePath: string,
): Promise<WorkspaceFilesListResult> {
  const resolved = await resolveWorkspacePath(cwd, relativePath);
  let directory;
  try {
    directory = await readdir(resolved.absolutePath, { withFileTypes: true });
  } catch (error) {
    throw new WorkspaceFilesError("当前路径不是可读取的目录。", { cause: error });
  }
  const entries: WorkspaceFileEntry[] = [];
  let truncated = false;
  for (const entry of directory) {
    if (!entryName(entry.name)) continue;
    if (entries.length >= WORKSPACE_DIRECTORY_ENTRY_LIMIT) {
      truncated = true;
      break;
    }
    const childPath = resolved.relativePath ? `${resolved.relativePath}/${entry.name}` : entry.name;
    const kind = entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file";
    let size: number | null = null;
    if (kind !== "directory") {
      try {
        const info = await lstat(path.join(resolved.absolutePath, entry.name));
        size = info.size;
      } catch {
        size = null;
      }
    }
    entries.push({ name: entry.name, path: childPath, kind, size });
  }
  entries.sort((left, right) => {
    if (left.kind === "directory" && right.kind !== "directory") return -1;
    if (left.kind !== "directory" && right.kind === "directory") return 1;
    return left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" });
  });
  return {
    workspace: resolved.root,
    path: resolved.relativePath,
    entries,
    truncated,
  };
}

function isBinary(content: Buffer): boolean {
  return content.includes(0);
}

function revisionOf(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function readWorkspaceFile(
  cwd: string,
  relativePath: string,
): Promise<WorkspaceFileReadResult> {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) throw new WorkspaceFilesError("不能读取工作区根目录。");
  const resolved = await resolveWorkspacePath(cwd, normalized);
  let info;
  try {
    info = await stat(resolved.absolutePath);
  } catch (error) {
    throw new WorkspaceFilesError("文件不存在或不可访问。", { cause: error });
  }
  if (!info.isFile()) throw new WorkspaceFilesError("当前路径不是普通文件。");
  if (info.size > Number.MAX_SAFE_INTEGER) {
    throw new WorkspaceFilesError("文件大小超出可读取范围。");
  }
  const file = await open(resolved.absolutePath, "r");
  try {
    const buffer = Buffer.alloc(Math.min(info.size, WORKSPACE_FILE_READ_MAX_BYTES));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const content = buffer.subarray(0, bytesRead);
    const binary = isBinary(content);
    return {
      workspace: resolved.root,
      path: resolved.relativePath,
      size: info.size,
      revision: revisionOf(content),
      content: binary ? "" : content.toString("utf8"),
      binary,
      truncated: info.size > bytesRead,
    };
  } finally {
    await file.close();
  }
}

export async function writeWorkspaceFile(
  cwd: string,
  relativePath: string,
  content: string,
  expectedRevision: string,
): Promise<WorkspaceFileWriteResult> {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) throw new WorkspaceFilesError("不能写入工作区根目录。");
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > WORKSPACE_FILE_WRITE_MAX_BYTES) {
    throw new WorkspaceFilesError("文件内容超过 1 MiB 写入上限。");
  }
  const resolved = await resolveWorkspacePath(cwd, normalized);
  let info;
  try {
    info = await lstat(resolved.absolutePath);
  } catch (error) {
    throw new WorkspaceFilesError("文件不存在或不可访问。", { cause: error });
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new WorkspaceFilesError("只能写入工作区中的普通文件。");
  }
  if (info.size > WORKSPACE_FILE_READ_MAX_BYTES) {
    throw new WorkspaceFilesError("文件超过可编辑的大小上限。");
  }
  const current = await open(resolved.absolutePath, "r");
  let previous: Buffer;
  try {
    previous = await current.readFile();
  } finally {
    await current.close();
  }
  if (isBinary(previous)) throw new WorkspaceFilesError("二进制文件不支持编辑。");
  if (revisionOf(previous) !== expectedRevision) {
    throw new WorkspaceFilesError("文件已被其他程序修改，请重新打开后再编辑。");
  }

  const temporaryPath = path.join(
    path.dirname(resolved.absolutePath),
    `.${path.basename(resolved.absolutePath)}.${randomUUID()}.tmp`,
  );
  const temporary = await open(temporaryPath, "wx", info.mode & 0o777);
  try {
    await temporary.writeFile(bytes);
    await temporary.sync();
  } finally {
    await temporary.close();
  }
  try {
    await rename(temporaryPath, resolved.absolutePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw new WorkspaceFilesError("保存文件失败。", { cause: error });
  }
  return {
    workspace: resolved.root,
    path: resolved.relativePath,
    size: bytes.length,
    revision: revisionOf(bytes),
  };
}
