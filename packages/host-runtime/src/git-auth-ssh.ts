import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { GitSshKey } from "@codexhost/shared-contracts";

const execute = promisify(execFile);
const KEY_TIMEOUT_MS = 20_000;

export interface SshKeyPaths {
  directory: string;
  privateKey: string;
  publicKey: string;
}

export function sshKeyPaths(home: string): SshKeyPaths {
  const directory = path.join(home, "git-ssh");
  return {
    directory,
    privateKey: path.join(directory, "id_ed25519"),
    publicKey: path.join(directory, "id_ed25519.pub"),
  };
}

async function fingerprint(publicKeyPath: string): Promise<string | null> {
  try {
    const result = await execute("ssh-keygen", ["-lf", publicKeyPath], {
      timeout: KEY_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    // 输出形如 `256 SHA256:abc... codexhost (ED25519)`，只保留算法与指纹。
    const parts = result.stdout.trim().split(/\s+/u);
    return parts.length >= 2 ? `${parts[1]}` : null;
  } catch {
    return null;
  }
}

/** 只有私钥真正存在时才把本产品身份交给 Git，否则会挤掉用户已有的 SSH 身份。 */
export async function managedPrivateKey(home: string): Promise<string | null> {
  const paths = sshKeyPaths(home);
  try {
    await readFile(paths.privateKey);
    return paths.privateKey;
  } catch {
    return null;
  }
}

export async function readSshKey(home: string): Promise<GitSshKey> {
  const paths = sshKeyPaths(home);
  try {
    const publicKey = (await readFile(paths.publicKey, "utf8")).trim();
    return {
      exists: true,
      publicKey,
      fingerprint: await fingerprint(paths.publicKey),
    };
  } catch {
    return { exists: false, publicKey: null, fingerprint: null };
  }
}

/**
 * 只生成 ed25519、无口令的部署密钥；口令会让无人值守的 Git 命令挂起。
 * 已存在时不覆盖，避免用户已粘贴到平台的公钥失效。
 */
export async function ensureSshKey(home: string): Promise<{ key: GitSshKey; created: boolean }> {
  const existing = await readSshKey(home);
  if (existing.exists) return { key: existing, created: false };
  const paths = sshKeyPaths(home);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  try {
    await execute(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-N", "", "-C", "codexhost", "-f", paths.privateKey],
      { timeout: KEY_TIMEOUT_MS, maxBuffer: 64 * 1024, windowsHide: true },
    );
  } catch (error) {
    throw new Error(
      `无法生成 SSH 密钥：${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    );
  }
  const key = await readSshKey(home);
  if (!key.exists) throw new Error("SSH 密钥生成后无法读取公钥。");
  return { key, created: true };
}
