import { describe, expect, it } from "vitest";
import { threadProject } from "../src/project-tabs/native-binding.js";

const hostId = "remote-ssh-discovered:okm252";
function project(overrides = {}) {
  return {
    projectKind: "remote",
    hostId,
    projectId: "iot",
    label: "remote_company_iot",
    path: "/projects/iot",
    threadKeys: ["local:target"],
    ...overrides,
  };
}
function root(...projects: ReturnType<typeof project>[]): ParentNode {
  return {
    querySelectorAll: () =>
      projects.map((group) => ({
        __reactFiber$test: { memoizedProps: { group } },
        getAttribute: (name: string) =>
          name === "data-sidebar-project-kind"
            ? group.projectKind
            : name === "data-sidebar-project-container-id"
              ? `project:${group.projectId}`
              : null,
      })),
  } as unknown as ParentNode;
}
const target = { hostId, threadId: "target" };
describe("thread project resolution without mounted conversation rows", () => {
  it("resolves a collapsed remote project's native local-prefixed member", () => {
    const group = project();
    expect(threadProject(root(project({ hostId: "other" }), group), target)).toBe(group);
  });
  it("deduplicates a project rendered in both pinned and project sections", () => {
    const group = project();
    expect(threadProject(root(group, group), target)).toBe(group);
  });
  it("prefers membership after a project moves or is renamed", () => {
    const group = project();
    expect(threadProject(root(group), { ...target, cwd: "/old", project: "old" })).toBe(group);
  });
  it("uses exact cwd when membership has not loaded", () => {
    const group = project({ threadKeys: [] });
    expect(threadProject(root(group), { ...target, cwd: group.path })).toBe(group);
    expect(threadProject(root(group), { ...target, cwd: "/projects" })).toBeNull();
  });
  it("refuses conflicting membership and ambiguous labels", () => {
    const groups = [project(), project({ projectId: "other" })];
    expect(threadProject(root(...groups), target)).toBeNull();
    expect(
      threadProject(root(...groups), {
        ...target,
        threadId: "missing",
        project: "remote_company_iot",
      }),
    ).toBeNull();
  });
  it("never resolves a same-named project on another Host", () => {
    expect(
      threadProject(root(project({ hostId: "other" })), {
        ...target,
        project: "remote_company_iot",
        cwd: "/projects/iot",
      }),
    ).toBeNull();
  });
});
