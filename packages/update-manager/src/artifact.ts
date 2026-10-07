import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, rm } from "node:fs/promises";

import { artifactDownloadUrls } from "./download-mirrors.js";

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const DOWNLOAD_STALL_TIMEOUT_MS = 15_000;

export interface ArtifactSource {
  url: string;
  sha256: string;
  size?: number;
}

export interface ArtifactDownloadProgress {
  downloadedBytes: number;
  totalBytes: number | undefined;
}

export interface ArtifactDownloadResult {
  bytes: number;
  finalUrl: string;
}

export type ArtifactDownloader = (
  source: ArtifactSource,
  destination: string,
  onProgress?: (progress: ArtifactDownloadProgress) => void | Promise<void>,
) => Promise<ArtifactDownloadResult>;

interface ArtifactDownloadOptions {
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  stallTimeoutMs?: number;
}

class DownloadSourceError extends Error {}

export function validateArtifact(source: ArtifactSource): ArtifactSource {
  const url = new URL(source.url);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("update artifact URL must use HTTPS without credentials");
  }
  if (!SHA256_PATTERN.test(source.sha256)) {
    throw new Error("update artifact SHA-256 must be lowercase hexadecimal");
  }
  if (
    source.size !== undefined &&
    (!Number.isSafeInteger(source.size) || source.size <= 0 || source.size > MAX_ARTIFACT_BYTES)
  ) {
    throw new Error(`update artifact size must be between 1 and ${MAX_ARTIFACT_BYTES} bytes`);
  }
  return source;
}

async function writeChunk(
  file: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await file.write(chunk, offset, chunk.byteLength - offset, position + offset);
    if (result.bytesWritten === 0) throw new Error("update artifact write made no progress");
    offset += result.bytesWritten;
  }
}

async function downloadFromUrl(
  source: ArtifactSource,
  url: string,
  file: Awaited<ReturnType<typeof open>>,
  onProgress: ((progress: ArtifactDownloadProgress) => void | Promise<void>) | undefined,
  options: ArtifactDownloadOptions,
): Promise<ArtifactDownloadResult> {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  async function receive<T>(operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const timeout = setTimeout(
      () => controller.abort(new Error("update artifact download stalled")),
      options.stallTimeoutMs ?? DOWNLOAD_STALL_TIMEOUT_MS,
    );
    timeout.unref();
    try {
      return await operation();
    } catch (error) {
      const reason = signal.aborted ? signal.reason : error;
      throw new DownloadSourceError(reason instanceof Error ? reason.message : String(reason), {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  const response = await receive(() =>
    (options.fetch ?? fetch)(url, {
      redirect: "follow",
      headers: { "accept-encoding": "identity" },
      signal,
    }),
  );
  const reader = response.body?.getReader();
  let complete = false;
  let bytes = 0;
  try {
    if (!response.ok || !reader) {
      throw new DownloadSourceError(`update artifact download failed with HTTP ${response.status}`);
    }
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || finalUrl.username || finalUrl.password) {
      throw new DownloadSourceError("update artifact redirected to a non-HTTPS URL");
    }
    const hash = createHash("sha256");
    while (true) {
      const item = await receive(() => reader.read());
      if (item.done) break;
      const position = bytes;
      bytes += item.value.byteLength;
      if (bytes > (source.size ?? MAX_ARTIFACT_BYTES)) {
        throw new DownloadSourceError("update artifact exceeds expected size limit");
      }
      hash.update(item.value);
      await writeChunk(file, item.value, position);
      await onProgress?.({ downloadedBytes: bytes, totalBytes: source.size });
    }
    signal.throwIfAborted();
    if (bytes === 0 || (source.size !== undefined && bytes !== source.size)) {
      throw new DownloadSourceError(
        `update artifact size mismatch: expected ${source.size}, got ${bytes}`,
      );
    }
    if (hash.digest("hex") !== source.sha256) {
      throw new DownloadSourceError("update artifact SHA-256 mismatch");
    }
    complete = true;
    return { bytes, finalUrl: finalUrl.toString() };
  } finally {
    if (!complete) {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
    }
    reader?.releaseLock();
  }
}

export async function downloadArtifact(
  source: ArtifactSource,
  destination: string,
  onProgress?: (progress: ArtifactDownloadProgress) => void | Promise<void>,
  options: ArtifactDownloadOptions = {},
): Promise<ArtifactDownloadResult> {
  validateArtifact(source);
  options.signal?.throwIfAborted();
  const urls = artifactDownloadUrls(source.url, options.environment ?? process.env);
  const file = await open(destination, "wx", 0o600);
  const errors: string[] = [];
  let succeeded = false;
  try {
    for (const url of urls) {
      options.signal?.throwIfAborted();
      await file.truncate(0);
      await onProgress?.({ downloadedBytes: 0, totalBytes: source.size });
      let result: ArtifactDownloadResult;
      try {
        result = await downloadFromUrl(source, url, file, onProgress, options);
      } catch (error) {
        options.signal?.throwIfAborted();
        if (!(error instanceof DownloadSourceError)) throw error;
        errors.push(`${new URL(url).host}: ${error.message}`);
        continue;
      }
      await file.sync();
      succeeded = true;
      return result;
    }
    throw new Error("update artifact download failed from all sources: " + errors.join("; "));
  } finally {
    try {
      await file.close();
    } finally {
      if (!succeeded) await rm(destination, { force: true });
    }
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

export async function verifyDownloadedArtifact(
  source: ArtifactSource,
  filePath: string,
  result: ArtifactDownloadResult,
): Promise<void> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
    throw new Error("downloaded update artifact is not a non-empty regular file");
  }
  if (metadata.size !== result.bytes) {
    throw new Error("downloaded update artifact size changed after download");
  }
  if (source.size !== undefined && metadata.size !== source.size) {
    throw new Error(`update artifact size mismatch: expected ${source.size}, got ${metadata.size}`);
  }
  const actual = await sha256File(filePath);
  if (actual !== source.sha256) {
    throw new Error(`update artifact SHA-256 mismatch: expected ${source.sha256}, got ${actual}`);
  }
}
