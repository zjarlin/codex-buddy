import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  defaultGitUsername,
  gitRemoteTarget,
  gitSshKeysUrl,
  gitTokenUrl,
  gitWebUrl,
  namedGitProvider,
  normalizeGitHost,
} from "../src/git-auth-detect.js";
import { GitAuthStore, gitAuthAccountView } from "../src/git-auth-store.js";

const cleanup: string[] = [];

afterEach(async () => {
  for (const directory of cleanup.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function home(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "codexhost-git-auth-"));
  cleanup.push(directory);
  return directory;
}

function firstFile(files: readonly string[]): string {
  const [file] = files;
  if (!file) throw new Error("Expected at least one account file");
  return file;
}

describe("Git remote detection", () => {
  it.each([
    ["https://github.com/zjarlin/codex-buddy.git", "github.com", "https"],
    ["git@github.com:zjarlin/codex-buddy.git", "github.com", "ssh"],
    ["ssh://git@ssh.github.com:443/zjarlin/sub2api.git", "ssh.github.com", "ssh"],
    ["http://192.168.31.250:8000/zjarlin/codex-assets.git", "192.168.31.250", "http"],
  ])("reads host and transport from %s", (remote, host, transport) => {
    const target = gitRemoteTarget(remote);
    expect(target?.host).toBe(host);
    expect(target?.transport).toBe(transport);
  });

  it("keeps the port so a self-hosted site URL stays reachable", () => {
    const target = gitRemoteTarget("http://192.168.31.250:8000/zjarlin/codex-assets.git");
    if (!target) throw new Error("Remote target was not parsed");
    expect(target.port).toBe("8000");
    expect(gitWebUrl(target)).toBe("http://192.168.31.250:8000");
  });

  it("rejects values that are not Git remotes", () => {
    expect(gitRemoteTarget("/srv/repos/local.git")).toBeNull();
    expect(gitRemoteTarget("")).toBeNull();
    expect(gitRemoteTarget("file:///srv/repo")).toBeNull();
  });

  it("normalizes host input with or without a scheme and path", () => {
    expect(normalizeGitHost("github.com")).toEqual({ host: "github.com", port: null });
    expect(normalizeGitHost("https://GitLab.Example.com/group/repo.git")).toEqual({
      host: "gitlab.example.com",
      port: null,
    });
    expect(normalizeGitHost("192.168.31.250:8000")).toEqual({
      host: "192.168.31.250",
      port: "8000",
    });
  });

  it("names the hosted platforms and falls back to generic", () => {
    expect(namedGitProvider("github.com")).toBe("github");
    expect(namedGitProvider("gitee.com")).toBe("gitee");
    expect(namedGitProvider("gitlab.com")).toBe("gitlab");
    expect(namedGitProvider("gitlab.lyokm.cn")).toBe("gitlab");
    expect(namedGitProvider("git.example.com")).toBeNull();
  });

  it("uses the platform token account instead of inventing a username", () => {
    expect(defaultGitUsername("github")).toBe("x-access-token");
    expect(defaultGitUsername("gitlab")).toBe("oauth2");
    expect(defaultGitUsername("gitee")).toBe("");
  });

  it("links to the token and key pages of each platform", () => {
    expect(gitTokenUrl("github", "https://github.com")).toBe("https://github.com/settings/tokens");
    expect(gitTokenUrl("gitee", "https://gitee.com")).toBe(
      "https://gitee.com/profile/personal_access_tokens",
    );
    expect(gitTokenUrl("gitlab", "https://gitlab.lyokm.cn")).toBe(
      "https://gitlab.lyokm.cn/-/user_settings/personal_access_tokens",
    );
    expect(gitSshKeysUrl("gitlab", "https://gitlab.lyokm.cn")).toBe(
      "https://gitlab.lyokm.cn/-/user_settings/ssh_keys",
    );
  });
});

describe("Git account store", () => {
  it("saves a token with owner-only permissions and keeps it out of the view", async () => {
    const directory = await home();
    const store = new GitAuthStore(directory);
    const record = await store.save({
      host: "GitHub.com",
      provider: "github",
      method: "https-token",
      token: "ghp_secret",
      username: "x-access-token",
    });
    expect(record.host).toBe("github.com");
    const records = await store.list(["github.com"]);
    expect(records[0]?.token).toBe("ghp_secret");

    const view = gitAuthAccountView(record);
    expect(JSON.stringify(view)).not.toContain("ghp_secret");
    expect(view).toMatchObject({ host: "github.com", method: "https-token" });

    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(path.join(directory, "git-accounts")),
    );
    expect(files).toHaveLength(1);
    const info = await stat(path.join(directory, "git-accounts", firstFile(files)));
    if (process.platform !== "win32") expect(info.mode & 0o777).toBe(0o600);
  });

  it("keeps createdAt on re-login and records verification time", async () => {
    const directory = await home();
    const store = new GitAuthStore(directory);
    const first = await store.save({
      host: "gitee.com",
      provider: "gitee",
      method: "https-token",
      token: "one",
      username: null,
    });
    const second = await store.save({
      host: "gitee.com",
      provider: "gitee",
      method: "https-token",
      token: "two",
      username: "zjarlin",
    });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.token).toBe("two");
    expect(second.username).toBe("zjarlin");

    const verified = await store.markVerified("gitee.com", "zjarlin");
    expect(verified?.verifiedAt).toBeTruthy();
  });

  it("rejects host names that would escape the account directory", async () => {
    const directory = await home();
    const store = new GitAuthStore(directory);
    await expect(
      store.save({ host: "../escape", provider: "generic", method: "https-token", token: "t" }),
    ).rejects.toThrow(/主机名无效/u);
  });

  it("ignores a corrupted record instead of trusting it", async () => {
    const directory = await home();
    const store = new GitAuthStore(directory);
    const record = await store.save({
      host: "gitlab.lyokm.cn",
      provider: "gitlab",
      method: "https-token",
      token: "glpat-x",
    });
    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(path.join(directory, "git-accounts")),
    );
    const file = path.join(directory, "git-accounts", firstFile(files));
    await writeFile(file, "{not json");
    const reopened = new GitAuthStore(directory);
    expect(await reopened.read("gitlab.lyokm.cn")).toBeNull();
    expect(record.token).toBe("glpat-x");

    // 内容主机与文件名不匹配时同样丢弃，避免记录被复制成另一台主机的登录态。
    await chmod(file, 0o600);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, ...record, host: "other.example.com" }));
    expect(await new GitAuthStore(directory).read("gitlab.lyokm.cn")).toBeNull();
  });

  it("lists stored hosts for hosts the project no longer references", async () => {
    const directory = await home();
    const store = new GitAuthStore(directory);
    await store.save({ host: "github.com", provider: "github", method: "https-token", token: "a" });
    await store.save({ host: "gitee.com", provider: "gitee", method: "ssh-key", token: null });
    const records = await store.storedHosts();
    expect(records.map((record) => record.host).sort()).toEqual(["gitee.com", "github.com"]);
  });

  it("removes only the requested host", async () => {
    const directory = await home();
    const store = new GitAuthStore(directory);
    await store.save({ host: "github.com", provider: "github", method: "https-token", token: "a" });
    await store.save({ host: "gitee.com", provider: "gitee", method: "https-token", token: "b" });
    await store.remove("github.com");
    expect(await new GitAuthStore(directory).read("github.com")).toBeNull();
    expect((await new GitAuthStore(directory).read("gitee.com"))?.token).toBe("b");

    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(path.join(directory, "git-accounts")),
    );
    expect(files).toHaveLength(1);
    expect(
      await readFile(path.join(directory, "git-accounts", firstFile(files)), "utf8"),
    ).toContain("gitee.com");
  });
});
