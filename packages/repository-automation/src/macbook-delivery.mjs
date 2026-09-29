import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { validateReleaseVersion } from "./release.mjs";

function installer(release) {
  if (release.draft || release.prerelease || !release.tag_name?.startsWith("v")) {
    throw new Error("MacBook delivery requires a published stable release");
  }
  const version = validateReleaseVersion(release.tag_name.slice(1));
  const name = `codex-buddy-${version}-macos-arm64.dmg`;
  const matches = release.assets.filter((asset) => asset.name === name);
  if (matches.length !== 1) throw new Error(`Expected exactly one installer named ${name}`);
  const asset = matches[0];
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`Invalid installer size: ${name}`);
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(asset.digest ?? "")) {
    throw new Error(`Missing GitHub SHA-256 digest: ${name}`);
  }
  return asset;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export async function sendMacbookInstaller({
  asset,
  bytes,
  host = "macbook",
  directory = "/Users/zjarlin/Downloads",
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(host)) throw new Error("Invalid SSH host alias");
  if (!directory.startsWith("/") || /[\r\n\0]/u.test(directory)) {
    throw new Error("Installer destination must be an absolute directory");
  }
  const receiver = await readFile(
    new URL("./macbook-installer-receiver.sh", import.meta.url),
    "utf8",
  );
  const command = [
    "bash",
    "-c",
    receiver,
    "--",
    directory,
    asset.name,
    asset.digest.slice(7),
    asset.size,
  ]
    .map(shellQuote)
    .join(" ");
  const destination = `${directory}/${asset.name}`;
  const output = await new Promise((resolve, reject) => {
    const child = execFile(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "StrictHostKeyChecking=yes",
        host,
        command,
      ],
      { timeout: 180_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`MacBook installer delivery failed: ${stderr.trim() || error.message}`));
        } else {
          resolve(stdout.trim());
        }
      },
    );
    // 远端拒绝访问目录时可能提前关闭输入；保留 SSH 返回的具体失败原因。
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.stdin.end(bytes);
  });
  if (output !== destination) throw new Error("MacBook did not confirm the installer destination");
  return destination;
}

export async function deliverLatestMacbookInstaller({ github, repo, send = sendMacbookInstaller }) {
  const { data: release } = await github.rest.repos.getLatestRelease(repo);
  const asset = installer(release);
  const { data } = await github.request("GET /repos/{owner}/{repo}/releases/assets/{asset_id}", {
    ...repo,
    asset_id: asset.id,
    headers: { accept: "application/octet-stream" },
  });
  const bytes = Buffer.from(data);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.length !== asset.size || digest !== asset.digest) {
    throw new Error(`Downloaded installer failed size or SHA-256 verification: ${asset.name}`);
  }
  // 旧版本的流水线重跑也读取当前 latest；下载期间发布物变化则停止，避免覆盖新版本。
  const { data: latest } = await github.rest.repos.getLatestRelease(repo);
  const current = installer(latest);
  if (latest.id !== release.id || current.id !== asset.id || current.digest !== asset.digest) {
    throw new Error("Latest release changed during download; rerun MacBook delivery");
  }
  const destination = await send({ asset, bytes });
  return { tag: release.tag_name, name: asset.name, digest, destination };
}
