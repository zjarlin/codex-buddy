import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { validateReleaseVersion } from "./release.mjs";

export async function createInstallerUpdateManifest({ repository, version, notes, files }) {
  validateReleaseVersion(version);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("Invalid release repository");
  }
  const expected = ["macos-arm64.dmg", "windows-x64.exe", "windows-arm64.exe"].map(
    (target) => "codex-buddy-" + version + "-" + target,
  );
  const names = files.map((file) => path.basename(file));
  if (
    files.length !== expected.length ||
    expected.some((name) => names.filter((value) => value === name).length !== 1)
  ) {
    throw new Error("Update manifest requires exactly one installer for each release target");
  }
  const tag = "v" + version;
  const releaseUrl = "https://github.com/" + repository + "/releases";
  const assets = await Promise.all(
    files.map(async (file) => {
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.size <= 0) {
        throw new Error("Installer must be a nonempty regular file");
      }
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) {
        hash.update(chunk);
      }
      const name = path.basename(file);
      return {
        name,
        size: metadata.size,
        digest: "sha256:" + hash.digest("hex"),
        browser_download_url: releaseUrl + "/download/" + tag + "/" + name,
      };
    }),
  );
  return {
    schemaVersion: 1,
    tag_name: tag,
    html_url: releaseUrl + "/tag/" + tag,
    draft: false,
    prerelease: version.split("+")[0].includes("-"),
    body: notes.slice(0, 20_000),
    assets,
  };
}
