import { describe, expect, it } from "vitest";

import {
  projectScriptRunParamsSchema,
  projectToolsConfigSchema,
  projectToolTargetKey,
  projectToolTargetSchema,
} from "@codexhost/shared-contracts";

describe("Project tool contracts", () => {
  it("accepts URLs and scripts for local and remote project identities", () => {
    const config = {
      version: 1 as const,
      bindings: [
        {
          target: { projectKind: "local" as const, projectId: "local-project" },
          label: "Local project",
          intranetUrl: "http://192.168.31.252:48201/",
          scripts: { start: "/repo/scripts/start.sh", stop: "/repo/scripts/stop.py" },
        },
        {
          target: {
            projectKind: "remote" as const,
            hostId: "office",
            projectId: "remote-project",
          },
          label: "Remote project",
          publicUrl: "https://example.com/project",
          scripts: { restart: "/repo/restart.py" },
          prompt: "Inspect the project and verify the result.",
        },
      ],
    };

    expect(projectToolsConfigSchema.parse(config)).toEqual(config);
    expect(projectToolTargetKey(projectToolTargetSchema.parse(config.bindings[1]?.target))).toBe(
      '["remote","office","remote-project"]',
    );
  });

  it("rejects unsafe URLs, unsupported scripts, empty bindings, and duplicate targets", () => {
    const base = {
      target: { projectKind: "local" as const, projectId: "project" },
      label: "Project",
    };
    for (const intranetUrl of [
      "javascript:alert(1)",
      "file:///tmp/project",
      "http://user:secret@example.com/",
    ]) {
      expect(() =>
        projectToolsConfigSchema.parse({
          version: 1,
          bindings: [{ ...base, intranetUrl }],
        }),
      ).toThrow();
    }
    expect(() => projectToolsConfigSchema.parse({ version: 1, bindings: [base] })).toThrow();
    expect(
      projectToolsConfigSchema.parse({
        version: 1,
        bindings: [{ ...base, prompt: "  Check project health.  " }],
      }).bindings[0]?.prompt,
    ).toBe("Check project health.");
    expect(() =>
      projectToolsConfigSchema.parse({
        version: 1,
        bindings: [
          { ...base, intranetUrl: "http://example.com/" },
          { ...base, publicUrl: "https://example.com/" },
        ],
      }),
    ).toThrow();
    expect(() =>
      projectToolsConfigSchema.parse({
        version: 1,
        bindings: [{ ...base, scripts: { start: "scripts/start.bat" } }],
      }),
    ).toThrow();
  });

  it("accepts custom scripts alongside built-in actions and rejects id misuse", () => {
    const base = {
      target: { projectKind: "local" as const, projectId: "project" },
      label: "Project",
      scripts: { start: "/repo/start.sh" },
    };
    const config = projectToolsConfigSchema.parse({
      version: 1,
      bindings: [
        {
          ...base,
          customScripts: [{ id: "deploy", name: "部署", path: "/repo/deploy.sh" }],
        },
      ],
    });
    expect(config.bindings[0]?.customScripts).toEqual([
      { id: "deploy", name: "部署", path: "/repo/deploy.sh" },
    ]);
    expect(
      projectToolsConfigSchema.parse({
        version: 1,
        bindings: [
          {
            target: { projectKind: "local" as const, projectId: "project" },
            label: "Project",
            customScripts: [{ id: "deploy", name: "部署", path: "/repo/deploy.py" }],
          },
        ],
      }).bindings[0]?.customScripts,
    ).toHaveLength(1);

    for (const customScripts of [
      [{ id: "start", name: "Start", path: "/repo/start.sh" }],
      [{ id: "bad id", name: "Bad", path: "/repo/bad.sh" }],
      [{ id: "run", name: "Run", path: "relative.sh" }],
      [
        { id: "run", name: "Run", path: "/repo/run.sh" },
        { id: "run", name: "Again", path: "/repo/again.sh" },
      ],
    ]) {
      expect(() =>
        projectToolsConfigSchema.parse({
          version: 1,
          bindings: [{ ...base, customScripts }],
        }),
      ).toThrow();
    }
  });

  it("validates script action requests without accepting a caller-supplied path", () => {
    expect(
      projectScriptRunParamsSchema.parse({
        target: { projectKind: "local", projectId: "project" },
        action: "restart",
      }),
    ).toEqual({
      target: { projectKind: "local", projectId: "project" },
      action: "restart",
    });
    expect(() =>
      projectScriptRunParamsSchema.parse({
        target: { projectKind: "local", projectId: "project" },
        action: "start",
        script: "/tmp/arbitrary.sh",
      }),
    ).toThrow();
  });
});
