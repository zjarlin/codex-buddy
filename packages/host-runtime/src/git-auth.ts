import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  GitAuthHost,
  GitAuthResult,
  GitAuthSignInParams,
  GitAuthStatus,
  GitAuthStatusParams,
  GitProvider,
  GitSshKeyResult,
} from "@codexhost/shared-contracts";

import { detectAmbientCredential, type AmbientCredential } from "./git-auth-ambient.js";
import {
  defaultGitUsername,
  gitRemoteTarget,
  gitTokenVerificationRequest,
  gitWebUrl,
  namedGitProvider,
  normalizeGitHost,
  type GitRemoteTarget,
} from "./git-auth-detect.js";
import { withCredential, withHttpsToken, type GitCredential } from "./git-auth-credentials.js";
import { ensureSshKey, managedPrivateKey, readSshKey } from "./git-auth-ssh.js";
import { GitAuthStore, type GitAuthRecord } from "./git-auth-store.js";
import { GitWorkspaceError, type GitWorkspace } from "./git-workspace.js";

const execute = promisify(execFile);
const VERIFY_TIMEOUT_MS = 20_000;
const MAX_HOSTS = 50;
const MAX_REPOSITORIES = 200;

/** Host 上不属于任何已保存仓库、但存在登录态时仍需展示的主机。 */
interface RemoteEntry {
  repository: string;
  target: GitRemoteTarget;
}

export interface GitAuthRepositories {
  /** 参与“已引用主机”统计的仓库根目录，通常来自项目关联清单。 */
  readonly repositories: readonly string[];
}

/**
 * 远端登录态的唯一入口。所有 Git 网络命令都要经过这里取得额外环境，
 * 因此“是否登录”只有一个事实来源，界面与命令执行不会各说各话。
 */
export class GitAuth {
  readonly #store: GitAuthStore;

  constructor(
    private readonly home: string,
    private readonly environment: NodeJS.ProcessEnv,
    private readonly git: GitWorkspace,
  ) {
    this.#store = new GitAuthStore(home);
  }

