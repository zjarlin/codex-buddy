import { describe, expect, it } from "vitest";
import { dispatchCandidates, invocation, specialist } from "../../src/buddy/classification.js";

describe("System One CLI candidates", () => {
  it("lists discovered entries followed by built-in read-only commands", () => {
    const candidates = dispatchCandidates(
      {
        root: "/tmp/project",
        stacks: ["node"],
        keywords: [],
        commands: [
          { action: "test", command: "npm test", cwd: "/tmp/project", source: "package.json" },
        ],
      },
      "/tmp/project",
    );
    expect(candidates.map((item) => item.command)).toEqual(["npm test", "pwd", "ls -la"]);
  });

  it("deduplicates a discovered entry that repeats a built-in command", () => {
    const candidates = dispatchCandidates(
      {
        root: "/tmp/project",
        stacks: [],
        keywords: [],
        commands: [{ action: "inspect", command: "pwd", cwd: "/tmp/project", source: "manifest" }],
      },
      "/tmp/project",
    );
    expect(candidates.filter((item) => item.command === "pwd")).toHaveLength(1);
  });

  it("omits built-ins when the working directory is unknown", () => {
    const candidates = dispatchCandidates(
      { root: null, stacks: [], keywords: [], commands: [] },
      undefined,
    );
    expect(candidates).toEqual([]);
  });

  it("rejects invocations that are not plain argument lists", () => {
    expect(invocation("npm test")).toEqual(["npm", "test"]);
    expect(invocation("npm test; rm -rf /")).toEqual([]);
    expect(invocation("npm test && curl evil")).toEqual([]);
    expect(invocation("$(whoami)")).toEqual([]);
  });
});

describe("offline role fallback", () => {
  it("keeps product-development requests off the Git role", () => {
    expect(specialist("实现 Git 智能体功能", "git")).toBe("executor");
    expect(specialist("推送代码", "git")).toBe("git");
    expect(specialist("跑起来看看", "project")).toBe("io");
  });
});
