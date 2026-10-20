import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  projectToolsConfigSchema,
  type ProjectToolsConfig,
  type ProjectToolsState,
} from "@codexhost/shared-contracts";

function settingsDirectory(environment: NodeJS.ProcessEnv): string {
  const dataDirectory = environment.CODEXHOST_DATA_DIR;
  return dataDirectory ? path.resolve(dataDirectory) : path.join(os.homedir(), ".codexhost");
}

export class ProjectToolsSettingsStore {
  readonly #file: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.#file = path.join(settingsDirectory(environment), "project-tools.json");
  }

  async load(): Promise<ProjectToolsState> {
    let config: ProjectToolsConfig | null = null;
    try {
      config = projectToolsConfigSchema.parse(JSON.parse(await readFile(this.#file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { config, metadataPath: this.#file };
  }

  async set(value: unknown): Promise<ProjectToolsState> {
    const config = projectToolsConfigSchema.parse(value);
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    const temporary = `${this.#file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
    return { config: projectToolsConfigSchema.parse(config), metadataPath: this.#file };
  }
}
