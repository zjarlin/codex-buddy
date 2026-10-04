import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ThreadFoldersSettingsStore } from "../src/thread-folders-settings.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const config = {
  version: 1 as const,
  projects: {
    '["local","local","project"]': {
      folders: [{ id: "folder-a", name: "计划" }],
      assignments: { "thread-a": "folder-a" },
      selected: "folder-a",
    },
  },
};

const unfiledConfig = {
  version: 1 as const,
  projects: {
    project: {
      folders: [{ id: "todo", name: "待办" }],
      assignments: {},
      selected: "__unfiled__",
    },
  },
};

describe("Thread folder settings", () => {
  it("persists per-project folder assignments across Host instances", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-thread-folders-"));
    cleanup.push(directory);
    const environment = { CODEXHOST_DATA_DIR: directory };

    await expect(new ThreadFoldersSettingsStore(environment).load()).resolves.toEqual({
      config: null,
    });
    await expect(new ThreadFoldersSettingsStore(environment).set(config)).resolves.toEqual({
      config,
    });
    await expect(new ThreadFoldersSettingsStore(environment).load()).resolves.toEqual({ config });
    await expect(readFile(path.join(directory, "thread-folders.json"), "utf8")).resolves.toContain(
      '"folder-a"',
    );
  });

  it("rejects dangling folder assignments", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-thread-folders-"));
    cleanup.push(directory);
    const environment = { CODEXHOST_DATA_DIR: directory };
    await writeFile(
      path.join(directory, "thread-folders.json"),
      JSON.stringify({
        version: 1,
        projects: {
          project: {
            folders: [],
            assignments: { "thread-a": "missing" },
            selected: null,
          },
        },
      }),
    );

    await expect(new ThreadFoldersSettingsStore(environment).load()).rejects.toThrow();
  });

  it("accepts the unassigned filter as a persisted selection", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-thread-folders-"));
    cleanup.push(directory);
    const environment = { CODEXHOST_DATA_DIR: directory };

    await expect(new ThreadFoldersSettingsStore(environment).set(unfiledConfig)).resolves.toEqual({
      config: unfiledConfig,
    });
  });
});
