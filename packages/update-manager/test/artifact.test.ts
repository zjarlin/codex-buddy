import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadArtifact,
  verifyDownloadedArtifact,
  type ArtifactSource,
} from "../src/artifact.js";

const roots: string[] = [];
const bytes = Buffer.from("verified-installer-fixture");
const source: ArtifactSource = {
  url: "https://github.com/zjarlin/codex-buddy/releases/download/v1.2.3/codex-buddy-1.2.3-macos-arm64.dmg",
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
const firstMirror = "https://gh-proxy.com/" + source.url;
const secondMirror = "https://ghfast.top/" + source.url;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function destination(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexhost-artifact-"));
  roots.push(root);
  return path.join(root, "update.dmg.download");
}

function response(
  body: Uint8Array | ReadableStream<Uint8Array> = bytes,
  url = firstMirror,
  status = 200,
): Response {
  const result = new Response(body instanceof Uint8Array ? new Uint8Array(body) : body, { status });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

describe("artifact download", () => {
  it("downloads from the first mirror without changing trusted metadata", async () => {
    const file = await destination();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response());
    const progress = vi.fn();
    const result = await downloadArtifact(source, file, progress, {
      fetch: fetchImpl,
      environment: {},
    });
    expect(result).toEqual({ bytes: bytes.length, finalUrl: firstMirror });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      firstMirror,
      expect.objectContaining({
        headers: { "accept-encoding": "identity" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(progress).toHaveBeenCalledWith({ downloadedBytes: 0, totalBytes: bytes.length });
    expect(await readFile(file)).toEqual(bytes);
    await expect(verifyDownloadedArtifact(source, file, result)).resolves.toBeUndefined();
  });

  it("falls back through both mirrors to the original GitHub URL", async () => {
    const file = await destination();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(bytes, firstMirror, 503))
      .mockRejectedValueOnce(new TypeError("connection failed"))
      .mockResolvedValueOnce(response(bytes, source.url));
    await expect(
      downloadArtifact(source, file, undefined, { fetch: fetchImpl, environment: {} }),
    ).resolves.toEqual({ bytes: bytes.length, finalUrl: source.url });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      firstMirror,
      secondMirror,
      source.url,
    ]);
    expect(await readFile(file)).toEqual(bytes);
  });

  it.each([
    ["truncated", bytes.subarray(0, 4)],
    ["oversized", Buffer.concat([bytes, bytes])],
    ["tampered", Buffer.from("x".repeat(bytes.length))],
    ["empty", Buffer.alloc(0)],
  ])("rejects a %s mirror response and rewrites the partial file", async (_label, badBytes) => {
    const file = await destination();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(badBytes))
      .mockResolvedValueOnce(response(bytes, secondMirror));
    const progress = vi.fn();
    await expect(
      downloadArtifact(source, file, progress, { fetch: fetchImpl, environment: {} }),
    ).resolves.toMatchObject({ finalUrl: secondMirror });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.filter(([value]) => value.downloadedBytes === 0)).toHaveLength(2);
    expect(await readFile(file)).toEqual(bytes);
  });

  it("recovers from a stream interruption without retaining partial bytes", async () => {
    const file = await destination();
    let emitted = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!emitted) {
          emitted = true;
          controller.enqueue(bytes.subarray(0, 5));
          return;
        }
        controller.error(new Error("stream interrupted"));
      },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(stream))
      .mockResolvedValueOnce(response(bytes, secondMirror));
    await downloadArtifact(source, file, undefined, { fetch: fetchImpl, environment: {} });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await readFile(file)).toEqual(bytes);
  });

  it("cancels an unsafe redirect response before falling back", async () => {
    const file = await destination();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(stream, "http://insecure.example.test/update.dmg"))
      .mockResolvedValueOnce(response(bytes, secondMirror));
    await downloadArtifact(source, file, undefined, { fetch: fetchImpl, environment: {} });
    expect(cancel).toHaveBeenCalledOnce();
    expect(await readFile(file)).toEqual(bytes);
  });

  it("aborts a stalled connection and tries the next mirror", async () => {
    const file = await destination();
    let stalledSignal: AbortSignal | undefined;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            stalledSignal = init?.signal ?? undefined;
            stalledSignal?.addEventListener("abort", () => reject(stalledSignal?.reason), {
              once: true,
            });
          }),
      )
      .mockResolvedValueOnce(response(bytes, secondMirror));
    await expect(
      downloadArtifact(source, file, undefined, {
        fetch: fetchImpl,
        environment: {},
        stallTimeoutMs: 20,
      }),
    ).resolves.toMatchObject({ finalUrl: secondMirror });
    expect(stalledSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("aborts a stalled response body and retries from byte zero", async () => {
    const file = await destination();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) =>
        response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 5));
              init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), {
                once: true,
              });
            },
          }),
        ),
      )
      .mockResolvedValueOnce(response(bytes, secondMirror));
    await downloadArtifact(source, file, undefined, {
      fetch: fetchImpl,
      environment: {},
      stallTimeoutMs: 20,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await readFile(file)).toEqual(bytes);
  });

  it("reports all exhausted sources and removes the owned temporary file", async () => {
    const file = await destination();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) => response(bytes, String(url), 502));
    await expect(
      downloadArtifact(source, file, undefined, { fetch: fetchImpl, environment: {} }),
    ).rejects.toThrow(/gh-proxy\.com.*ghfast\.top.*github\.com/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("honors caller cancellation without trying another source", async () => {
    const file = await destination();
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(
      downloadArtifact(
        source,
        file,
        (progress) => {
          if (progress.downloadedBytes > 0) controller.abort(new Error("caller cancelled"));
        },
        { fetch: fetchImpl, environment: {}, signal: controller.signal },
      ),
    ).rejects.toThrow("caller cancelled");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not retry a failing progress sink", async () => {
    const file = await destination();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(
      downloadArtifact(
        source,
        file,
        (progress) => {
          if (progress.downloadedBytes > 0) throw new Error("status storage unavailable");
        },
        { fetch: fetchImpl, environment: {} },
      ),
    ).rejects.toThrow("status storage unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite or delete a pre-existing destination", async () => {
    const file = await destination();
    await writeFile(file, "existing file");
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      downloadArtifact(source, file, undefined, { fetch: fetchImpl, environment: {} }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe("existing file");
  });

  it("uses only the origin when mirrors are disabled", async () => {
    const file = await destination();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(bytes, source.url));
    await downloadArtifact(source, file, undefined, {
      fetch: fetchImpl,
      environment: { CODEXHOST_UPDATE_DOWNLOAD_MIRRORS: "" },
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([source.url]);
  });
});
