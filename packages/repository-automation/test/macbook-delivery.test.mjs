import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { deliverLatestMacbookInstaller, sendMacbookInstaller } from "../src/macbook-delivery.mjs";

const bytes = Buffer.from("verified installer content\n");
const asset = {
  id: 7,
  name: "codex-buddy-1.2.3-macos-arm64.dmg",
  size: bytes.length,
  digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
};
const release = { id: 1, tag_name: "v1.2.3", draft: false, prerelease: false, assets: [asset] };
const repo = { owner: "zjarlin", repo: "codex-buddy" };
const directories = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function githubFixture() {
  return {
    rest: { repos: { getLatestRelease: vi.fn().mockResolvedValue({ data: release }) } },
    request: vi.fn().mockResolvedValue({ data: bytes }),
  };
}

describe("MacBook release delivery", () => {
  it("downloads and verifies the current latest installer before sending it", async () => {
    const github = githubFixture();
    const destination = `/Users/zjarlin/Downloads/${asset.name}`;
    const send = vi.fn().mockResolvedValue(destination);
    await expect(deliverLatestMacbookInstaller({ github, repo, send })).resolves.toEqual({
      tag: release.tag_name,
      name: asset.name,
      digest: asset.digest,
      destination,
    });
    expect(github.request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/releases/assets/{asset_id}",
      {
        ...repo,
        asset_id: asset.id,
        headers: { accept: "application/octet-stream" },
      },
    );
    expect(send).toHaveBeenCalledWith({ asset, bytes });
  });

  it.each([
    { prerelease: true },
    { draft: true },
    { assets: [] },
    { assets: [asset, asset] },
    { assets: [{ ...asset, digest: null }] },
    { tag_name: "v../../installer" },
  ])("does not send an invalid release %j", async (change) => {
    const github = githubFixture();
    github.rest.repos.getLatestRelease.mockResolvedValue({ data: { ...release, ...change } });
    const send = vi.fn();
    await expect(deliverLatestMacbookInstaller({ github, repo, send })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("preserves the remote downloads when the downloaded artifact is corrupt", async () => {
    const github = githubFixture();
    github.request.mockResolvedValue({ data: Buffer.alloc(bytes.length) });
    const send = vi.fn();
    await expect(deliverLatestMacbookInstaller({ github, repo, send })).rejects.toThrow(
      "verification",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("does not deliver when a release or its asset changes during the download", async () => {
    for (const latest of [
      { ...release, id: 2 },
      { ...release, assets: [{ ...asset, id: 8 }] },
    ]) {
      const github = githubFixture();
      github.rest.repos.getLatestRelease
        .mockResolvedValueOnce({ data: release })
        .mockResolvedValueOnce({ data: latest });
      const send = vi.fn();
      await expect(deliverLatestMacbookInstaller({ github, repo, send })).rejects.toThrow(
        "changed during download",
      );
      expect(send).not.toHaveBeenCalled();
    }
  });
});

async function receiverFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "codexhost-macbook-delivery-"));
  directories.push(root);
  const bin = path.join(root, "bin");
  const directory = path.join(root, "Mac's Downloads 中文");
  await mkdir(bin);
  await mkdir(directory);
  // 仅替换 SSH 传输和设备识别，校验、原子替换及清理运行真实接收脚本。
  await writeFile(path.join(bin, "ssh"), '#!/bin/bash\nexec /bin/bash -c "${@: -1}"\n', {
    mode: 0o755,
  });
  await writeFile(path.join(bin, "uname"), "#!/bin/sh\nprintf 'Darwin arm64\\n'\n", {
    mode: 0o755,
  });
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  return directory;
}

describe.skipIf(process.platform === "win32")("MacBook installer receiver", () => {
  it("keeps only the new product installer and preserves other files, links and directories", async () => {
    const directory = await receiverFixture();
    const old = ["codex-buddy-1.2.2-macos-arm64.dmg", "codex-buddy-1.2.0-buddy.4-macos-x64.dmg"];
    const unrelated = ["other-app.dmg", "Codex.dmg", "codex-buddy-not-a-version-macos-arm64.dmg"];
    await Promise.all(
      [...old, ...unrelated].map((name) => writeFile(path.join(directory, name), "old")),
    );
    await mkdir(path.join(directory, "codex-buddy-0.1.0-macos-arm64.dmg"));
    await symlink("other-app.dmg", path.join(directory, "codex-buddy-0.2.0-macos-arm64.dmg"));
    await expect(sendMacbookInstaller({ asset, bytes, directory })).resolves.toBe(
      `${directory}/${asset.name}`,
    );
    expect(await readFile(path.join(directory, asset.name))).toEqual(bytes);
    expect((await readdir(directory)).sort()).toEqual(
      [
        ...unrelated,
        asset.name,
        "codex-buddy-0.1.0-macos-arm64.dmg",
        "codex-buddy-0.2.0-macos-arm64.dmg",
      ].sort(),
    );
  });

  it.each([{ digest: `sha256:${"0".repeat(64)}` }, { size: bytes.length + 1 }])(
    "retains existing installers when the transferred bytes fail verification %j",
    async (change) => {
      const directory = await receiverFixture();
      await writeFile(path.join(directory, asset.name), "previous installer");
      await expect(
        sendMacbookInstaller({ asset: { ...asset, ...change }, bytes, directory }),
      ).rejects.toThrow("verification");
      expect(await readFile(path.join(directory, asset.name), "utf8")).toBe("previous installer");
      expect(await readdir(directory)).toEqual([asset.name]);
    },
  );

  it("refuses a concurrent delivery without disturbing the active lock or old installer", async () => {
    const directory = await receiverFixture();
    await mkdir(path.join(directory, ".codex-buddy-delivery.lock"));
    await writeFile(path.join(directory, asset.name), "previous installer");
    await expect(sendMacbookInstaller({ asset, bytes, directory })).rejects.toThrow(
      "another Codex Buddy delivery",
    );
    expect(await readFile(path.join(directory, asset.name), "utf8")).toBe("previous installer");
    expect(await readdir(directory)).toContain(".codex-buddy-delivery.lock");
  });

  it("rejects an installer path outside Downloads before writing anything", async () => {
    const directory = await receiverFixture();
    await expect(
      sendMacbookInstaller({ asset: { ...asset, name: "../other.dmg" }, bytes, directory }),
    ).rejects.toThrow("Invalid installer");
    expect(await readdir(directory)).toEqual([]);
  });
});
