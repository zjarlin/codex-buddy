import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  projectTabsConfigSchema,
  type ProjectTabsConfig,
  type ProjectTabsState,
} from "@codexhost/shared-contracts";

function settingsDirectory(environment: NodeJS.ProcessEnv): string {
  const dataDirectory = environment.CODEXHOST_DATA_DIR;
  return dataDirectory ? path.resolve(dataDirectory) : path.join(os.homedir(), ".codexhost");
}

export class ProjectTabsSettingsStore {
  readonly #file: string;
  #config: ProjectTabsConfig | null = null;
  #loaded = false;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.#file = path.join(settingsDirectory(environment), "project-tabs.json");
  }

  async load(): Promise<ProjectTabsState> {
    if (!this.#loaded) {
      try {
        this.#config = projectTabsConfigSchema.parse(
          JSON.parse(await readFile(this.#file, "utf8")),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      this.#loaded = true;
    }
    return { config: this.#config ? projectTabsConfigSchema.parse(this.#config) : null };
  }

  async set(value: unknown): Promise<ProjectTabsState> {
    const config = projectTabsConfigSchema.parse(value);
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    const temporary = `${this.#file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
    this.#config = config;
    this.#loaded = true;
    return { config: projectTabsConfigSchema.parse(config) };
  }
}
