import { describe, expect, it } from "vitest";

import { buildProjectScriptPrompt } from "../src/project-tools/prompt.js";
import {
  bindingForProject,
  emptyProjectTools,
  parseProjectTools,
  projectToolKey,
  withProjectToolBinding,
} from "../src/project-tools/model.js";

const local = {
  projectKind: "local" as const,
  projectId: "project-one",
  label: "Project One",
};
const remote = {
  projectKind: "remote" as const,
  hostId: "office",
  projectId: "project-one",
  label: "Project One",
};

describe("Project tool bindings", () => {
  it("keeps local and remote identities separate and survives project renames", () => {
    const config = withProjectToolBinding(emptyProjectTools(), local, {
      intranetUrl: "http://192.168.31.252:48201/",
    });

    expect(projectToolKey(local)).not.toBe(projectToolKey(remote));
    expect(bindingForProject(config, { ...local, label: "Renamed" })).toMatchObject({
      intranetUrl: "http://192.168.31.252:48201/",
    });
    expect(bindingForProject(config, remote)).toBeNull();
  });

  it("stores URLs and scripts together and removes the binding when all fields are empty", () => {
    const configured = withProjectToolBinding(emptyProjectTools(), local, {
      intranetUrl: " http://192.168.31.252:48201/ ",
      publicUrl: "https://project.example.com/",
      scripts: {
        start: " /repo/start.sh ",
        restart: " /repo/restart.py ",
        stop: " ",
      },
      prompt: "  Inspect the project and verify it.  ",
    });
    expect(bindingForProject(configured, local)).toEqual({
      target: { projectKind: "local", projectId: "project-one" },
      label: "Project One",
      intranetUrl: "http://192.168.31.252:48201/",
      publicUrl: "https://project.example.com/",
      scripts: { start: "/repo/start.sh", restart: "/repo/restart.py" },
      prompt: "Inspect the project and verify it.",
    });

    const removed = withProjectToolBinding(configured, local, {});
    expect(bindingForProject(removed, local)).toBeNull();
  });

  it("roundtrips persisted bindings and rejects unsafe stored URLs", () => {
    const config = withProjectToolBinding(emptyProjectTools(), local, {
      intranetUrl: "http://192.168.31.252:48201/",
      scripts: { stop: "/repo/stop.sh" },
      prompt: "Inspect the project.",
    });
    expect(parseProjectTools(JSON.stringify(config))).toEqual(config);
    expect(() =>
      parseProjectTools(
        JSON.stringify({
          version: 1,
          bindings: [
            {
              target: { projectKind: "local", projectId: "project-one" },
              label: "Project One",
              intranetUrl: "javascript:alert(1)",
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("builds a script task with the exact project, metadata path, and merge key", () => {
    const project = { ...local, path: "/opt/projects/demo" };
    const current =
      withProjectToolBinding(emptyProjectTools(), project, {
        intranetUrl: "http://192.168.31.252:48201/",
        prompt: "Keep this existing prompt.",
      }).bindings[0] ?? null;
    const prompt = buildProjectScriptPrompt({
      project,
      metadataPath: "/home/test/.codexhost/project-tools.json",
      currentBinding: current,
    });

    expect(prompt).toContain("项目绝对路径：/opt/projects/demo");
    expect(prompt).toContain("projectId：project-one");
    expect(prompt).toContain('target 唯一键：["local","local","project-one"]');
    expect(prompt).toContain("/home/test/.codexhost/project-tools.json");
    expect(prompt).toContain('"intranetUrl": "http://192.168.31.252:48201/"');
    expect(prompt).toContain("/opt/projects/demo/scripts/start.sh");
    expect(prompt).toContain("禁止无范围 pkill");
    expect(prompt).toContain("保留 version 和所有其他项目 binding");
  });

  it("includes the remote Host identity in generated metadata tasks", () => {
    const prompt = buildProjectScriptPrompt({
      project: { ...remote, path: "/srv/project" },
      metadataPath: "/root/.codexhost/remote/data/project-tools.json",
      currentBinding: null,
    });

    expect(prompt).toContain("hostId：office");
    expect(prompt).toContain('target 唯一键：["remote","office","project-one"]');
    expect(prompt).toContain("当前项目已有 binding（如果存在");
    expect(prompt).toContain("null");
  });
});
