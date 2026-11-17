import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { detectAmbientCredential } from "../src/git-auth-ambient.js";
import { withCredential, withHttpsToken, withSshIdentity } from "../src/git-auth-credentials.js";
import { gitRemoteTarget } from "../src/git-auth-detect.js";
import { GitAuth } from "../src/git-auth.js";
import { GitAuthStore } from "../src/git-auth-store.js";
import { GitWorkspace } from "../src/git-workspace.js";

const execute = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  for (const directory of cleanup.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

/** GIT_SSH_COMMAND 内部把 Windows 路径统一成正斜杠，断言用同一形式。 */
function shellPath(file: string): string {
  return file.replaceAll("\\", "/");
}

/** 夹具地址固定可解析；取不到就直接失败，避免在断言里藏非空断言。 */
function remoteTarget(value: string) {
  const parsed = gitRemoteTarget(value);
  if (!parsed) throw new Error(`Unparsed remote: ${value}`);
  return parsed;
}

function hostNamed<T extends { host: string }>(status: { hosts: readonly T[] }, host: string): T {
  const found = status.hosts.find((entry) => entry.host === host);
  if (!found) throw new Error(`Missing host ${host}`);
  return found;
}

const target = remoteTarget("https://github.com/zjarlin/codex-buddy.git");

describe("Git credential environment", () => {
  it("adds an extraheader scoped to the remote origin", () => {
    const environment = withHttpsToken({ PATH: "/bin" }, target, "x-access-token", "ghp_token");
    expect(environment.GIT_CONFIG_COUNT).toBe("1");
    expect(environment.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    const value = environment.GIT_CONFIG_VALUE_0 ?? "";
    expect(value.startsWith("Authorization: Basic ")).toBe(true);
    expect(Buffer.from(value.split(" ").at(-1) ?? "", "base64").toString()).toBe(
      "x-access-token:ghp_token",
    );
    // 原环境不被修改，凭证只存在于返回的新对象里。
    expect(environment.PATH).toBe("/bin");
  });

  it("appends to existing Git config entries instead of overwriting them", () => {
    const environment = withHttpsToken(
      {
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "a.b",
        GIT_CONFIG_VALUE_0: "1",
        GIT_CONFIG_KEY_1: "c.d",
        GIT_CONFIG_VALUE_1: "2",
      },
      target,
      "git",
      "secret",
    );
    expect(environment.GIT_CONFIG_COUNT).toBe("3");
    expect(environment.GIT_CONFIG_KEY_0).toBe("a.b");
    expect(environment.GIT_CONFIG_KEY_2).toBe("http.https://github.com/.extraheader");
  });

  it("keeps an existing GIT_SSH_COMMAND and adds the managed identity", () => {
    const environment = withSshIdentity({ GIT_SSH_COMMAND: "ssh -F /tmp/config" }, "/keys/id");
    expect(environment.GIT_SSH_COMMAND).toContain("ssh -F /tmp/config");
    expect(environment.GIT_SSH_COMMAND).toContain('"/keys/id"');
    expect(environment.GIT_SSH_COMMAND).toContain("IdentitiesOnly=yes");
  });

  it("uses the SSH identity for SSH remotes even when a token is saved", () => {
    const ssh = remoteTarget("git@github.com:zjarlin/codex-buddy.git");
    const environment = withCredential(
      {},
      ssh,
      { kind: "ambient-token", username: "zjarlin", secret: "ghp_token" },
      "/keys/id",
    );
    expect(environment.GIT_SSH_COMMAND).toContain("/keys/id");
    expect(environment.GIT_CONFIG_COUNT).toBeUndefined();
  });

  it("does not exclude the user's own SSH identities unless SSH sign-in asked for it", () => {
    // 自动补齐身份时排他会挤掉 ~/.ssh 里已配置的密钥，让原本可用的推送失败。
    const fallback = withCredential(
      {},
      remoteTarget("git@github.com:zjarlin/codex-buddy.git"),
      { kind: "ambient-token", username: "zjarlin", secret: "ghp_token" },
      "/keys/id",
      false,
    );
    expect(fallback.GIT_SSH_COMMAND).toContain("/keys/id");
    expect(fallback.GIT_SSH_COMMAND).not.toContain("IdentitiesOnly");

    const explicit = withCredential(
      {},
      remoteTarget("git@github.com:zjarlin/codex-buddy.git"),
      { kind: "ssh-key", username: null, secret: null },
      "/keys/id",
    );
    expect(explicit.GIT_SSH_COMMAND).toContain("IdentitiesOnly=yes");
  });
});

describe("GitAuth self-hosted sign-in", () => {
  it("verifies over the transport the project already uses", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "GET"} ${request.url ?? ""}`);
      if (request.url === "/api/v3/user") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ login: "okm" }));
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const directory = await mkdtemp(path.join(tmpdir(), "codexhost-git-auth-home-"));
      cleanup.push(directory);
      const repositoryPath = await mkdtemp(path.join(tmpdir(), "codexhost-git-auth-repo-"));
      cleanup.push(repositoryPath);
      await execute("git", ["init", "-q", repositoryPath]);
      await execute("git", [
        "-C",
        repositoryPath,
        "remote",
        "add",
        "origin",
        `http://127.0.0.1:${port}/team/platform.git`,
      ]);
      const git = new GitWorkspace({ PATH: process.env.PATH });
      const auth = new GitAuth(directory, { PATH: process.env.PATH }, git);
      // 自建 GitLab 常以 http + 端口部署；验证必须跟随项目已有的协议，而不是硬编码 https。
      const result = await auth.signIn({
        method: "https-token",
        host: `127.0.0.1:${port}`,
        token: "glpat_local",
        cwd: repositoryPath,
      });
      expect(requests).toContain("GET /api/v3/user");
      expect(result.verified).toBe(true);
      expect(result.status.hosts[0]?.account?.verifiedAt).toBeTruthy();
      expect(JSON.stringify(result)).not.toContain("glpat_local");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("GitAuth injection", () => {
  async function repository(remote: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-git-auth-repo-"));
    cleanup.push(directory);
    await execute("git", ["init", "-q", directory]);
    await execute("git", ["-C", directory, "remote", "add", "origin", remote]);
    return directory;
  }

  async function home(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-git-auth-home-"));
    cleanup.push(directory);
    return directory;
  }

  it("injects the saved token for push but not for status", async () => {
    const directory = await home();
    const store = new GitAuthStore(directory);
    await store.save({
      host: "github.com",
      provider: "github",
      method: "https-token",
      token: "ghp_saved",
      username: "x-access-token",
    });
    const repositoryPath = await repository("https://github.com/zjarlin/codex-buddy.git");
    const git = new GitWorkspace({ PATH: process.env.PATH });
    const auth = new GitAuth(directory, { PATH: process.env.PATH }, git);

    const push = await auth.environmentFor(repositoryPath, ["push"], { PATH: process.env.PATH });
    expect(push.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");

    const status = await auth.environmentFor(repositoryPath, ["status"], {
      PATH: process.env.PATH,
    });
    expect(status.GIT_CONFIG_COUNT).toBeUndefined();
  });

  it("leaves Git untouched when no sign-in exists and no managed key was created", async () => {
    const directory = await home();
    const repositoryPath = await repository("git@github.com:zjarlin/codex-buddy.git");
    const git = new GitWorkspace({ PATH: process.env.PATH });
    const auth = new GitAuth(directory, { PATH: process.env.PATH }, git);
    const environment = await auth.environmentFor(repositoryPath, ["push"], {
      PATH: process.env.PATH,
      GIT_SSH_COMMAND: "ssh -F /tmp/custom",
    });
    // 没有本产品密钥时不能注入不存在的 -i，否则 Git 直接拒绝连接。
    expect(environment.GIT_SSH_COMMAND).toBe("ssh -F /tmp/custom");
    expect(environment.GIT_CONFIG_COUNT).toBeUndefined();
  });

  it("adds the managed key without excluding the user's SSH config", async () => {
    const directory = await home();
    const keyDirectory = path.join(directory, "git-ssh");
    await import("node:fs/promises").then((fs) => fs.mkdir(keyDirectory, { recursive: true }));
    await writeFile(path.join(keyDirectory, "id_ed25519"), "synthetic-private-key", {
      mode: 0o600,
    });
    const repositoryPath = await repository("git@github.com:zjarlin/codex-buddy.git");
    const git = new GitWorkspace({ PATH: process.env.PATH });
    const auth = new GitAuth(directory, { PATH: process.env.PATH }, git);
    const environment = await auth.environmentFor(repositoryPath, ["push"], {
      PATH: process.env.PATH,
      GIT_SSH_COMMAND: "ssh -F /tmp/custom",
    });
    expect(environment.GIT_SSH_COMMAND).toContain("ssh -F /tmp/custom");
    expect(environment.GIT_SSH_COMMAND).toContain(shellPath(path.join(keyDirectory, "id_ed25519")));
    expect(environment.GIT_SSH_COMMAND).not.toContain("IdentitiesOnly");
  });

  it("reports the remote host and repositories used by a project", async () => {
    const directory = await home();
    const repositoryPath = await repository("git@github.com:zjarlin/codex-buddy.git");
    const git = new GitWorkspace({ PATH: process.env.PATH });
    const auth = new GitAuth(directory, { PATH: process.env.PATH }, git);
    const status = await auth.status({ cwd: repositoryPath });
    expect(status.hosts.map((host) => host.host)).toContain("github.com");
    const host = hostNamed(status, "github.com");
    expect(host.provider).toBe("github");
    expect(host.hasSshRemote).toBe(true);
    // 仓库根目录取真实路径：Windows 8.3 短名与 macOS 的 /private 前缀都会变。
    expect(host.repositories).toContain(await git.realpath(repositoryPath));
  });

  it("merges HTTPS and SSH remotes of one host into a web-addressable entry", async () => {
    const directory = await home();
    const repositoryPath = await repository("git@github.com:zjarlin/codex-buddy.git");
    await execute("git", [
      "-C",
      repositoryPath,
      "remote",
      "add",
      "mirror",
      "https://github.com/zjarlin/codex-buddy.git",
    ]);
    const git = new GitWorkspace({ PATH: process.env.PATH });
    const auth = new GitAuth(directory, { PATH: process.env.PATH }, git);
    const status = await auth.status({ cwd: repositoryPath });
    const host = hostNamed(status, "github.com");
    // 同一主机只出现一次，站点地址取可打开网页的 HTTPS，SSH 只作为额外事实。
    expect(status.hosts.filter((entry) => entry.host === "github.com")).toHaveLength(1);
    expect(host.webUrl).toBe("https://github.com");
    expect(host.hasSshRemote).toBe(true);
    expect(new Set(host.repositories)).toEqual(new Set([await git.realpath(repositoryPath)]));
  });

  it("keeps a saved host visible after the project stops referencing it", async () => {
    const directory = await home();
    const store = new GitAuthStore(directory);
    await store.save({
      host: "gitee.com",
      provider: "gitee",
      method: "https-token",
      token: "gitee_token",
    });
    const git = new GitWorkspace({ PATH: process.env.PATH });
    const auth = new GitAuth(directory, { PATH: process.env.PATH }, git);
    const status = await auth.status({});
    const host = hostNamed(status, "gitee.com");
    expect(host.state).toBe("signed-in");
    expect(host.source).toBe("stored");
    expect(host.account?.method).toBe("https-token");
    // 账号摘要不能泄漏令牌原文。
    expect(JSON.stringify(status)).not.toContain("gitee_token");
  });

  it("sends the token to a real HTTP endpoint as an Authorization header", async () => {
    const seen: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      seen.push(request.headers.authorization);
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const directory = await home();
      const store = new GitAuthStore(directory);
      await store.save({
        host: "127.0.0.1",
        provider: "generic",
        method: "https-token",
        token: "local_token",
        username: "git",
      });
      const repositoryPath = await repository(`http://127.0.0.1:${port}/repo.git`);
      const git = new GitWorkspace({ PATH: process.env.PATH });
      const auth = new GitAuth(directory, { PATH: process.env.PATH }, git);
      const environment = await auth.environmentFor(repositoryPath, ["fetch"], {
        PATH: process.env.PATH,
        GIT_TERMINAL_PROMPT: "0",
      });
      await execute("git", ["-C", repositoryPath, "ls-remote", "origin"], {
        env: { ...environment, LC_ALL: "C" },
      }).catch(() => undefined);
      expect(seen).toHaveLength(1);
      const header = seen[0] ?? "";
      expect(header.startsWith("Basic ")).toBe(true);
      expect(Buffer.from(header.slice(6), "base64").toString()).toBe("git:local_token");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reuses a gh hosts.yml entry when no account was saved", async () => {
    const directory = await home();
    const ghConfig = path.join(directory, "gh");
    await import("node:fs/promises").then((fs) => fs.mkdir(ghConfig, { recursive: true }));
    await writeFile(
      path.join(ghConfig, "hosts.yml"),
      [
        "github.com:",
        "    git_protocol: https",
        "    users:",
        "        zjarlin:",
        "    user: zjarlin",
        "    oauth_token: gho_from_cli",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    const repositoryPath = await repository("https://github.com/zjarlin/codex-buddy.git");
    const environment = { PATH: process.env.PATH, GH_CONFIG_DIR: ghConfig };
    const git = new GitWorkspace(environment);
    const auth = new GitAuth(directory, environment, git);

    const status = await auth.status({ cwd: repositoryPath });
    const host = hostNamed(status, "github.com");
    expect(host.state).toBe("ambient");
    expect(host.source).toBe("gh-cli");
    expect(JSON.stringify(status)).not.toContain("gho_from_cli");

    const injected = await auth.environmentFor(repositoryPath, ["push"], environment);
    expect(injected.GIT_CONFIG_VALUE_0 ?? "").toContain(
      Buffer.from("zjarlin:gho_from_cli").toString("base64"),
    );
  });

  it("does not consult the credential helper for SSH remotes", async () => {
    const directory = await home();
    const bin = path.join(directory, "bin");
    const marker = path.join(directory, "helper-called");
    await import("node:fs/promises").then((fs) => fs.mkdir(bin, { recursive: true }));
    // 假的 git 只记录自己被调用：凭据助手会走 `git credential fill`，真去查钥匙串可能挂住。
    await writeFile(
      path.join(bin, "git"),
      `#!/bin/sh\n: > ${JSON.stringify(marker).slice(1, -1)}\nprintf 'username=cli\\npassword=token\\n'\n`,
      { mode: 0o755 },
    );
    const environment = { PATH: bin, GH_CONFIG_DIR: path.join(directory, "gh") };
    const webUrl = new URL("https://github.com");
    expect(
      await detectAmbientCredential("github.com", webUrl, environment, {
        skipCredentialHelper: true,
      }),
    ).toBeNull();
    expect(
      await import("node:fs/promises").then((fs) =>
        fs.access(marker).then(
          () => true,
          () => false,
        ),
      ),
    ).toBe(false);
    // 对照组确认夹具真的会触发助手，否则上面的断言没有意义。
    expect(await detectAmbientCredential("github.com", webUrl, environment)).toMatchObject({
      source: "git-credential",
      token: "token",
    });

    const repositoryPath = await repository("git@github.com:zjarlin/codex-buddy.git");
    const git = new GitWorkspace({ PATH: process.env.PATH });
    const auth = new GitAuth(directory, { PATH: process.env.PATH }, git);
    const injected = await auth.environmentFor(repositoryPath, ["push"], {
      PATH: process.env.PATH,
    });
    expect(injected.GIT_CONFIG_COUNT).toBeUndefined();
  });
});
