import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitAuthHost, GitAuthStatus } from "@codexhost/shared-contracts";

vi.mock("../../src/settings/icons.js", () => ({
  createRendererSettingsIcon: () => ({ classList: { add() {} } }),
  isRendererSettingsIconName: () => true,
}));

import {
  createGitAccountsSettingsPage,
  type GitAccountsClient,
} from "../../src/settings/git-accounts-page.js";
import { rendererSettingsMessages } from "../../src/settings/localization.js";

class FakeElement {
  readonly children: unknown[] = [];
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly #listeners = new Map<string, Array<(event?: unknown) => void>>();
  className = "";
  hidden = false;
  href = "";
  rel = "";
  target = "";
  textContent = "";
  type = "";
  value = "";
  disabled = false;
  autocomplete = "";
  spellcheck = true;
  placeholder = "";
  open = false;
  focused = false;
  parent: FakeElement | undefined;

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  append(...children: unknown[]): void {
    for (const child of children) if (child instanceof FakeElement) child.parent = this;
    this.children.push(...children);
  }

  replaceChildren(...children: unknown[]): void {
    this.children.splice(0, this.children.length, ...children);
    for (const child of children) if (child instanceof FakeElement) child.parent = this;
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = undefined;
  }

  addEventListener(name: string, listener: (event?: unknown) => void): void {
    this.#listeners.set(name, [...(this.#listeners.get(name) ?? []), listener]);
  }

  dispatch(name: string, event: unknown = {}): void {
    for (const listener of this.#listeners.get(name) ?? []) listener(event);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttributeNS(_namespace: string, name: string, value: string): void {
    this.setAttribute(name, value);
  }

  showModal(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
    this.dispatch("close");
  }

  focus(): void {
    this.focused = true;
  }
}

class FakeDocument {
  readonly clipboardWriteText = vi.fn(async () => undefined);
  readonly windowListeners: string[] = [];
  readonly defaultView: Window;

