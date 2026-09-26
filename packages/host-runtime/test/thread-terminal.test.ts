import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openThreadTerminal,
  ThreadTerminalError,
  threadTerminalResumeCommand,
} from "../src/thread-terminal.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "codexhost-terminal-"));
  cleanup.push(directory);
  return directory;
}

type SpawnedChild = {
  once: (event: "error", listener: (error: Error) => void) => void;
  unref: () => void;
};

function fakeSpawn(child?: Partial<SpawnedChild>) {
  const makeChild = (): SpawnedChild => ({ once: vi.fn(), unref: vi.fn(), ...child });
  return vi.fn<(command: string, arguments_: readonly string[], options: unknown) => SpawnedChild>(
    () => makeChild(),
  );
}

describe("thread terminal", () => {
  it("builds the exact Codex resume command without shell interpolation", () => {
    expect(
      threadTerminalResumeCommand(
        "/Applications/ChatGPT.app/Contents/Resources/codex",
        "019efd3b-5f35-71a1-9b7f-247fd8a79b6a",
        "/Users/zjarlin/project",
      ),
    ).toBe(
      "'/Applications/ChatGPT.app/Contents/Resources/codex' resume '019efd3b-5f35-71a1-9b7f-247fd8a79b6a' -C '/Users/zjarlin/project'",
    );
  });

  it("opens Terminal.app with the official Codex resume command on macOS", async () => {
    const directory = await workspace();
    const spawnTerminal = fakeSpawn();
    const codexPath = path.join(directory, "codex");
    const sessionId = "019efd3b-5f35-71a1-9b7f-247fd8a79b6a";

    const result = await openThreadTerminal(directory, sessionId, codexPath, {
      platform: "darwin",
      spawnTerminal,
    });

    const [, arguments_] = spawnTerminal.mock.calls[0] as unknown as [string, string[], unknown];
    expect(spawnTerminal).toHaveBeenCalledWith("/usr/bin/osascript", ["-e", arguments_[1]], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    expect(arguments_[1]).toContain(`cd '${await realpath(directory)}'`);
    expect(arguments_[1]).toContain(
      `'${codexPath}' resume '${sessionId}' -C '${await realpath(directory)}'`,
    );
    expect(result).toEqual({
      workspace: await realpath(directory),
      terminal: "terminal",
      mode: "resume",
    });
  });

  it("resolves symlinked workspaces before launching a terminal", async () => {
    const directory = await workspace();
    const spawnTerminal = fakeSpawn();

    await openThreadTerminal(path.join(directory, "."), "session-id", "/bin/codex", {
      platform: "darwin",
      spawnTerminal,
    });

    const [, arguments_] = spawnTerminal.mock.calls[0] as unknown as [string, string[], unknown];
    expect(arguments_[1]).toContain(`cd '${await realpath(directory)}'`);
  });

  it("escapes workspace values and rejects shell syntax in session ids", async () => {
    const directory = await workspace();
    const spawnTerminal = fakeSpawn();
    const sessionId = "session-'; touch /tmp/not-written; echo '";

    await expect(
      openThreadTerminal(directory, sessionId, "/tmp/codex path", {
        platform: "darwin",
        spawnTerminal,
      }),
    ).rejects.toThrow("会话 ID 无效");
    expect(spawnTerminal).not.toHaveBeenCalled();
  });

  it("passes the resume command to Linux and Windows terminals", async () => {
    const directory = await workspace();
    const linuxSpawn = fakeSpawn();
    await openThreadTerminal(directory, "session-id", "/opt/codex", {
      platform: "linux",
      spawnTerminal: linuxSpawn,
    });
    expect(linuxSpawn).toHaveBeenCalledWith(
      "x-terminal-emulator",
      [
        "--working-directory",
        await realpath(directory),
        "-e",
        "sh",
        "-lc",
        `'/opt/codex' resume 'session-id' -C '${await realpath(directory)}'`,
      ],
      { detached: true, stdio: "ignore", windowsHide: true },
    );

    const windowsSpawn = fakeSpawn();
    await openThreadTerminal(directory, "session-id", "C:\\Codex\\codex.exe", {
      platform: "win32",
      spawnTerminal: windowsSpawn,
    });
    const [command, arguments_] = windowsSpawn.mock.calls[0] as unknown as [
      string,
      string[],
      unknown,
    ];
    expect(command).toMatch(/cmd\.exe$/i);
    expect(arguments_.slice(0, 9)).toEqual([
      "/d",
      "/s",
      "/c",
      "start",
      "",
      "wt.exe",
      "-d",
      await realpath(directory),
      "powershell.exe",
    ]);
    expect(arguments_[9]).toBe("-NoExit");
    expect(arguments_[10]).toBe("-Command");
    expect(arguments_[11]).toContain("codex.exe");
    expect(arguments_[11]).toContain('resume "session-id"');
    expect(arguments_[11]).toContain(`-C "${await realpath(directory)}"`);
  });

  it("rejects invalid session ids and Codex paths before spawning", async () => {
    const directory = await workspace();
    const spawnTerminal = fakeSpawn();

    await expect(
      openThreadTerminal(directory, " ", "/bin/codex", { platform: "darwin", spawnTerminal }),
    ).rejects.toThrow("会话 ID 无效");
    await expect(
      openThreadTerminal(directory, "session-id", "\0", { platform: "darwin", spawnTerminal }),
    ).rejects.toThrow("Codex 路径无效");
    expect(spawnTerminal).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-directory workspace", async () => {
    const directory = await workspace();
    const file = path.join(directory, "file.txt");
    await writeFile(file, "not a directory\n");

    await expect(
      openThreadTerminal(path.join(directory, "missing"), "session-id", "/bin/codex", {
        platform: "darwin",
        spawnTerminal: fakeSpawn(),
      }),
    ).rejects.toThrow(ThreadTerminalError);
    await expect(
      openThreadTerminal(file, "session-id", "/bin/codex", {
        platform: "darwin",
        spawnTerminal: fakeSpawn(),
      }),
    ).rejects.toThrow("会话工作区不是目录");
  });

  it("reports a spawn failure without claiming success", async () => {
    const directory = await workspace();
    const spawnTerminal = vi.fn(() => {
      throw new Error("no terminal");
    }) as unknown as (
      command: string,
      arguments_: readonly string[],
      options: unknown,
    ) => SpawnedChild;

    await expect(
      openThreadTerminal(directory, "session-id", "/bin/codex", {
        platform: "darwin",
        spawnTerminal,
      }),
    ).rejects.toThrow("无法打开系统终端");
  });
});
