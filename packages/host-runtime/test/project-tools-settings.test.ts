import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectToolsSettingsStore } from "../src/project-tools-settings.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const config = {
  version: 1 as const,
  bindings: [
    {
      target: { projectKind: "local" as const, projectId: "project-one" },
      label: "Project One",
      intranetUrl: "http://192.168.31.252:48201/",
      publicUrl: "https://project.example.com/",
      scripts: {
        start: "/repo/scripts/start.sh",
        restart: "/repo/scripts/restart.sh",
        stop: "/repo/scripts/stop.py",
      },
      prompt: "Inspect project health and verify the service.",
    },
  ],
};

describe("Project tool settings", () => {
  it("persists configuration across Host instances", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-project-tools-"));
    cleanup.push(directory);
    const environment = { CODEXHOST_DATA_DIR: directory };
    const metadataPath = path.join(directory, "project-tools.json");

    await expect(new ProjectToolsSettingsStore(environment).load()).resolves.toEqual({
      config: null,
      metadataPath,
    });
    await expect(new ProjectToolsSettingsStore(environment).set(config)).resolves.toEqual({
      config,
      metadataPath,
    });
    await expect(new ProjectToolsSettingsStore(environment).load()).resolves.toEqual({
      config,
      metadataPath,
    });
    await expect(readFile(path.join(directory, "project-tools.json"), "utf8")).resolves.toContain(
      '"intranetUrl": "http://192.168.31.252:48201/"',
    );
    await expect(readFile(path.join(directory, "project-tools.json"), "utf8")).resolves.toContain(
      '"prompt": "Inspect project health and verify the service."',
    );
  });

  it("rejects corrupted persisted configuration", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-project-tools-"));
    cleanup.push(directory);
    await writeFile(path.join(directory, "project-tools.json"), '{"version":1,"bindings":[{}]}');

    await expect(
      new ProjectToolsSettingsStore({ CODEXHOST_DATA_DIR: directory }).load(),
    ).rejects.toThrow();
  });

  it("reloads external edits instead of returning a stale in-memory configuration", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codexhost-project-tools-"));
    cleanup.push(directory);
    const environment = { CODEXHOST_DATA_DIR: directory };
    const store = new ProjectToolsSettingsStore(environment);
    await store.set({ version: 1, bindings: [] });
    const externallyEdited = {
      version: 1 as const,
      bindings: [
        {
          target: { projectKind: "local" as const, projectId: "project-one" },
          label: "Project One",
          scripts: { start: "/repo/start.sh" },
        },
      ],
    };
    await writeFile(
      path.join(directory, "project-tools.json"),
      `${JSON.stringify(externallyEdited, null, 2)}\n`,
    );

    await expect(store.load()).resolves.toMatchObject({ config: externallyEdited });
  });
});
