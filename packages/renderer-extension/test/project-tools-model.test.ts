import { describe, expect, it } from "vitest";

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
});
