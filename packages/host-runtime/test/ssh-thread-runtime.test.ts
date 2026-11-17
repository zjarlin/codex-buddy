import { describe, expect, it, vi } from "vitest";

import type { DesktopSshConnection } from "../src/desktop-ssh-connection.js";
import { resolveSshCodexRuntime, sshThreadCodexRuntime } from "../src/ssh-thread-runtime.js";

const connection: DesktopSshConnection = { arguments: ["okm252"], authority: "okm252" };

function probeOutput(codexPath: string, codexHome: string): string {
  return `__codexhost_begin__\n${codexPath}\n${codexHome}\n__codexhost_end__\n`;
}

type RunInput = {
  connection: DesktopSshConnection;
  environment: NodeJS.ProcessEnv;
  command: string;
};

describe("SSH Codex runtime probe", () => {
  it("reports the remote executable and CODEX_HOME from the fixed script", async () => {
    const run = vi.fn(async () => probeOutput("/usr/local/bin/codex", "/root/.codex"));
    await expect(resolveSshCodexRuntime(connection, {}, run)).resolves.toEqual({
      codexPath: "/usr/local/bin/codex",
      codexHome: "/root/.codex",
    });
    // 只使用 Desktop 保存的连接参数；远端命令整体加引号后再交给 ssh。
    const [[input]] = run.mock.calls as unknown as [[RunInput]];
    expect(input).toMatchObject({ connection, environment: {} });
    // 脚本在远端自行选择登录 bash，缺 bash 时退回 sh，因此只需要一次连接。
    expect(input.command).toContain("bash -l -c '");
    expect(input.command).toContain("sh -c '");
  });

  it("ignores login-shell banner output around the markers", async () => {
    const run = vi.fn(
      async () =>
        `Welcome to the build machine\nnvm: node not found\n${probeOutput(
          "/home/user/.local/bin/codex",
          "/home/user/.codex",
        )}bye\n`,
    );
    await expect(resolveSshCodexRuntime(connection, {}, run)).resolves.toEqual({
      codexPath: "/home/user/.local/bin/codex",
      codexHome: "/home/user/.codex",
    });
  });

  it("asks the remote script to pick bash or sh in one round trip", async () => {
    const run = vi.fn(async ({ command }: RunInput) => {
      // 远端没有 bash 时，`if command -v bash` 分支不执行，脚本仍然只跑一次。
      expect(command.startsWith("if command -v bash")).toBe(true);
      return probeOutput("/opt/codex", "/home/user/.codex");
    });
    await expect(resolveSshCodexRuntime(connection, {}, run)).resolves.toEqual({
      codexPath: "/opt/codex",
      codexHome: "/home/user/.codex",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects empty or relative answers instead of guessing a path", async () => {
    const missing = vi.fn(async () => probeOutput("", "/root/.codex"));
    await expect(resolveSshCodexRuntime(connection, {}, missing)).rejects.toThrow(
      "未找到 Codex 命令行",
    );

    const relative = vi.fn(async () => probeOutput("codex", "/root/.codex"));
    await expect(resolveSshCodexRuntime(connection, {}, relative)).rejects.toThrow(
      "未找到 Codex 命令行",
    );
  });

  it("reports a missing CODEX_HOME separately from a missing command", async () => {
    const run = vi.fn(async () => probeOutput("/usr/local/bin/codex", ""));
    await expect(resolveSshCodexRuntime(connection, {}, run)).rejects.toThrow("CODEX_HOME");
  });

  it("distinguishes an unreachable connection from a missing Codex install", async () => {
    const unreachable = vi.fn(async () => {
      throw new Error("ssh: connect to host failed");
    });
    await expect(resolveSshCodexRuntime(connection, {}, unreachable)).rejects.toThrow(
      "无法读取 SSH 主机上的 Codex 运行环境",
    );
  });
});

describe("choosing the SSH Codex runtime for one request", () => {
  it("keeps an open-target answer without probing the remote", async () => {
    const run = vi.fn(async () => probeOutput("/probed", "/probed-home"));
    await expect(
      sshThreadCodexRuntime(
        { codexPath: "/remote/bin/codex", codexHome: "/root/.codex" },
        connection,
        {},
        run,
      ),
    ).resolves.toEqual({ codexPath: "/remote/bin/codex", codexHome: "/root/.codex" });
    expect(run).not.toHaveBeenCalled();
  });

  it("probes once when either half is missing instead of mixing sources", async () => {
    const run = vi.fn(async () => probeOutput("/probed/codex", "/probed/home"));
    // 只给一半时不能拼出“半探测、半沿用”的组合。
    await expect(
      sshThreadCodexRuntime({ codexPath: "/remote/bin/codex" }, connection, {}, run),
    ).resolves.toEqual({ codexPath: "/probed/codex", codexHome: "/probed/home" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports the connection failure when the saved SSH connection is gone", async () => {
    await expect(sshThreadCodexRuntime({}, null, {})).rejects.toThrow(
      "无法读取 SSH 主机上的 Codex 运行环境",
    );
  });
});