  async #remoteUrls(repository: string): Promise<string[]> {
    try {
      const result = await this.git.remotes(repository);
      return result;
    } catch {
      return [];
    }
  }

  async #entries(repositories: readonly string[]): Promise<RemoteEntry[]> {
    const entries: RemoteEntry[] = [];
    for (const repository of repositories) {
      for (const remote of await this.#remoteUrls(repository)) {
        const target = gitRemoteTarget(remote);
        if (target) entries.push({ repository, target });
      }
    }
    return entries;
  }

  async #provider(target: GitRemoteTarget): Promise<GitProvider> {
    return namedGitProvider(target.host) ?? "generic";
  }

  #webUrl(target: GitRemoteTarget): URL {
    return new URL(gitWebUrl(target));
  }

  /**
   * 主机列表 = 项目引用的主机 ∪ 已保存账号的主机。
   * 已保存但项目不再引用的主机仍要出现，否则用户无法退出或复用。
   */
  async status(input: GitAuthStatusParams = {}): Promise<GitAuthStatus> {
    const stored = await this.#store.storedHosts();
    const repositories = input.cwd ? await this.#linkedRepositories(input.cwd) : [];
    const entries = await this.#entries(repositories);
    const hosts = new Map<
      string,
      { target: GitRemoteTarget; repositories: Set<string>; ssh: boolean }
    >();
    for (const entry of entries) {
      const current = hosts.get(entry.target.host) ?? {
        target: entry.target,
        repositories: new Set<string>(),
        ssh: false,
      };
      // 同一主机的 HTTPS 与 SSH 合并为一条记录：站点地址优先取能访问网页的协议，
      // SSH 只记录“存在 SSH 远端”这一事实。
      if (entry.target.transport !== "ssh" && current.target.transport === "ssh") {
        current.target = entry.target;
      }
      current.ssh ||= entry.target.transport === "ssh";
      current.repositories.add(entry.repository);
      hosts.set(entry.target.host, current);
    }
    for (const record of stored) {
      if (hosts.has(record.host)) continue;
      // 已保存账号的主机没有远端可读时，用 https 作为站点地址来源。
      hosts.set(record.host, {
        target: { host: record.host, port: null, transport: "https" },
        repositories: new Set<string>(),
        ssh: false,
      });
    }
    const result: GitAuthHost[] = [];
    // 契约上限即界面可呈现的上限；超出时截断而不是让整次读取因校验失败而不可用。
    for (const [host, value] of [...hosts]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, MAX_HOSTS)) {
      result.push(
        await this.#hostView(
          host,
          value.target,
          [...value.repositories].slice(0, MAX_REPOSITORIES),
          stored,
          value.ssh,
        ),
      );
    }
    return { hosts: result };
  }

  async #linkedRepositories(cwd: string): Promise<string[]> {
    const root = await this.git.root(cwd).catch(() => null);
    return root ? [root] : [];
  }

  async #hostView(
    host: string,
    target: GitRemoteTarget,
    repositories: string[],
    stored: readonly GitAuthRecord[],
    ssh: boolean,
  ): Promise<GitAuthHost> {
    const record = stored.find((entry) => entry.host === host) ?? null;
    const provider = record?.provider ?? (await this.#provider(target));
    const key = await readSshKey(this.home);
    const base = {
      host,
      provider,
      webUrl: gitWebUrl(target),
      repositories,
      sshKey: { exists: key.exists, publicKey: key.publicKey, fingerprint: key.fingerprint },
      hasSshRemote: ssh,
    };
    if (record) {
      const ambient = await this.#ambient(host, target);
      return {
        ...base,
        state: "signed-in",
        source: "stored",
        account: {
          host: record.host,
          provider: record.provider,
          method: record.method,
          ...(record.username ? { username: record.username } : {}),
          ...(record.label ? { label: record.label } : {}),
          createdAt: record.createdAt,
          verifiedAt: record.verifiedAt,
        },
        ambientDetail: ambient?.detail ?? null,
      };
    }
    const ambient = await this.#ambient(host, target);
    return {
      ...base,
      state: ambient ? "ambient" : "signed-out",
      source: ambient?.source ?? null,
      account: null,
      ambientDetail: ambient?.detail ?? null,
    };
  }

  async #ambient(host: string, target: GitRemoteTarget): Promise<AmbientCredential | null> {
    try {
      return await detectAmbientCredential(host, this.#webUrl(target), this.environment);
    } catch {
      return null;
    }
  }

  async signIn(input: GitAuthSignInParams): Promise<GitAuthResult> {
    const normalized = normalizeGitHost(input.host);
    if (!normalized) throw new GitWorkspaceError("Git 主机名无效。");
    // 项目里已经声明过该主机时沿用它的协议与端口：自建 GitLab 常用 http，
    // 固定按 https 验证会把可用令牌误判为失败。
    // 同一主机既有 HTTPS 又有 SSH 地址时选 HTTPS，站点地址与验证接口才带得上端口。
    const known = input.cwd
      ? (await this.#entries(await this.#linkedRepositories(input.cwd)))
          .filter((entry) => entry.target.host === normalized.host)
          .sort(
            (a, b) => Number(a.target.transport === "ssh") - Number(b.target.transport === "ssh"),
          )[0]
      : undefined;
    const target: GitRemoteTarget = known?.target ?? {
      host: normalized.host,
      port: normalized.port,
      transport: "https",
    };
    const provider = namedGitProvider(normalized.host) ?? "generic";
    if (input.method === "ssh-key") {
      const { key } = await ensureSshKey(this.home);
      await this.#store.save({
        host: normalized.host,
        provider,
        method: "ssh-key",
        username: input.username ?? null,
        token: null,
      });
      return {
        status: await this.status({ ...(input.cwd ? { cwd: input.cwd } : {}) }),
        verified: false,
        message: key.publicKey
          ? `已启用 SSH 密钥。把公钥添加到 ${provider} 后即可推送。`
          : "已启用 SSH 密钥，但公钥不可读。",
      };
    }
    const token = input.token.trim();
    if (!token) throw new GitWorkspaceError("请填写访问令牌。");
    const username = input.username?.trim() || defaultGitUsername(provider) || null;
    const record = await this.#store.save({
      host: normalized.host,
      provider,
      method: "https-token",
      username,
      label: input.label ?? null,
      token,
    });
    const verification = await this.#verifyToken(record, target);
    if (verification.ok) {
      await this.#store.markVerified(normalized.host, verification.username ?? record.username);
    }
    return {
      status: await this.status({ ...(input.cwd ? { cwd: input.cwd } : {}) }),
      verified: verification.ok,
      message: verification.message,
    };
  }

  async signOut(host: string, cwd?: string): Promise<GitAuthStatus> {
    await this.#store.remove(host);
    return this.status({ ...(cwd ? { cwd } : {}) });
  }

  async sshKey(host: string, create: boolean): Promise<GitSshKeyResult> {
    const normalized = normalizeGitHost(host)?.host ?? host.trim().toLowerCase();
    const { key, created } = create
      ? await ensureSshKey(this.home)
      : { key: await readSshKey(this.home), created: false };
    return { host: normalized, ...key, created };
  }

  async verify(host: string, cwd?: string): Promise<GitAuthResult> {
    const normalized = normalizeGitHost(host)?.host ?? host.trim().toLowerCase();
    const repositories = cwd ? await this.#linkedRepositories(cwd) : [];
    const entries = (await this.#entries(repositories)).filter(
      (entry) => entry.target.host === normalized,
    );
    const record = await this.#store.read(normalized);
    const target =
      entries[0]?.target ??
      ({ host: normalized, port: null, transport: "https" } as GitRemoteTarget);
    const provider = record?.provider ?? namedGitProvider(normalized) ?? "generic";
    let verified = false;
    let message: string;
    const repository = entries[0]?.repository;
    if (record?.method === "ssh-key") {
      if (!(await readSshKey(this.home)).exists) {
        message = "尚未生成 SSH 密钥。";
      } else if (!repository) {
        message = "当前项目没有该主机的仓库，无法验证 SSH 连接。";
      } else {
        const remote = await this.git.remoteUrl(repository).catch(() => null);
        const outcome = remote
          ? await this.#lsRemote(repository, remote, {
              kind: "ssh-key",
              username: null,
              secret: null,
            })
          : { ok: false, message: "无法读取该仓库的远端地址。", username: null };
        verified = outcome.ok;
        message = outcome.message;
      }
    } else if (record?.method === "https-token" && record.token) {
      const outcome = await this.#verifyToken(record, target);
      verified = outcome.ok;
      message = outcome.message;
      if (outcome.ok)
        await this.#store.markVerified(normalized, outcome.username ?? record.username);
      if (!outcome.ok && repository) {
        // 平台接口不可达时仍可用真实仓库验证一次，避免把网络问题当成令牌失效。
        const remote = await this.git.remoteUrl(repository).catch(() => null);
        const fallback = remote
          ? await this.#lsRemote(repository, remote, {
              kind: "https-token",
              username: record.username,
              secret: record.token,
            })
          : null;
        if (fallback?.ok) {
          verified = true;
          message = fallback.message;
          await this.#store.markVerified(normalized, record.username);
        }
      }
    } else {
      const ambient = await this.#ambient(normalized, target);
      verified = ambient !== null;
      message = ambient ? `连接成功：复用${ambient.detail}。` : `尚未登录 ${provider}。`;
    }
    return {
      status: await this.status({ ...(cwd ? { cwd } : {}) }),
      verified,
      message,
    };
  }

  async #lsRemote(
    repository: string,
    remote: string,
    credential: GitCredential,
  ): Promise<{ ok: boolean; message: string; username: string | null }> {
    const target = gitRemoteTarget(remote);
    if (!target) return { ok: false, message: "远端地址无法识别。", username: null };
    const managedKey = credential.kind === "ssh-key" ? await managedPrivateKey(this.home) : null;
    const environment = withCredential(
      { ...this.environment, GIT_TERMINAL_PROMPT: "0" },
      target,
      credential,
      managedKey,
      credential.kind === "ssh-key",
    );
    try {
      await execute("git", ["ls-remote", "--heads", remote], {
        cwd: repository,
        env: environment,
        timeout: VERIFY_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      return { ok: true, message: "连接成功，远端可访问。", username: null };
    } catch (error) {
      const detail = ((error as { stderr?: string }).stderr ?? "").trim();
      if (
        /could not read Username|Authentication failed|Permission denied|publickey|access denied/iu.test(
          detail,
        )
      ) {
        return { ok: false, message: "认证被拒绝，请检查令牌或公钥是否有效。", username: null };
      }
      if (/not found|does not exist|repository .* not found/iu.test(detail)) {
        return { ok: false, message: "无法访问该仓库，请确认账号有读取权限。", username: null };
      }
      return {
        ok: false,
        username: null,
        message: detail ? `连接失败：${detail.split("\n")[0]?.slice(0, 200)}` : "连接失败。",
      };
    }
  }

  async #verifyToken(
    record: GitAuthRecord,
    target: GitRemoteTarget,
  ): Promise<{ ok: boolean; message: string; username: string | null }> {
    if (!record.token) return { ok: false, message: "未保存令牌。", username: null };
    const request = gitTokenVerificationRequest(record.provider, gitWebUrl(target), record.token);
    try {
      const response = await fetch(request.url, {
        headers: { ...request.headers, "User-Agent": "codexhost" },
        redirect: "error",
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: "令牌被拒绝，请确认权限范围。", username: null };
      }
      if (!response.ok) {
        return { ok: false, message: `平台接口返回 HTTP ${response.status}。`, username: null };
      }
      const body: unknown = await response.json().catch(() => null);
      const recordBody = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      for (const key of request.loginPaths) {
        const value = recordBody[key];
        if (typeof value === "string" && value.trim()) {
          return { ok: true, message: `已登录 ${value.trim()}。`, username: value.trim() };
        }
      }
      return { ok: true, message: "令牌有效。", username: null };
    } catch (error) {
      return {
        ok: false,
        username: null,
        message: `无法验证令牌：${error instanceof Error ? error.message.slice(0, 120) : String(error)}`,
      };
    }
  }

  /** 网络命令才需要登录态；普通读取不额外查询凭证，避免拖慢状态刷新。 */
  #needsCredential(arguments_: readonly string[]): boolean {
    const verb = arguments_[0];
    return (
      verb === "push" ||
      verb === "fetch" ||
      verb === "pull" ||
      verb === "clone" ||
      verb === "ls-remote" ||
      (verb === "submodule" && arguments_.includes("update"))
    );
  }

  /**
   * 给单次 Git 命令追加认证环境。使用 git 自身配置读远端，
   * 因此 SSH / HTTPS、自定义远程名与分支上游都能覆盖。
   */
  async environmentFor(
    cwd: string,
    arguments_: readonly string[],
    base: NodeJS.ProcessEnv,
  ): Promise<NodeJS.ProcessEnv> {
    if (!this.#needsCredential(arguments_)) return base;
    const remote = await this.#remoteFor(cwd, arguments_).catch(() => null);
    if (!remote) return base;
    const target = gitRemoteTarget(remote);
    if (!target) return base;
    const record = await this.#store.read(target.host);
    // 只有显式启用的 SSH 账号才排他使用本产品密钥；令牌或其他情况仍保留用户已有身份。
    const managedKey = await managedPrivateKey(this.home);
    if (record?.method === "ssh-key" && managedKey) {
      return withCredential(
        base,
        target,
        { kind: "ssh-key", username: null, secret: null },
        managedKey,
        true,
      );
    }
    if (record?.method === "https-token" && record.token && target.transport !== "ssh") {
      return withHttpsToken(
        base,
        target,
        record.username ?? defaultGitUsername(record.provider),
        record.token,
      );
    }
    const ambient =
      record?.method === "https-token" ? null : await this.#ambient(target.host, target);
    if (ambient && target.transport !== "ssh") {
      return withCredential(
        base,
        target,
        { kind: "ambient-token", username: ambient.username, secret: ambient.token },
        managedKey,
      );
    }
    // SSH 远端：有本产品密钥就补一个身份，但不排他，用户自己的 ssh 配置仍然有效。
    return managedKey
      ? withCredential(
          base,
          target,
          { kind: "ssh-key", username: null, secret: null },
          managedKey,
          false,
        )
      : base;
  }

  async #remoteFor(cwd: string, arguments_: readonly string[]): Promise<string | null> {
    if (arguments_[0] === "clone") {
      const index = arguments_.lastIndexOf("--");
      return arguments_[index + 1] ?? null;
    }
    const explicit = arguments_.find(
      (value, index) =>
        index > 0 && !value.startsWith("-") && /^(?:https?:|git@|ssh:)/u.test(value),
    );
    if (explicit) return explicit;
    return this.git.remoteUrl(cwd);
  }
}
