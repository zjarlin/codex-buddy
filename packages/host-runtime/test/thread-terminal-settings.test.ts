import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ThreadTerminalSettingsStore } from "../src/thread-terminal-settings.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Thread terminal settings", () => {
  it("persists the selected terminal across Host instances", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-terminal-settings-"));
    cleanup.push(directory);
    const environment = { CODEXHOST_DATA_DIR: directory };

    await expect(new ThreadTerminalSettingsStore(environment).load()).resolves.toEqual({
      terminalId: null,
    });
    await expect(
      new ThreadTerminalSettingsStore(environment).set({ terminalId: "ghostty" }),
    ).resolves.toEqual({ terminalId: "ghostty" });

    await expect(new ThreadTerminalSettingsStore(environment).load()).resolves.toEqual({
      terminalId: "ghostty",
    });
    await expect(readFile(path.join(directory, "thread-terminal.json"), "utf8")).resolves.toContain(
      '"terminalId": "ghostty"',
    );
  });

  it("rejects arbitrary executables and clears back to the system default", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-terminal-settings-"));
    cleanup.push(directory);
    const store = new ThreadTerminalSettingsStore({ CODEXHOST_DATA_DIR: directory });

    await expect(store.set({ terminalId: "/bin/sh" })).rejects.toThrow();
    await expect(store.set({ terminalId: null })).resolves.toEqual({ terminalId: null });
  });
});
