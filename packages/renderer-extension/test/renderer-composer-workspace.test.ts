import { describe, expect, it } from "vitest";
import { composerDraftWorkspace } from "../src/renderer-composer-workspace.js";

const hostId = "remote-ssh-discovered:okm252";
function remoteProps(path: string, host = hostId) {
  return {
    composerMode: "local",
    setComposerMode() {},
    remoteSelectionState: {
      isAttachedToStartedTask: false,
      draftNewThreadRemoteSelectionState: { hostId: host, projectPath: path },
    },
  };
}
function composerWithFibers(...fibers: object[]): Element {
  return {
    querySelectorAll: () => fibers.map((fiber) => ({ __reactFiber$test: fiber })),
  } as unknown as Element;
}

describe("composer draft workspace", () => {
  it("uses the committed project after React retains the previous DOM Fiber", () => {
    const rootState: { current?: object } = {};
    const previousRoot = { stateNode: rootState };
    const currentRoot: { stateNode: object; child?: object } = { stateNode: rootState };
    const current = { memoizedProps: remoteProps("/remote/sub2api"), return: currentRoot };
    const previous = {
      memoizedProps: remoteProps("/remote/official-app"),
      return: previousRoot,
      alternate: current,
    };
    currentRoot.child = current;
    rootState.current = currentRoot;
    expect(composerDraftWorkspace(composerWithFibers(previous), hostId)).toBe("/remote/sub2api");
  });

  it("does not cross the composer boundary into another project's page state", () => {
    const owner: { stateNode?: Element; return: object } = {
      return: { memoizedProps: remoteProps("/remote/background") },
    };
    const composer = composerWithFibers({ memoizedProps: {}, return: owner });
    owner.stateNode = composer;
    expect(composerDraftWorkspace(composer, hostId)).toBeUndefined();
  });

  it("keeps identical paths on different Hosts separate", () => {
    const composer = composerWithFibers({ memoizedProps: remoteProps("/workspace/demo") });
    expect(composerDraftWorkspace(composer, "local")).toBeUndefined();
    expect(composerDraftWorkspace(composer, "remote-ssh-discovered:other")).toBeUndefined();
  });

  it("does not guess when native controls disagree about the project", () => {
    const composer = composerWithFibers(
      { memoizedProps: remoteProps("/remote/one") },
      { memoizedProps: remoteProps("/remote/two") },
    );
    expect(composerDraftWorkspace(composer, hostId)).toBeUndefined();
  });

  it("uses the local execution target instead of a remembered remote draft", () => {
    const props = {
      ...remoteProps("/remote/previous"),
      localRemoteExecutionTarget: { hostId: "local", cwd: "/local/current" },
    };
    const composer = composerWithFibers({ memoizedProps: props });
    expect(composerDraftWorkspace(composer, "local")).toBe("/local/current");
  });

  it("does not use an existing remote conversation as a new draft's project", () => {
    const props = remoteProps("/remote/previous-draft");
    props.remoteSelectionState.isAttachedToStartedTask = true;
    const composer = composerWithFibers({ memoizedProps: props });
    expect(composerDraftWorkspace(composer, hostId)).toBeUndefined();
  });
});
