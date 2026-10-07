const DEFAULT_DOWNLOAD_MIRRORS = ["https://gh-proxy.com/", "https://ghfast.top/"] as const;

export function artifactDownloadUrls(
  sourceUrl: string,
  environment: NodeJS.ProcessEnv,
): readonly string[] {
  const source = new URL(sourceUrl);
  if (
    source.origin !== "https://github.com" ||
    !source.pathname.startsWith("/zjarlin/codex-buddy/releases/download/") ||
    source.username ||
    source.password ||
    source.search ||
    source.hash
  ) {
    return [sourceUrl];
  }

  const configured = environment.CODEXHOST_UPDATE_DOWNLOAD_MIRRORS;
  const mirrors =
    configured === undefined
      ? DEFAULT_DOWNLOAD_MIRRORS
      : configured
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
  const urls = mirrors.map((mirror) => {
    const prefix = new URL(mirror);
    if (
      prefix.protocol !== "https:" ||
      prefix.username ||
      prefix.password ||
      prefix.search ||
      prefix.hash
    ) {
      throw new Error(
        "update download mirror must use HTTPS without credentials, query or fragment",
      );
    }
    const base = prefix.href.endsWith("/") ? prefix.href : prefix.href + "/";
    return base + sourceUrl;
  });
  return [...new Set([...urls, sourceUrl])];
}
