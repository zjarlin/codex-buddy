import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_THREAD_TERMINAL_SETTINGS,
  threadTerminalSettingsSchema,
  type ThreadTerminalSettings,
} from "@codexhost/shared-contracts";

function settingsDirectory(environment: NodeJS.ProcessEnv): string {
  const dataDirectory = environment.CODEXHOST_DATA_DIR;
  return dataDirectory ? path.resolve(dataDirectory) : path.join(os.homedir(), ".codexhost");
}

export class ThreadTerminalSettingsStore {
  readonly #file: string;
  #settings: ThreadTerminalSettings = { ...DEFAULT_THREAD_TERMINAL_SETTINGS };
  #loaded = false;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.#file = path.join(settingsDirectory(environment), "thread-terminal.json");
  }

  async load(): Promise<ThreadTerminalSettings> {
    if (this.#loaded) return { ...this.#settings };
    this.#loaded = true;
    try {
      const parsed = threadTerminalSettingsSchema.safeParse(
        JSON.parse(await readFile(this.#file, "utf8")),
      );
      if (parsed.success) this.#settings = parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { ...this.#settings };
  }

  async set(value: unknown): Promise<ThreadTerminalSettings> {
    const settings = threadTerminalSettingsSchema.parse(value);
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    const temporary = `${this.#file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
    this.#settings = settings;
    this.#loaded = true;
    return { ...settings };
  }
}
