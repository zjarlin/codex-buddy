import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { runLocalHostCli } from "../src/local-host-cli.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexhost-local-host-cli-"));
  roots.push(root);
  const environment = { HOME: root, CODEXHOST_DATA_DIR: path.join(root, "data") };
  return { root, environment };
}

async function run(
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ code: number; json: Record<string, unknown>; diagnostics: string }> {
  const output = new PassThrough();
  const diagnostics = new PassThrough();
  let stdout = "";
  let stderr = "";
  output.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  diagnostics.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const code = await runLocalHostCli({
    arguments: arguments_,
    environment,
    output,
    diagnosticOutput: diagnostics,
  });
  return {
    code,
    json: stdout ? (JSON.parse(stdout) as Record<string, unknown>) : {},
    diagnostics: stderr,
  };
}

describe("local-host CLI", () => {
  it("enables, reports, and disables the persistent local Host", async () => {
    const { environment } = await fixture();
    await expect(run(["enable"], environment)).resolves.toMatchObject({
      code: 0,
      json: { state: "enabled", restartRequired: true },
    });
    await expect(run(["status"], environment)).resolves.toMatchObject({
      code: 0,
      json: { state: "enabled", enabled: true, runtime: "stopped" },
    });
    await expect(run(["disable"], environment)).resolves.toMatchObject({
      code: 0,
      json: { state: "disabled", runtime: "stopped", stopped: false },
    });
    await expect(run(["status"], environment)).resolves.toMatchObject({
      code: 0,
      json: { state: "disabled", enabled: false },
    });
  });

  it("reports a missing listener as not running when stopped", async () => {
    const { environment } = await fixture();
    await expect(run(["stop"], environment)).resolves.toMatchObject({
      code: 0,
      json: { state: "not-running" },
    });
  });

  it("rejects unknown commands without writing to stdout", async () => {
    const { environment } = await fixture();
    const result = await run(["start"], environment);
    expect(result.code).toBe(1);
    expect(result.json).toEqual({});
    expect(result.diagnostics).toContain("Unknown local-host command 'start'");
  });
});
