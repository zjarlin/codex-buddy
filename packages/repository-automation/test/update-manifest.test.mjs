import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { createInstallerUpdateManifest } from "../index.mjs";

describe("installer update manifest", () => {
  it("hashes the actual published installers and binds URLs to the release", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "update-manifest-"));
    try {
      const files = ["macos-arm64.dmg", "windows-x64.exe", "windows-arm64.exe"].map((target) =>
        path.join(root, "codex-buddy-1.2.3-" + target),
      );
      await Promise.all(files.map((file) => writeFile(file, "installer")));
      const input = {
        repository: "zjarlin/codex-buddy",
        version: "1.2.3",
        notes: "Release notes",
        files,
      };
      const manifest = await createInstallerUpdateManifest(input);
      expect(manifest).toMatchObject({ schemaVersion: 1, tag_name: "v1.2.3", prerelease: false });
      const digest = "sha256:" + createHash("sha256").update("installer").digest("hex");
      for (const asset of manifest.assets) {
        expect(asset.digest).toBe(digest);
        expect(asset.size).toBe(9);
        expect(asset.browser_download_url).toBe(
          "https://github.com/zjarlin/codex-buddy/releases/download/v1.2.3/" + asset.name,
        );
      }
      await expect(
        createInstallerUpdateManifest({ ...input, files: files.slice(1) }),
      ).rejects.toThrow("exactly one");
      await expect(
        createInstallerUpdateManifest({ ...input, files: [files[0], files[0], files[2]] }),
      ).rejects.toThrow("exactly one");
      await writeFile(files[0], "");
      await expect(createInstallerUpdateManifest(input)).rejects.toThrow("nonempty");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
