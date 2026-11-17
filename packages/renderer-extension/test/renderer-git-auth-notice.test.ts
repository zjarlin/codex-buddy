import { describe, expect, it, vi } from "vitest";

import { isGitAuthFailure, openGitAccountsSettings } from "../src/renderer-git-sidebar.js";

describe("Git sidebar authentication notice", () => {
  it("recognizes the failures that mean the remote needs a sign-in", () => {
    for (const message of [
      "Git 认证失败：请在设置 → Git 账号中登录该远端主机，或确认账号有仓库访问权限。",
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "fatal: Authentication failed for 'https://gitee.com/zjarlin/demo.git/'",
      "git@github.com: Permission denied (publickey).",
      "remote: HTTP Basic: Access denied",
    ]) {
      expect(isGitAuthFailure(message), message).toBe(true);
    }
  });

  it("does not send non-authentication failures to the account page", () => {
    for (const message of [
      "",
      "fatal: pathspec 'src/app.ts' did not match any file(s) known to git",
      "fatal: couldn't find remote ref feature/missing",
      "error: failed to push some refs (non-fast-forward)",
      "fatal: unable to access 'https://github.com/': Could not resolve host",
    ]) {
      expect(isGitAuthFailure(message), message).toBe(false);
    }
    expect(isGitAuthFailure(null)).toBe(false);
    expect(isGitAuthFailure(undefined)).toBe(false);
  });

  it("opens the Git accounts page through the installed settings shell", () => {
    const openSettings = vi.fn(() => true);
    const opener = {} as HTMLElement;
    expect(openGitAccountsSettings({ __codexhostSettingsShellV1: { openSettings } }, opener)).toBe(
      true,
    );
    expect(openSettings).toHaveBeenCalledWith(opener, "git-accounts");
  });

  it("does nothing when the settings shell is unavailable", () => {
    expect(openGitAccountsSettings(null, {} as HTMLElement)).toBe(false);
    expect(openGitAccountsSettings({}, {} as HTMLElement)).toBe(false);
  });

  it("keeps the notice row visible only while there is something to show", () => {
    // 与侧栏 setNotice 相同的判定：提示文本决定按钮，按钮与提示共同决定整行。
    const visible = (value: string): { notice: boolean; action: boolean; row: boolean } => {
      const notice = Boolean(value);
      const action = isGitAuthFailure(value);
      return { notice, action, row: notice || action };
    };
    expect(visible("")).toEqual({ notice: false, action: false, row: false });
    expect(visible("已推送。")).toEqual({ notice: true, action: false, row: true });
    expect(visible("fatal: Permission denied (publickey).")).toEqual({
      notice: true,
      action: true,
      row: true,
    });
  });
});
