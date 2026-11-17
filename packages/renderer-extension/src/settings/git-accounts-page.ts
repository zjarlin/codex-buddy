import type {
  GitAuthHost,
  GitAuthResult,
  GitAuthSignInParams,
  GitAuthStatus,
  GitAuthStatusParams,
  GitSshKeyResult,
} from "@codexhost/shared-contracts";

import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import type { RendererSettingsMessages } from "./localization.js";

export interface GitAccountsClient {
  inspectGitAuth(input?: GitAuthStatusParams): Promise<GitAuthStatus>;
  signInGitAuth(input: GitAuthSignInParams): Promise<GitAuthResult>;
  signOutGitAuth(input: { host: string; cwd?: string }): Promise<GitAuthStatus>;
  readGitSshKey(input: { host: string; create: boolean }): Promise<GitSshKeyResult>;
  verifyGitAuth(input: { host: string; cwd?: string }): Promise<GitAuthResult>;
}

/** 各平台的令牌与公钥入口；与 Host 侧识别结果保持一致，只用于打开浏览器。 */
function tokenUrl(host: GitAuthHost): string {
  if (host.provider === "github") {
    return host.webUrl === "https://github.com"
      ? "https://github.com/settings/tokens"
      : `${host.webUrl}/settings/tokens`;
  }
  if (host.provider === "gitee") return "https://gitee.com/profile/personal_access_tokens";
  return `${host.webUrl}/-/user_settings/personal_access_tokens`;
}

function keysUrl(host: GitAuthHost): string {
  if (host.provider === "github") {
    return host.webUrl === "https://github.com"
      ? "https://github.com/settings/keys"
      : `${host.webUrl}/settings/keys`;
  }
  if (host.provider === "gitee") return "https://gitee.com/profile/sshkeys";
  return `${host.webUrl}/-/user_settings/ssh_keys`;
}

function providerLabel(host: GitAuthHost): string {
  if (host.provider === "github") return "GitHub";
  if (host.provider === "gitee") return "Gitee";
  if (host.provider === "gitlab") return "GitLab";
  return host.host;
}

function stateLabel(host: GitAuthHost, words: RendererSettingsMessages["gitAccounts"]): string {
  if (host.state === "signed-in") {
    const who = host.account?.username ?? host.account?.label ?? "";
    return who ? `${words.signedIn} · ${who}` : words.signedIn;
  }
  if (host.state === "ambient") {
    return host.ambientDetail ? `${words.reused} · ${host.ambientDetail}` : words.reused;
  }
  return words.signedOut;
}

