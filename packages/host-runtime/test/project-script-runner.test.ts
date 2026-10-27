import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectScriptRunner } from "../src/project-script-runner.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(script: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "codexhost-script-"));
  cleanup.push(directory);
  const scriptPath = path.join(directory, "start.sh");
  await writeFile(scriptPath, script, { mode: 0o700 });
  await chmod(scriptPath, 0o700);
  return { directory, scriptPath };
}

describe("Project script runner", () => {
  it("runs the bound script without a shell and captures its log", async () => {
    const { directory, scriptPath } = await fixture(
      "#!/usr/bin/env bash\nprintf 'started %s\\n' \"$CODEXHOST_PROJECT_ACTION\"\n",
    );
    const result = await new ProjectScriptRunner({ CODEXHOST_DATA_DIR: directory }).run(
      {
        target: { projectKind: "local", projectId: "project" },
        label: "Project",
        scripts: { start: scriptPath },
      },
      "start",
    );

    // Windows 上 bash.exe 的启动本身可能超过 500ms 的早退观察窗口，
    // 此时 runner 如实返回 running；重跑一次即可拿到「已完成」这条路径。
    let settled = result;
    for (let attempt = 0; attempt < 4 && settled.state === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      settled = await new ProjectScriptRunner({ CODEXHOST_DATA_DIR: directory }).run(
        {
          target: { projectKind: "local", projectId: "project" },
          label: "Project",
          scripts: { start: scriptPath },
        },
        "start",
      );
    }

    expect(settled).toMatchObject({ action: "start", state: "completed", exitCode: 0 });
    expect(settled.output).toContain("started start");
    await expect(readFile(settled.logPath, "utf8")).resolves.toContain(`script: ${scriptPath}`);
  });

  it("runs a bound custom script by id", async () => {
    const { directory, scriptPath } = await fixture(
      "#!/usr/bin/env bash\nprintf 'custom %s\\n' \"$CODEXHOST_PROJECT_ACTION\"\n",
    );
    const result = await new ProjectScriptRunner({ CODEXHOST_DATA_DIR: directory }).run(
      {
        target: { projectKind: "local", projectId: "project" },
        label: "Project",
        customScripts: [{ id: "deploy", name: "部署", path: scriptPath }],
      },
      "deploy",
    );

    expect(result).toMatchObject({ action: "deploy", state: "completed", exitCode: 0 });
    expect(result.output).toContain("custom deploy");
  });

  it("reports an early non-zero exit and rejects missing bound actions", async () => {
    const { directory, scriptPath } = await fixture("#!/usr/bin/env bash\nexit 7\n");
    const runner = new ProjectScriptRunner({ CODEXHOST_DATA_DIR: directory });
    const binding = {
      target: { projectKind: "local" as const, projectId: "project" },
      label: "Project",
      scripts: { start: scriptPath },
    };

    await expect(runner.run(binding, "start")).resolves.toMatchObject({
      state: "failed",
      exitCode: 7,
    });
    await expect(runner.run(binding, "stop")).rejects.toThrow("未绑定 stop");
  });
});