  constructor() {
    this.defaultView = {
      navigator: { clipboard: { writeText: this.clipboardWriteText } },
      addEventListener: (name: string) => this.windowListeners.push(name),
      removeEventListener: () => undefined,
    } as unknown as Window;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

function descendants(root: FakeElement): FakeElement[] {
  return [
    root,
    ...root.children.flatMap((child) => (child instanceof FakeElement ? descendants(child) : [])),
  ];
}

function hasClass(element: FakeElement, name: string): boolean {
  return element.className.split(" ").includes(name);
}

function byClass(root: FakeElement, name: string): FakeElement[] {
  return descendants(root).filter((element) => hasClass(element, name));
}

function buttonNamed(root: FakeElement, text: string): FakeElement {
  const button = descendants(root).find(
    (element) => element.tagName === "button" && element.textContent === text,
  );
  if (!button) throw new Error(`Missing button ${text}`);
  return button;
}

function text(root: FakeElement): string {
  return descendants(root)
    .map((element) => element.textContent)
    .filter(Boolean)
    .join(" | ");
}

function host(overrides: Partial<GitAuthHost> & Pick<GitAuthHost, "host">): GitAuthHost {
  return {
    provider: "github",
    webUrl: `https://${overrides.host}`,
    repositories: [],
    state: "signed-out",
    source: null,
    account: null,
    ambientDetail: null,
    sshKey: { exists: false, publicKey: null, fingerprint: null },
    hasSshRemote: false,
    ...overrides,
  };
}

const signedInHost = host({
  host: "github.com",
  state: "signed-in",
  source: "stored",
  repositories: ["/work/app"],
  account: {
    host: "github.com",
    provider: "github",
    method: "https-token",
    username: "zjarlin",
    createdAt: "2026-11-01T00:00:00.000Z",
    verifiedAt: "2026-11-02T00:00:00.000Z",
  },
});
const ambientHost = host({
  host: "gitlab.internal",
  provider: "gitlab",
  webUrl: "https://gitlab.internal",
  state: "ambient",
  source: "glab-cli",
  ambientDetail: "glab 命令行登录态",
});
const signedOutHost = host({
  host: "gitee.com",
  provider: "gitee",
  webUrl: "https://gitee.com",
  repositories: ["/work/other"],
});

const status = (hosts: readonly GitAuthHost[]): GitAuthStatus => ({ hosts: [...hosts] });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function client(initial: GitAuthStatus): GitAccountsClient & {
  readonly inspect: ReturnType<typeof vi.fn>;
  readonly signIn: ReturnType<typeof vi.fn>;
  readonly signOut: ReturnType<typeof vi.fn>;
  readonly sshKey: ReturnType<typeof vi.fn>;
  readonly verify: ReturnType<typeof vi.fn>;
} {
  const inspect = vi.fn(async () => initial);
  const signIn = vi.fn(async () => ({
    status: status([{ ...signedOutHost, state: "signed-in", source: "stored" }]),
    verified: true,
    message: "已登录 gitee。",
  }));
  const signOut = vi.fn(async () => status([ambientHost, signedOutHost]));
  const sshKey = vi.fn(async () => ({
    host: "github.com",
    exists: true,
    publicKey: "ssh-ed25519 AAAAC3Nza codexhost",
    fingerprint: "SHA256:abcdef",
    created: false,
  }));
  const verify = vi.fn(async () => ({
    status: initial,
    verified: true,
    message: "连接成功。",
  }));
  return {
    inspectGitAuth: inspect,
    signInGitAuth: signIn,
    signOutGitAuth: signOut,
    readGitSshKey: sshKey,
    verifyGitAuth: verify,
    inspect,
    signIn,
    signOut,
    sshKey,
    verify,
  };
}

function mount(accounts: GitAccountsClient | null, locale: "zh-CN" | "en" = "zh-CN") {
  const messages = rendererSettingsMessages(locale);
  const page = createGitAccountsSettingsPage(messages, () => accounts);
  const document = new FakeDocument();
  const content = document.createElement("div");
  const scope = new AbortController();
  const unmount = page.mount({
    content,
    signal: scope.signal,
    runLatest: async (
      operation: (signal: AbortSignal) => Promise<unknown>,
      handlers: { success(value: never): void; failure(error: unknown): void },
    ) => {
      try {
        handlers.success((await operation(scope.signal)) as never);
      } catch (error) {
        handlers.failure(error);
      }
    },
  } as unknown as Parameters<typeof page.mount>[0]);
  return { messages, content, document, scope, unmount };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Git accounts settings page", () => {
  it("renders one card per host with its sign-in state", async () => {
    const accounts = client(status([signedInHost, ambientHost, signedOutHost]));
    const { content, messages } = mount(accounts);
    await flush();
    const cards = byClass(content, "settings-git-auth__card");
    expect(cards).toHaveLength(3);
    expect(text(content)).toContain("GitHub · github.com");
    expect(text(content)).toContain("GitLab · gitlab.internal");
    expect(text(content)).toContain("Gitee · gitee.com");
    expect(text(content)).toContain(`${messages.gitAccounts.signedIn} · zjarlin`);
    expect(text(content)).toContain(`${messages.gitAccounts.reused} · glab 命令行登录态`);
    expect(text(content)).toContain(messages.gitAccounts.signedOut);
    expect(text(content)).toContain("/work/app");
    expect(accounts.inspect).toHaveBeenCalledTimes(1);
    const states = byClass(content, "settings-git-auth__state").map(
      (element) => element.dataset.state,
    );
    expect(states).toEqual(["signed-in", "ambient", "signed-out"]);
  });

  it("offers verify and sign out for a saved account, sign in otherwise", async () => {
    const { content, messages } = mount(client(status([signedInHost, signedOutHost])));
    await flush();
    const [saved, missing] = byClass(content, "settings-git-auth__card");
    if (!saved || !missing) throw new Error("Expected two host cards");
    expect(buttonNamed(saved, messages.gitAccounts.verify)).toBeDefined();
    expect(buttonNamed(saved, messages.gitAccounts.signOut)).toBeDefined();
    expect(
      descendants(saved).some((element) => element.textContent === messages.gitAccounts.signIn),
    ).toBe(false);
    expect(buttonNamed(missing, messages.gitAccounts.signIn)).toBeDefined();
    expect(
      descendants(missing).some((element) => element.textContent === messages.gitAccounts.signOut),
    ).toBe(false);
  });

  it("requires a token before calling the Host and refreshes after a successful sign-in", async () => {
    const accounts = client(status([signedOutHost]));
    const { content, messages } = mount(accounts);
    await flush();
    buttonNamed(content, messages.gitAccounts.signIn).dispatch("click");
    const dialog = byClass(content, "settings-git-auth__dialog")[0];
    if (!dialog) throw new Error("Sign-in dialog was not created");
    expect(dialog.open).toBe(true);
    const form = descendants(dialog).find((element) => element.tagName === "form");
    const token = descendants(dialog).find(
      (element) => element.tagName === "input" && element.type === "password",
    );
    if (!form || !token) throw new Error("Sign-in form is incomplete");

    const submit = { preventDefault: vi.fn() };
    form.dispatch("submit", submit);
    expect(submit.preventDefault).toHaveBeenCalled();
    expect(accounts.signIn).not.toHaveBeenCalled();
    const alert = descendants(dialog).find((element) => element.getAttribute("role") === "alert");
    expect(alert?.textContent).toBe(messages.gitAccounts.tokenRequired);

    token.value = "  ghp_typed  ";
    form.dispatch("submit", submit);
    expect(accounts.signIn).toHaveBeenCalledWith({
      method: "https-token",
      host: "gitee.com",
      token: "ghp_typed",
    });
    await flush();
    expect(dialog.open).toBe(false);
    expect(text(content)).toContain("已登录 gitee。");
    expect(byClass(content, "settings-git-auth__state")[0]?.dataset.state).toBe("signed-in");
  });

  it("signs out through the Host and renders the returned status", async () => {
    const accounts = client(status([signedInHost, signedOutHost]));
    const { content, messages } = mount(accounts);
    await flush();
    const [saved] = byClass(content, "settings-git-auth__card");
    if (!saved) throw new Error("Expected a saved host card");
    buttonNamed(saved, messages.gitAccounts.signOut).dispatch("click");
    await flush();
    expect(accounts.signOut).toHaveBeenCalledWith({ host: "github.com" });
    expect(byClass(content, "settings-git-auth__card")).toHaveLength(2);
    expect(text(content)).toContain(messages.gitAccounts.signedOutNotice);
    expect(descendants(content).some((element) => element.dataset.state === "signed-in")).toBe(
      false,
    );
  });

  it("shows the managed public key without exposing private material", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const accounts = client(status([signedInHost]));
    const { content, messages } = mount(accounts);
    await flush();
    buttonNamed(content, messages.gitAccounts.viewSshKey).dispatch("click");
    await flush();
    expect(accounts.sshKey).toHaveBeenCalledWith({ host: "github.com", create: true });
    const dialog = byClass(content, "settings-git-auth__dialog")[0];
    if (!dialog) throw new Error("SSH key dialog was not created");
    expect(text(dialog)).toContain("ssh-ed25519 AAAAC3Nza codexhost");
    expect(text(dialog)).toContain("SHA256:abcdef");
    expect(text(dialog)).not.toContain("PRIVATE KEY");
    // 复制只写公钥，界面不出现私钥路径。
    buttonNamed(dialog, messages.gitAccounts.copyKey).dispatch("click");
    await flush();
    expect(writeText).toHaveBeenCalledWith("ssh-ed25519 AAAAC3Nza codexhost");
    expect(text(content)).toContain(messages.gitAccounts.copied);
  });

  it("reports a missing key instead of opening an empty dialog", async () => {
    const accounts = client(status([signedInHost]));
    accounts.sshKey.mockResolvedValueOnce({
      host: "github.com",
      exists: false,
      publicKey: null,
      fingerprint: null,
      created: false,
    });
    const { content, messages } = mount(accounts);
    await flush();
    buttonNamed(content, messages.gitAccounts.viewSshKey).dispatch("click");
    await flush();
    expect(byClass(content, "settings-git-auth__dialog")).toHaveLength(0);
    expect(text(content)).toContain(messages.gitAccounts.sshKeyUnavailable);
  });

  it("surfaces an unreadable account list instead of staying in the loading state", async () => {
    const accounts = client(status([]));
    accounts.inspect.mockRejectedValueOnce(new Error("Host 未连接"));
    const { content } = mount(accounts);
    await flush();
    expect(byClass(content, "settings-git-auth__error")[0]?.textContent).toBe("Host 未连接");
  });

  it("explains why nothing can be done when the Host has no account support", async () => {
    const { content, messages } = mount(null);
    await flush();
    expect(text(content)).toContain(messages.gitAccounts.unavailable);
  });

  it("localizes the page label and the reused source", async () => {
    const { content, messages } = mount(client(status([ambientHost])), "en");
    await flush();
    expect(messages.gitAccounts.title).toBe("Git accounts");
    expect(text(content)).toContain("Reusing an existing sign-in");
    expect(messages.pageLabels["git-accounts"]).toBe("Git accounts");
  });
});