export function createGitAccountsSettingsPage(
  messages: RendererSettingsMessages,
  getClient: () => GitAccountsClient | null,
): RendererSettingsPageDefinition {
  const words = messages.gitAccounts;
  const copy = (value: string): Promise<void> =>
    globalThis.navigator?.clipboard?.writeText(value) ?? Promise.resolve();
  return Object.freeze({
    id: "git-accounts",
    label: messages.pageLabels["git-accounts"],
    icon: "git",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const root = document.createElement("div");
      root.className = "settings-git-auth";
      const heading = document.createElement("h2");
      heading.className = "settings-section-label";
      heading.textContent = words.title;
      const description = document.createElement("p");
      description.className = "settings-page-description";
      description.textContent = words.description;
      const list = document.createElement("div");
      list.className = "settings-git-auth__list";
      const notice = document.createElement("p");
      notice.className = "settings-git-auth__notice";
      notice.setAttribute("role", "status");
      notice.hidden = true;
      root.append(heading, description, notice, list);

      let hosts: readonly GitAuthHost[] = [];
      let loading = true;
      let failed: string | null = null;
      const busy = new Set<string>();

      const setNotice = (value: string): void => {
        notice.textContent = value;
        notice.hidden = !value;
      };

      const button = (text: string, kind: "primary" | "secondary" | "danger" = "secondary") => {
        const element = document.createElement("button");
        element.type = "button";
        element.className =
          kind === "primary"
            ? "settings-command-button"
            : kind === "danger"
              ? "settings-command-button settings-command-button--danger"
              : "settings-command-button settings-command-button--secondary";
        element.textContent = text;
        return element;
      };

      const act = (host: GitAuthHost, run: () => Promise<void>): void => {
        if (busy.has(host.host)) return;
        busy.add(host.host);
        render();
        void run().finally(() => {
          busy.delete(host.host);
          render();
        });
      };

      const applyStatus = (status: GitAuthStatus): void => {
        hosts = status.hosts;
        failed = null;
      };

      const signIn = (host: GitAuthHost): void => {
        const dialog = document.createElement("dialog");
        dialog.className =
          "settings-account-dialog settings-credential-dialog settings-git-auth__dialog";
        const form = document.createElement("form");
        const title = document.createElement("h2");
        title.textContent = `${words.signIn} ${providerLabel(host)}`;
        const body = document.createElement("div");
        body.className = "settings-credential-dialog__body";
        const hint = document.createElement("p");
        hint.textContent = words.tokenHint;
        const field = document.createElement("label");
        field.className = "settings-credential-dialog__field";
        const fieldLabel = document.createElement("span");
        fieldLabel.textContent = words.tokenLabel;
        const token = document.createElement("input");
        token.type = "password";
        token.autocomplete = "off";
        token.spellcheck = false;
        token.className =
          "min-h-8 w-full rounded-md border border-settings-border bg-settings-panel px-2 text-sm text-settings-text outline-none focus-visible:border-settings-focus";
        const usernameLabel = document.createElement("span");
        usernameLabel.textContent = words.usernameLabel;
        const username = document.createElement("input");
        username.type = "text";
        username.autocomplete = "off";
        username.placeholder = host.provider === "github" ? "x-access-token" : words.usernameHint;
        username.className = token.className;
        field.append(fieldLabel, token, usernameLabel, username);
        const link = document.createElement("a");
        link.href = tokenUrl(host);
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        link.className = "settings-git-auth__link";
        link.textContent = words.openTokenPage;
        const error = document.createElement("p");
        error.className = "settings-credential-dialog__error";
        error.setAttribute("role", "alert");
        const actions = document.createElement("div");
        actions.className = "settings-credential-dialog__actions";
        const cancel = button(words.cancel);
        const confirm = button(words.signIn, "primary");
        confirm.type = "submit";
        actions.append(cancel, confirm);
        body.append(hint, field, link);
        form.append(title, body, error, actions);
        dialog.append(form);
        root.append(dialog);
        cancel.addEventListener("click", () => {
          dialog.close();
          dialog.remove();
        });
        dialog.addEventListener("close", () => dialog.remove());
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const value = token.value.trim();
          if (!value) {
            error.textContent = words.tokenRequired;
            return;
          }
          confirm.disabled = cancel.disabled = true;
          confirm.textContent = words.working;
          const client = getClient();
          void client
            ?.signInGitAuth({
              method: "https-token",
              host: host.host,
              token: value,
              ...(username.value.trim() ? { username: username.value.trim() } : {}),
            })
            .then((result) => {
              applyStatus(result.status);
              setNotice(result.message);
              dialog.close();
            })
            .catch((cause: unknown) => {
              error.textContent = cause instanceof Error ? cause.message : String(cause);
            })
            .finally(() => {
              confirm.disabled = cancel.disabled = false;
              confirm.textContent = words.signIn;
              render();
            });
        });
        dialog.showModal();
        token.focus();
      };

      const showSshKey = (host: GitAuthHost): void => {
        act(host, async () => {
          const client = getClient();
          if (!client) throw new Error(words.unavailable);
          const result = await client.readGitSshKey({ host: host.host, create: true });
          if (!result.publicKey) {
            setNotice(words.sshKeyUnavailable);
            return;
          }
          const dialog = document.createElement("dialog");
          dialog.className =
            "settings-account-dialog settings-credential-dialog settings-git-auth__dialog";
          const body = document.createElement("div");
          body.className = "settings-credential-dialog__body";
          const title = document.createElement("h2");
          title.textContent = words.sshKeyTitle;
          const hint = document.createElement("p");
          hint.textContent = words.sshKeyHint;
          const key = document.createElement("code");
          key.className = "settings-git-auth__key";
          key.textContent = result.publicKey;
          const meta = document.createElement("p");
          meta.textContent = result.fingerprint
            ? `${words.fingerprint}: ${result.fingerprint}`
            : words.fingerprintUnavailable;
          const link = document.createElement("a");
          link.href = keysUrl(host);
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          link.className = "settings-git-auth__link";
          link.textContent = words.openKeysPage;
          const actions = document.createElement("div");
          actions.className = "settings-credential-dialog__actions";
          const copyKey = button(words.copyKey);
          const close = button(words.close);
          actions.append(copyKey, close);
          body.append(hint, key, meta, link);
          dialog.append(title, body, actions);
          root.append(dialog);
          copyKey.addEventListener("click", () => {
            void copy(result.publicKey ?? "").then(() => setNotice(words.copied));
          });
          close.addEventListener("click", () => {
            dialog.close();
            dialog.remove();
          });
          dialog.addEventListener("close", () => dialog.remove());
          dialog.showModal();
        });
      };

      const enableSsh = (host: GitAuthHost): void => {
        act(host, async () => {
          const client = getClient();
          if (!client) throw new Error(words.unavailable);
          const result = await client.signInGitAuth({ method: "ssh-key", host: host.host });
          applyStatus(result.status);
          setNotice(result.message);
        });
      };

      const verify = (host: GitAuthHost): void => {
        act(host, async () => {
          const client = getClient();
          if (!client) throw new Error(words.unavailable);
          const result = await client.verifyGitAuth({ host: host.host });
          applyStatus(result.status);
          setNotice(result.message);
        });
      };

      const signOut = (host: GitAuthHost): void => {
        act(host, async () => {
          const client = getClient();
          if (!client) throw new Error(words.unavailable);
          applyStatus(await client.signOutGitAuth({ host: host.host }));
          setNotice(words.signedOutNotice);
        });
      };

      const render = (): void => {
        list.replaceChildren();
        if (loading) {
          const waiting = document.createElement("p");
          waiting.className = "settings-page-description";
          waiting.textContent = words.loading;
          list.append(waiting);
          return;
        }
        if (failed) {
          const failure = document.createElement("p");
          failure.className = "settings-git-auth__error";
          failure.textContent = failed;
          list.append(failure);
          return;
        }
        if (hosts.length === 0) {
          const empty = document.createElement("p");
          empty.className = "settings-page-description";
          empty.textContent = words.empty;
          list.append(empty);
          return;
        }
        for (const host of hosts) {
          const card = document.createElement("section");
          card.className = "settings-git-auth__card";
          const head = document.createElement("div");
          head.className = "settings-git-auth__head";
          const identity = document.createElement("div");
          identity.className = "settings-git-auth__identity";
          const name = document.createElement("strong");
          name.textContent = `${providerLabel(host)} · ${host.host}`;
          const state = document.createElement("span");
          state.className = "settings-git-auth__state";
          state.dataset.state = host.state;
          state.textContent = busy.has(host.host) ? words.working : stateLabel(host, words);
          identity.append(name, state);
          const actions = document.createElement("div");
          actions.className = "settings-git-auth__actions";
          const disabled = busy.has(host.host);
          const ssh = button(words.viewSshKey);
          ssh.addEventListener("click", () => showSshKey(host));
          const enable = button(words.enableSshKey);
          enable.addEventListener("click", () => enableSsh(host));
          const sign = button(words.signIn, "primary");
          sign.addEventListener("click", () => signIn(host));
          const check = button(words.verify);
          check.addEventListener("click", () => verify(host));
          const forget = button(words.signOut, "danger");
          forget.addEventListener("click", () => signOut(host));
          for (const element of [sign, check, ssh, enable, forget]) element.disabled = disabled;
          if (host.state === "signed-in") {
            actions.append(check, ssh, forget);
          } else {
            actions.append(sign, ssh, enable);
          }
          head.append(identity, actions);
          card.append(head);
          if (host.account?.verifiedAt) {
            const verified = document.createElement("p");
            verified.className = "settings-git-auth__meta";
            verified.textContent = `${words.verifiedAt}: ${new Date(host.account.verifiedAt).toLocaleString()}`;
            card.append(verified);
          }
          if (host.repositories.length > 0) {
            const repositories = document.createElement("p");
            repositories.className = "settings-git-auth__meta";
            repositories.textContent = host.repositories.join("  ·  ");
            card.append(repositories);
          }
          const keyState = document.createElement("p");
          keyState.className = "settings-git-auth__meta";
          keyState.textContent = host.sshKey.exists ? words.sshKeyReady : words.sshKeyMissing;
          card.append(keyState);
          list.append(card);
        }
      };

      const load = (): void => {
        void context.runLatest(
          async (signal) => {
            const client = getClient();
            if (!client) throw new Error(words.unavailable);
            const status = await client.inspectGitAuth();
            signal.throwIfAborted();
            return status;
          },
          {
            success(status) {
              loading = false;
              applyStatus(status);
              render();
            },
            failure(error) {
              loading = false;
              failed = error instanceof Error ? error.message : String(error);
              render();
            },
          },
        );
      };

      const refreshOnOpen = (): void => {
        if (context.signal.aborted) return;
        const client = getClient();
        if (!client) return;
        void client.inspectGitAuth().then(
          (status) => {
            if (context.signal.aborted) return;
            applyStatus(status);
            render();
          },
          () => undefined,
        );
      };

      const handleFocus = (): void => refreshOnOpen();
      document.defaultView?.addEventListener("focus", handleFocus, { signal: context.signal });

      // 页面根节点必须挂到设置内容区，否则渲染结果只存在于游离节点里。
      context.content.replaceChildren(root);
      render();
      load();
      return () => {
        list.replaceChildren();
        root.remove();
      };
    },
  });
}
