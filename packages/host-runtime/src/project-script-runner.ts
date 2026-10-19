import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, open, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  projectToolTargetKey,
  type ProjectScriptAction,
  type ProjectScriptRunResult,
  type ProjectToolBinding,
} from "@codexhost/shared-contracts";

function dataDirectory(environment: NodeJS.ProcessEnv): string {
  const configured = environment.CODEXHOST_DATA_DIR;
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".codexhost");
}

function invocation(
  scriptPath: string,
  environment: NodeJS.ProcessEnv,
): { command: string; args: string[] } {
  if (scriptPath.toLocaleLowerCase().endsWith(".py")) {
    return {
      command:
        environment.CODEXHOST_PYTHON || (process.platform === "win32" ? "python" : "python3"),
      args: [scriptPath],
    };
  }
  return {
    command: process.platform === "win32" ? "bash.exe" : "bash",
    args: [scriptPath],
  };
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: number | null | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("error", onError);
      child.off("close", onExit);
      resolve(result);
    };
    const onError = (): void => finish(undefined);
    const onExit = (code: number | null): void => finish(code);
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    child.once("error", onError);
    child.once("close", onExit);
  });
}

async function tail(file: string): Promise<string> {
  return (await readFile(file, "utf8").catch(() => "")).slice(-20_000);
}

function processExit(child: ChildProcess): number | null | undefined {
  if (child.exitCode !== null) return child.exitCode;
  if (child.signalCode !== null) return null;
  return undefined;
}

export class ProjectScriptRunner {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #logDirectory: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.#environment = environment;
    this.#logDirectory = path.join(dataDirectory(environment), "project-script-logs");
  }

  async run(
    binding: ProjectToolBinding,
    action: ProjectScriptAction,
  ): Promise<ProjectScriptRunResult> {
    const scriptPath = binding.scripts?.[action];
    if (!scriptPath) {
      throw new Error(`项目“${binding.label}”未绑定 ${action} 脚本。`);
    }
    await access(scriptPath);
    await mkdir(this.#logDirectory, { recursive: true, mode: 0o700 });
    const digest = createHash("sha256")
      .update(projectToolTargetKey(binding.target))
      .digest("hex")
      .slice(0, 16);
    const logPath = path.join(this.#logDirectory, `${digest}-${action}-${Date.now()}.log`);
    const log = await open(logPath, "w", 0o600);
    await log.write(`[codexhost] ${action} ${binding.label}\n[codexhost] script: ${scriptPath}\n`);
    const execution = invocation(scriptPath, this.#environment);
    let child: ChildProcess;
    try {
      child = spawn(execution.command, execution.args, {
        cwd: path.dirname(scriptPath),
        detached: true,
        env: {
          ...this.#environment,
          CODEXHOST_PROJECT_ACTION: action,
          CODEXHOST_PROJECT_ID: binding.target.projectId,
          CODEXHOST_PROJECT_LABEL: binding.label,
        },
        stdio: ["ignore", log.fd, log.fd],
      });
    } finally {
      await log.close();
    }
    const exited = await waitForExit(child, action === "stop" ? 8_000 : 500);
    const earlyExit = exited === undefined ? processExit(child) : exited;
    const output = await tail(logPath);
    if (earlyExit === undefined) {
      child.unref();
      return { action, state: "running", exitCode: null, output, logPath };
    }
    return {
      action,
      state: earlyExit === 0 ? "completed" : "failed",
      exitCode: earlyExit,
      output,
      logPath,
    };
  }
}
