import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { GitWorkspaceStatus } from "@codexhost/shared-contracts";

const execFileAsync = promisify(execFile);
const contents = new Map<string, { stamp: string; hash: string }>();

async function readStagedEntries(workspace: string, paths: string[]) {
  const entries = new Map<string, { mode: string; oid: string }>();
  if (!paths.length) return entries;
  const { stdout } = await execFileAsync(
    "git",
    ["-C", workspace, "ls-files", "--stage", "-z", "--", ...paths],
    { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
  );
  for (const row of stdout.split("\0")) {
    const [, mode, oid, file] = /^(\d{6}) ([0-9a-f]+) 0\t([\s\S]+)$/u.exec(row) ?? [];
    if (mode && oid && file) entries.set(file, { mode, oid });
  }
  return entries;
}

export function gitMessageChanges(status: GitWorkspaceStatus, paths: readonly string[] = []) {
  const changes = status.changes.filter((change) => !change.conflicted);
  if (paths.length) return changes.filter((change) => paths.includes(change.path));
  const staged = changes.filter((change) => change.staged);
  return staged.length ? staged : changes;
}

// 文件数量、mtime 和索引时间都不能代表工作区内容；只读取本次提交涉及的文件。
// 已暂存路径读取索引对象；其余读取工作区，与面板实际提交的内容一致。
export async function readGitMessageRevision(
  status: GitWorkspaceStatus,
  paths: readonly string[] = [],
): Promise<string | null> {
  const changes = gitMessageChanges(status, paths).sort((a, b) => a.path.localeCompare(b.path));
  if (!changes.length || status.conflicts.length) return null;
  const index = await readStagedEntries(
    status.workspace,
    changes.filter((change) => change.staged).map((change) => change.path),
  );
  const objectFormat = status.head
    ? status.head.length === 64
      ? "sha256"
      : "sha1"
    : (
        await execFileAsync("git", ["-C", status.workspace, "rev-parse", "--show-object-format"])
      ).stdout.trim();
  const hash = createHash("sha256").update(JSON.stringify([2, status.head]));
  for (const change of changes) {
    const absolute = path.resolve(status.workspace, change.path);
    if (!absolute.startsWith(`${path.resolve(status.workspace)}${path.sep}`)) {
      throw new Error("提交消息路径超出仓库范围。");
    }
    hash.update(JSON.stringify([change.path, change.originalPath]));
    if (change.staged) {
      const entry = index.get(change.path);
      if (!entry) {
        if (change.indexStatus !== "D") throw new Error("无法读取暂存内容。");
        hash.update("deleted");
      } else if (entry.mode === "160000") {
        hash.update(JSON.stringify(["gitlink", entry.oid]));
      } else if (entry.mode === "120000") {
        hash.update(JSON.stringify(["symlink", entry.oid]));
      } else {
        hash.update(JSON.stringify(["file", entry.mode === "100755", entry.oid]));
      }
      continue;
    }
    const info = await lstat(absolute, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    });
    if (!info) {
      hash.update("deleted");
      continue;
    }
    if (change.submodule) {
      const args =
        change.submodule.status === "uninitialized"
          ? ["-C", status.workspace, "ls-files", "--stage", "--", change.path]
          : ["-C", absolute, "rev-parse", "HEAD"];
      const { stdout } = await execFileAsync("git", args, { timeout: 10_000 });
      const oid =
        change.submodule.status === "uninitialized" ? stdout.split(" ")[1] : stdout.trim();
      hash.update(JSON.stringify(["gitlink", oid]));
      continue;
    }
    if (info.isSymbolicLink()) {
      const target = Buffer.from(await readlink(absolute));
      const oid = createHash(objectFormat)
        .update(`blob ${target.length}\0`)
        .update(target)
        .digest("hex");
      hash.update(JSON.stringify(["symlink", oid]));
      continue;
    }
    if (info.isDirectory()) {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", status.workspace, "ls-files", "--stage", "--", change.path],
        { timeout: 10_000 },
      );
      if (!stdout.startsWith("160000 ")) throw new Error("无法读取提交目录内容。");
      hash.update(JSON.stringify(["gitlink", stdout.split(" ")[1]]));
      continue;
    }
    if (!info.isFile()) throw new Error("无法读取提交文件内容。");
    // ctime 纳入纳秒精度的复用条件，恢复 mtime 或同长度改写仍会重新计算内容 hash。
    const stamp = [
      objectFormat,
      info.dev,
      info.ino,
      info.size,
      info.mtimeNs,
      info.ctimeNs,
      info.mode,
    ].join(":");
    let contentHash =
      contents.get(absolute)?.stamp === stamp ? contents.get(absolute)?.hash : undefined;
    if (!contentHash) {
      const content = createHash(objectFormat).update(`blob ${info.size}\0`);
      for await (const chunk of createReadStream(absolute)) content.update(chunk);
      const after = await lstat(absolute, { bigint: true });
      if (
        [
          objectFormat,
          after.dev,
          after.ino,
          after.size,
          after.mtimeNs,
          after.ctimeNs,
          after.mode,
        ].join(":") !== stamp
      ) {
        throw new Error("检测期间文件内容已变化。");
      }
      contentHash = content.digest("hex");
      contents.delete(absolute);
      contents.set(absolute, { stamp, hash: contentHash });
      if (contents.size > 512) contents.delete(contents.keys().next().value ?? "");
    }
    hash.update(JSON.stringify(["file", Boolean(info.mode & 0o111n), contentHash]));
  }
  return hash.digest("hex");
}
