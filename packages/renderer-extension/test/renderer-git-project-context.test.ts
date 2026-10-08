import { describe, expect, it } from "vitest";
import { nativeGitProjectWorkspace } from "../src/renderer-git-project-context.js";

const hostId = "remote-ssh-discovered:okm252";
const currentPath = "/opt/cloud-dev/zjarlin/aio/workspace/公司的项目/iot-platform";
function project(overrides = {}) {
  return {
    projectId: "iot",
    projectKind: "remote",
    hostId,
    path: currentPath,
    label: "remote_iot-platform",
    threadKeys: ["local:old-thread"],
    ...overrides,
  };
}
function row(group: ReturnType<typeof project>, fiber: object = { memoizedProps: { group } }) {
  return {
    __reactFiber$test: fiber,
    getAttribute: (name: string) =>
      name === "data-sidebar-project-kind"
        ? group.projectKind
        : name === "data-sidebar-project-container-id"
          ? `project:${group.projectId}`
          : null,
  };
}
function documentWith(...rows: object[]): Document {
  return { querySelectorAll: () => rows } as unknown as Document;
}
describe("native Git project workspace", () => {
  it("uses the current remote project for a member chat after its old directory was moved", () => {
    expect(nativeGitProjectWorkspace(documentWith(row(project())), hostId, "old-thread")).toBe(
      currentPath,
    );
  });
  it("reads the committed project when React retains the previous Fiber", () => {
    const group = project();
    const rootState: { current?: object } = {};
    const currentRoot: { stateNode: object; child?: object } = { stateNode: rootState };
    const current = { memoizedProps: { group }, return: currentRoot };
    const previous = {
      memoizedProps: { group: project({ path: "/old/iot-app" }) },
      return: { stateNode: rootState },
      alternate: current,
    };
    currentRoot.child = current;
    rootState.current = currentRoot;
    expect(
      nativeGitProjectWorkspace(documentWith(row(group, previous)), hostId, "old-thread"),
    ).toBe(currentPath);
  });
  it("requires the same Host and explicit thread membership", () => {
    const document = documentWith(row(project()));
    expect(
      nativeGitProjectWorkspace(document, "remote-ssh-discovered:other", "old-thread"),
    ).toBeUndefined();
    expect(nativeGitProjectWorkspace(document, hostId, "other-thread")).toBeUndefined();
  });
  it("does not substitute a local project root for a conversation worktree", () => {
    expect(
      nativeGitProjectWorkspace(
        documentWith(row(project({ projectKind: "local", hostId: "local" }))),
        "local",
        "old-thread",
      ),
    ).toBeUndefined();
  });
  it("does not choose between conflicting project memberships", () => {
    const document = documentWith(
      row(project()),
      row(project({ projectId: "other", path: "/other" })),
    );
    expect(nativeGitProjectWorkspace(document, hostId, "old-thread")).toBeUndefined();
  });
  it("requires an absolute remote path and matching native project identity", () => {
    expect(
      nativeGitProjectWorkspace(
        documentWith(row(project({ path: "relative" }))),
        hostId,
        "old-thread",
      ),
    ).toBeUndefined();
    expect(
      nativeGitProjectWorkspace(
        documentWith(
          row(project(), { memoizedProps: { group: project({ projectId: "unrelated" }) } }),
        ),
        hostId,
        "old-thread",
      ),
    ).toBeUndefined();
  });
});
