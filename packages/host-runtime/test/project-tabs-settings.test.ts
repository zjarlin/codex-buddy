import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectTabsSettingsStore } from "../src/project-tabs-settings.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const config = {
  version: 2 as const,
  tabs: [{ id: "work", name: "工作", prefixes: ["remote_company"] }],
  assignments: { '["local","local","project"]': "work" },
  selected: "work",
};

describe("Project tab settings", () => {
  it("persists configuration across Host instances", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-project-tabs-"));
    cleanup.push(directory);
    const environment = { CODEXHOST_DATA_DIR: directory };

    await expect(new ProjectTabsSettingsStore(environment).load()).resolves.toEqual({
      config: null,
    });
    await expect(new ProjectTabsSettingsStore(environment).set(config)).resolves.toEqual({
      config,
    });
    await expect(new ProjectTabsSettingsStore(environment).load()).resolves.toEqual({ config });
    await expect(readFile(path.join(directory, "project-tabs.json"), "utf8")).resolves.toContain(
      '"selected": "work"',
    );
  });

  it("rejects corrupted persisted configuration", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-project-tabs-"));
    cleanup.push(directory);
    await writeFile(path.join(directory, "project-tabs.json"), '{"version":2,"tabs":[]}');

    await expect(
      new ProjectTabsSettingsStore({ CODEXHOST_DATA_DIR: directory }).load(),
    ).rejects.toThrow();
  });
});
