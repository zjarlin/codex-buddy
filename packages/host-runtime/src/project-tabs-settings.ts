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

async function readProjectTabsConfig(file: string): Promise<ProjectTabsConfig | null> {
  try {
    return projectTabsConfigSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    // 配置被手改或旧版本写坏时整体拒绝会让窗口永久无法读写 Tab 设置；
    // 与终端设置一致：忽略无法解析的旧内容，下一次保存覆盖它。
    if (error instanceof SyntaxError || (error as { name?: unknown }).name === "ZodError") {
      return null;
    }
    throw error;
  }
}

export class ProjectTabsSettingsStore {
  readonly #file: string;
  #config: ProjectTabsConfig | null = null;
  #loaded = false;
  #loading: Promise<void> | null = null;

  /** 并发首次读取只解析一次文件，避免重复校验或交错覆盖缓存。 */
  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    this.#loading ??= readProjectTabsConfig(this.#file).then(
      (config) => {
        this.#config = config;
        this.#loaded = true;
      },
      (error: unknown) => {
        this.#loading = null;
        throw error;
      },
    );
    await this.#loading;
  }

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.#file = path.join(settingsDirectory(environment), "project-tabs.json");
  }

  async load(): Promise<ProjectTabsState> {
    await this.#ensureLoaded();
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
