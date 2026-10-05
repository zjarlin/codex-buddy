import type { ArtifactSource } from "./artifact.js";
import { requireSemanticVersion } from "./status.js";

export const CODEXHOST_LATEST_RELEASE_URL =
  "https://api.github.com/repos/zjarlin/codex-buddy/releases/latest";

export const CODEXHOST_UPDATE_MANIFEST_URL =
  "https://github.com/zjarlin/codex-buddy/releases/latest/download/codex-buddy-update.json";
const UPDATE_MANIFEST_MAX_BYTES = 256 * 1024;

const SHA256_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/u;
const RELEASE_NOTES_URL_PATTERN =
  /^https:\/\/github\.com\/zjarlin\/codex-buddy\/releases\/tag\/(v[0-9A-Za-z.+-]+)$/u;
const DOWNLOAD_URL_PREFIX = "https://github.com/zjarlin/codex-buddy/releases/download/";

export type InstallerReleaseTarget = "macos-arm64" | "macos-x64" | "windows-x64" | "windows-arm64";
export type ReleaseTarget = InstallerReleaseTarget | "linux-x64" | "linux-arm64";

export interface CodexhostLatestRelease {
  version: string;
  releaseNotes: string | null;
  releaseNotesUrl: string;
  assets: readonly CodexhostReleaseAsset[];
}

export interface CodexhostReleaseAsset {
  name: string;
  size: number;
  digest: string | null;
  downloadUrl: string;
}

export interface SelectedReleaseArtifact {
  name: string;
  source: ArtifactSource;
}

export interface GitHubReleaseFetchOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function releaseAsset(value: unknown): CodexhostReleaseAsset {
  const asset = record(value, "GitHub Release asset");
  if (
    typeof asset.name !== "string" ||
    asset.name.length === 0 ||
    asset.name.length > 160 ||
    !Number.isSafeInteger(asset.size) ||
    (asset.size as number) <= 0 ||
    (asset.size as number) > 2 * 1024 * 1024 * 1024 ||
    (asset.digest != null && typeof asset.digest !== "string") ||
    typeof asset.browser_download_url !== "string" ||
    !asset.browser_download_url.startsWith(DOWNLOAD_URL_PREFIX)
  ) {
    throw new Error("GitHub Release asset is invalid");
  }
  const url = new URL(asset.browser_download_url);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("GitHub Release asset URL is invalid");
  }
  return {
    name: asset.name,
    size: asset.size as number,
    digest: typeof asset.digest === "string" ? asset.digest : null,
    downloadUrl: asset.browser_download_url,
  };
}

export function parseLatestGitHubRelease(value: unknown): CodexhostLatestRelease {
  const release = record(value, "GitHub latest Release");
  if (
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.tag_name !== "string" ||
    !release.tag_name.startsWith("v") ||
    typeof release.html_url !== "string" ||
    (release.body != null && typeof release.body !== "string") ||
    !Array.isArray(release.assets)
  ) {
    throw new Error("GitHub latest Release is invalid");
  }
  const version = requireSemanticVersion(release.tag_name.slice(1));
  const notesMatch = RELEASE_NOTES_URL_PATTERN.exec(release.html_url);
  if (!notesMatch || notesMatch[1] !== release.tag_name) {
    throw new Error("GitHub Release notes URL does not match its tag");
  }
  const releaseNotes =
    typeof release.body === "string" && release.body.trim().length > 0
      ? release.body.slice(0, 20_000)
      : null;
  return Object.freeze({
    version,
    releaseNotes,
    releaseNotesUrl: release.html_url,
    assets: Object.freeze(release.assets.map(releaseAsset)),
  });
}

