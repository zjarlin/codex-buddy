import { access, chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openThreadWorkspace,
  ThreadWorkspaceError,
  windowsApplicationPath,
} from "../src/thread-workspace.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "codexhost-workspace-"));
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

describe("thread workspace", () => {
  it("opens an SSH folder URI locally without looking up the remote path on disk", async () => {
    const bin = await workspace();
    const code = path.join(bin, "code");
    await writeFile(code, "#!/bin/sh\n");
    await chmod(code, 0o755);
    const spawnApplication = fakeSpawn();
    await openThreadWorkspace("/remote-only/project #1", {
      platform: process.platform,
      environment: { PATH: bin },
      spawnApplication,
      sshAuthority: "okm252",
    });
    expect(spawnApplication.mock.calls[0]?.[1]).toEqual([
      "--reuse-window",
      "--folder-uri",
      "vscode-remote://ssh-remote+okm252/remote-only/project%20%231",
    ]);
  });

  it("opens the resolved workspace with the code CLI", async () => {
    const directory = await workspace();
    const bin = await workspace();
    const code = path.join(bin, "code");
    await writeFile(code, "#!/bin/sh\n");
    await chmod(code, 0o755);
    const spawnApplication = fakeSpawn();

    const result = await openThreadWorkspace(directory, {
      platform: process.platform,
      environment: { PATH: bin },
      spawnApplication,
    });

    const [command, arguments_] = spawnApplication.mock.calls[0] as unknown as [
      string,
      string[],
      unknown,
    ];
    expect(command).toBe(code);
    expect(arguments_).toEqual(["--reuse-window", await realpath(directory)]);
    expect(result).toEqual({ workspace: await realpath(directory), application: "vscode" });
  });

  it("falls back to the macOS application when code is not on PATH", async () => {
    const directory = await workspace();
    const spawnApplication = fakeSpawn();
    const application = "/Applications/Visual Studio Code.app";
    const installed = await access(application).then(
      () => true,
      () => false,
    );
    if (!installed) return;

    await openThreadWorkspace(directory, {
      platform: "darwin",
      environment: { PATH: "/missing" },
      spawnApplication,
    });

    expect(spawnApplication).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-a", application, await realpath(directory)],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
  });

  it("rejects a missing or non-directory workspace before spawning", async () => {
    const directory = await workspace();
    const file = path.join(directory, "file.txt");
    await writeFile(file, "not a directory\n");
    const spawnApplication = fakeSpawn();

    await expect(
      openThreadWorkspace(path.join(directory, "missing"), {
        platform: "darwin",
        environment: { PATH: "/missing" },
        spawnApplication,
      }),
    ).rejects.toThrow(ThreadWorkspaceError);
    await expect(
      openThreadWorkspace(file, {
        platform: "darwin",
        environment: { PATH: "/missing" },
        spawnApplication,
      }),
    ).rejects.toThrow("会话工作区不是目录");
    expect(spawnApplication).not.toHaveBeenCalled();
  });

  it("does not treat a non-executable code file on PATH as VS Code", async () => {
    const directory = await workspace();
    const bin = await workspace();
    await writeFile(path.join(bin, "code"), "not executable\n");
    const spawnApplication = fakeSpawn();

    await expect(
      openThreadWorkspace(directory, {
        platform: "linux",
        environment: { PATH: bin },
        spawnApplication,
      }),
    ).rejects.toThrow("未安装 Visual Studio Code");
    expect(spawnApplication).not.toHaveBeenCalled();
  });

  it("resolves the standard Windows VS Code installation path", () => {
    expect(
      windowsApplicationPath("Programs\\Microsoft VS Code\\Code.exe", {
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe");
  });

  it("reports a missing VS Code installation without claiming success", async () => {
    const directory = await workspace();
    const spawnApplication = fakeSpawn();

    await expect(
      openThreadWorkspace(directory, {
        platform: "linux",
        environment: { PATH: "/missing" },
        spawnApplication,
      }),
    ).rejects.toThrow("未安装 Visual Studio Code");
    expect(spawnApplication).not.toHaveBeenCalled();
  });

  it("reports a spawn failure without claiming success", async () => {
    const directory = await workspace();
    const bin = await workspace();
    const code = path.join(bin, "code");
    await writeFile(code, "#!/bin/sh\n");
    await chmod(code, 0o755);
    const spawnApplication = vi.fn(() => {
      throw new Error("no vscode");
    }) as unknown as (
      command: string,
      arguments_: readonly string[],
      options: unknown,
    ) => SpawnedChild;

    await expect(
      openThreadWorkspace(directory, {
        platform: process.platform,
        environment: { PATH: bin },
        spawnApplication,
      }),
    ).rejects.toThrow("无法打开 Visual Studio Code");
    expect(spawnApplication).toHaveBeenCalled();
  });
});
