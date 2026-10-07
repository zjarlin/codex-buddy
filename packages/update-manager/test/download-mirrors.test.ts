import { describe, expect, it } from "vitest";

import { artifactDownloadUrls } from "../src/download-mirrors.js";

const source =
  "https://github.com/zjarlin/codex-buddy/releases/download/v1.2.3/codex-buddy-1.2.3-macos-arm64.dmg";

describe("update download mirrors", () => {
  it("tries default mirrors before the original GitHub URL", () => {
    expect(artifactDownloadUrls(source, {})).toEqual([
      "https://gh-proxy.com/" + source,
      "https://ghfast.top/" + source,
      source,
    ]);
  });

  it("normalizes configured prefixes, preserves their order and removes duplicates", () => {
    expect(
      artifactDownloadUrls(source, {
        CODEXHOST_UPDATE_DOWNLOAD_MIRRORS:
          " https://mirror.example.test, https://other.example.test/github, https://mirror.example.test/ ",
      }),
    ).toEqual([
      "https://mirror.example.test/" + source,
      "https://other.example.test/github/" + source,
      source,
    ]);
  });

  it.each(["", "   ", ", ,"])("disables mirrors when configured as %j", (configured) => {
    expect(artifactDownloadUrls(source, { CODEXHOST_UPDATE_DOWNLOAD_MIRRORS: configured })).toEqual(
      [source],
    );
  });

  it.each([
    "http://mirror.example.test/",
    "https://user:password@mirror.example.test/",
    "https://mirror.example.test/?token=secret",
    "https://mirror.example.test/#fragment",
    "not-a-url",
  ])("rejects an unsafe mirror prefix %s", (mirror) => {
    expect(() =>
      artifactDownloadUrls(source, { CODEXHOST_UPDATE_DOWNLOAD_MIRRORS: mirror }),
    ).toThrow();
  });

  it.each([
    "https://downloads.example.test/app.dmg",
    source.replace("/zjarlin/", "/someone-else/"),
    source.replace("github.com/", "github.com.example.test/"),
    source.replace("/releases/download/", "/releases/latest/download/"),
    source + "?token=secret",
    source + "#fragment",
    source.replace("https://", "https://user:password@"),
  ])("does not forward unrelated or credential-bearing URLs: %s", (url) => {
    expect(
      artifactDownloadUrls(url, { CODEXHOST_UPDATE_DOWNLOAD_MIRRORS: "invalid-unused-mirror" }),
    ).toEqual([url]);
  });
});
