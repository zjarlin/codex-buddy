import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { createInstallerUpdateManifest } from "../index.mjs";

describe("release update manifest", () => {
  it("hashes each published installer and remote CLI package and binds URLs to the release", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "update-manifest-"));
    try {
      const names = [
        "codex-buddy-1.2.3-macos-arm64.dmg",
        "codex-buddy-1.2.3-windows-x64.exe",
        "codex-buddy-1.2.3-windows-arm64.exe",
        "codexhost-cli-1.2.3.tgz",
        "codexhost-cli-1.2.3-linux-x64.tgz",
        "codexhost-cli-1.2.3-linux-arm64.tgz",
      ];
      const files = names.map((name) => path.join(root, name));
      await Promise.all(files.map((file, index) => writeFile(file, `payload:${names[index]}`)));
      const input = {
        repository: "zjarlin/codex-buddy",
        version: "1.2.3",
        notes: "Release notes",
        files,
      };
      const manifest = await createInstallerUpdateManifest(input);
      expect(manifest).toMatchObject({ schemaVersion: 1, tag_name: "v1.2.3", prerelease: false });
      expect(manifest.assets.map((asset) => asset.name)).toEqual(names);
      for (const asset of manifest.assets) {
        const bytes = Buffer.from(`payload:${asset.name}`);
        expect(asset.digest).toBe("sha256:" + createHash("sha256").update(bytes).digest("hex"));
        expect(asset.size).toBe(bytes.length);
        expect(asset.browser_download_url).toBe(
          "https://github.com/zjarlin/codex-buddy/releases/download/v1.2.3/" + asset.name,
        );
      }
      for (const omitted of files) {
        await expect(
          createInstallerUpdateManifest({
            ...input,
            files: files.filter((file) => file !== omitted),
          }),
        ).rejects.toThrow("exactly one");
      }
      for (const replacement of [
        files[0],
        path.join(root, "codexhost-cli-9.9.9-linux-arm64.tgz"),
      ]) {
        await expect(
          createInstallerUpdateManifest({ ...input, files: [...files.slice(0, -1), replacement] }),
        ).rejects.toThrow("exactly one");
      }
      await writeFile(files.at(-1), "");
      await expect(createInstallerUpdateManifest(input)).rejects.toThrow("nonempty");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