async function fetchUpdateManifest(
  options: GitHubReleaseFetchOptions,
): Promise<CodexhostLatestRelease> {
  const response = await (options.fetch ?? fetch)(CODEXHOST_UPDATE_MANIFEST_URL, {
    redirect: "follow",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok || !response.body) {
    throw new Error("GitHub update manifest request failed with HTTP " + response.status);
  }
  if (response.url) {
    const url = new URL(response.url);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("GitHub update manifest redirected to an invalid URL");
    }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > UPDATE_MANIFEST_MAX_BYTES) {
        await reader.cancel();
        throw new Error("GitHub update manifest exceeds size limit");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (manifest.schemaVersion !== 1) {
    throw new Error("Unsupported update manifest schema");
  }
  const release = parseLatestGitHubRelease(manifest);
  for (const asset of release.assets) {
    if (
      !SHA256_DIGEST_PATTERN.test(asset.digest ?? "") ||
      asset.downloadUrl !== DOWNLOAD_URL_PREFIX + "v" + release.version + "/" + asset.name
    ) {
      throw new Error("Update manifest asset does not match its release or SHA-256");
    }
  }
  return release;
}

export async function fetchLatestGitHubRelease(
  options: GitHubReleaseFetchOptions = {},
): Promise<CodexhostLatestRelease> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(CODEXHOST_LATEST_RELEASE_URL, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "codexhost-updater",
      "x-github-api-version": "2022-11-28",
    },
    redirect: "error",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (response.status === 403 || response.status === 429) {
    return fetchUpdateManifest(options);
  }
  if (!response.ok)
    throw new Error(`GitHub latest Release request failed with HTTP ${response.status}`);
  return parseLatestGitHubRelease(await response.json());
}

function numericIdentifiers(value: string): [number, number, number] {
  const core = value.split(/[+-]/u, 1)[0] ?? "";
  const parts = core.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareSemanticVersions(leftValue: string, rightValue: string): number {
  const left = requireSemanticVersion(leftValue);
  const right = requireSemanticVersion(rightValue);
  const leftNumbers = numericIdentifiers(left);
  const rightNumbers = numericIdentifiers(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftNumbers[index] ?? 0) - (rightNumbers[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  const leftPrerelease = left.split("-", 2)[1]?.split("+")[0];
  const rightPrerelease = right.split("-", 2)[1]?.split("+")[0];
  if (leftPrerelease === rightPrerelease) return 0;
  if (leftPrerelease === undefined) return 1;
  if (rightPrerelease === undefined) return -1;
  const leftParts = leftPrerelease.split(".");
  const rightParts = rightPrerelease.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function expectedInstallerAssetName(
  version: string,
  target: InstallerReleaseTarget,
): string {
  requireSemanticVersion(version);
  const extension = target.startsWith("macos-") ? "dmg" : "exe";
  return `codex-buddy-${version}-${target}.${extension}`;
}

export function selectInstallerReleaseArtifact(
  release: CodexhostLatestRelease,
  target: InstallerReleaseTarget,
): SelectedReleaseArtifact {
  const name = expectedInstallerAssetName(release.version, target);
  const matches = release.assets.filter((asset) => asset.name === name);
  if (matches.length !== 1) throw new Error(`GitHub Release must contain exactly one ${name}`);
  const asset = matches[0];
  if (!asset) throw new Error(`GitHub Release must contain exactly one ${name}`);
  const digest = asset.digest === null ? null : SHA256_DIGEST_PATTERN.exec(asset.digest);
  const sha256 = digest?.[1];
  if (!sha256) throw new Error(`GitHub Release asset ${name} has no valid SHA-256 digest`);
  const expectedPrefix = `${DOWNLOAD_URL_PREFIX}v${release.version}/`;
  if (!asset.downloadUrl.startsWith(expectedPrefix) || !asset.downloadUrl.endsWith(`/${name}`)) {
    throw new Error(`GitHub Release asset ${name} has an unexpected download URL`);
  }
  return Object.freeze({
    name,
    source: Object.freeze({ url: asset.downloadUrl, sha256, size: asset.size }),
  });
}
