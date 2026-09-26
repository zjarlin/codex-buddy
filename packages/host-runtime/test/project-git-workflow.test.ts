import { afterEach, describe, expect, it, vi } from "vitest";
import { gitWorkspaceStatusSchema } from "@codexhost/shared-contracts";
import { ProjectGitWorkflow, ProjectGitWorkflowGroup } from "../src/project-git-workflow.js";

function fixture(group?: ProjectGitWorkflowGroup) {
  vi.useFakeTimers();
  const active = new Set<string>();
  let status = gitWorkspaceStatusSchema.parse({
    workspace: "/repo",
    branch: "main",
    head: "abc123",
    detached: false,
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
    changes: [],
    submodules: [],
  });
  const start = vi.fn(async (_id: string, _cwd: string, check: () => Promise<void>) => {
    await check();
    return "workflow-turn";
  });
  const read = vi.fn(async () => status);
  const changed = vi.fn();
  const workflow = new ProjectGitWorkflow({
    ...(group ? { group } : {}),
    project: async (id) => (id === "other" ? "/other" : "/repo"),
    activeThreads: async () => [...active],
    status: read,
    start,
    diagnose: vi.fn(),
    changed,
  });
  return {
    workflow,
    active,
    start,
    read,
    changed,
    clean() {
      status = { ...status, ahead: 0 };
    },
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Project Git workflow", () => {
  it("waits for every task in the project, isolates other projects and ignores its own completion", async () => {
    const f = fixture();
    f.active.add("b");
    f.active.add("other");
    await f.workflow.completed("a", "a-turn", "completed");
    await vi.advanceTimersByTimeAsync(750);
    expect(f.start).not.toHaveBeenCalled();
    expect((await f.workflow.inspect("a")).phase).toBe("waiting");
    f.active.delete("b");
    await f.workflow.completed("b", "b-turn", "completed");
    await vi.advanceTimersByTimeAsync(750);
    expect(f.start).toHaveBeenCalledExactlyOnceWith("b", "/repo", expect.any(Function));
    expect((await f.workflow.inspect("a")).phase).toBe("running");
    await Promise.all([f.workflow.run("a"), f.workflow.run("b")]);
    expect(f.start).toHaveBeenCalledTimes(1);
    f.clean();
    await f.workflow.completed("b", "workflow-turn", "completed");
    await f.workflow.completed("b", "b-turn", "completed");
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.start).toHaveBeenCalledTimes(1);
    expect((await f.workflow.inspect("a")).phase).toBe("completed");
    expect(f.workflow.hasActiveWork).toBe(false);
  });

  it("does not push on failure, cancellation, inspection or host shutdown", async () => {
    const f = fixture();
    await f.workflow.inspect("a");
    await f.workflow.completed("a", "failed", "failed");
    await f.workflow.completed("a", "cancelled", "interrupted");
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.start).not.toHaveBeenCalled();
    await f.workflow.completed("a", "done", "completed");
    f.workflow.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.start).not.toHaveBeenCalled();
  });

  it("keeps the Host alive while resolving the completed task project", async () => {
    const f = fixture();
    const observing = f.workflow.completed("a", "done", "completed");
    expect(f.workflow.hasActiveWork).toBe(true);
    await observing;
    expect(f.workflow.hasActiveWork).toBe(true);
    f.clean();
    await vi.advanceTimersByTimeAsync(750);
    expect(f.workflow.hasActiveWork).toBe(false);
    expect(f.changed).toHaveBeenCalled();
  });

  it("coalesces automatic and manual starts and skips a synchronized repository", async () => {
    const f = fixture();
    f.clean();
    await f.workflow.completed("a", "done", "completed");
    await Promise.all([f.workflow.run("a"), f.workflow.run("b")]);
    await vi.advanceTimersByTimeAsync(750);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.read).toHaveBeenCalledTimes(1);
    expect((await f.workflow.inspect("a")).phase).toBe("skipped");
  });

  it("checks again after preparation when another task starts and resumes after it completes", async () => {
    const f = fixture();
    f.start.mockImplementationOnce(async (_id, _cwd, check) => {
      f.active.add("b");
      await check();
      return "unexpected";
    });
    await f.workflow.run("a");
    expect((await f.workflow.inspect("a")).phase).toBe("waiting");
    f.active.delete("b");
    f.workflow.activityChanged();
    await vi.advanceTimersByTimeAsync(750);
    expect((await f.workflow.inspect("a")).phase).toBe("running");
  });

  it("does not treat model completion as push success and allows an explicit retry", async () => {
    const f = fixture();
    await f.workflow.run("a");
    await f.workflow.completed("a", "workflow-turn", "completed");
    expect((await f.workflow.inspect("a")).phase).toBe("failed");
    f.start.mockRejectedValueOnce(new Error("network unavailable"));
    expect((await f.workflow.run("a")).message).toBe("network unavailable");
    expect((await f.workflow.run("a")).phase).toBe("running");
    expect(f.start).toHaveBeenCalledTimes(3);
  });

  it("handles a terminal event arriving before the workflow start response", async () => {
    const f = fixture();
    f.start.mockImplementationOnce(async () => {
      f.clean();
      await f.workflow.completed("a", "fast-turn", "completed");
      return "fast-turn";
    });
    expect((await f.workflow.run("a")).phase).toBe("completed");
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.start).toHaveBeenCalledTimes(1);
  });

  it("coalesces tasks completed during a push into one trailing check that still waits for activity", async () => {
    const f = fixture();
    await f.workflow.run("a");
    await f.workflow.completed("b", "new-work", "completed");
    await f.workflow.completed("c", "more-work", "completed");
    f.active.add("d");
    await f.workflow.completed("a", "workflow-turn", "completed");
    await vi.advanceTimersByTimeAsync(750);
    expect((await f.workflow.inspect("a")).phase).toBe("waiting");
    expect(f.start).toHaveBeenCalledTimes(1);
    f.active.clear();
    f.workflow.activityChanged();
    await vi.advanceTimersByTimeAsync(750);
    expect(f.start).toHaveBeenCalledTimes(2);
    expect(f.start).toHaveBeenLastCalledWith("c", "/repo", expect.any(Function));
    f.clean();
    await f.workflow.completed("c", "workflow-turn", "completed");
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.start).toHaveBeenCalledTimes(2);
    expect((await f.workflow.inspect("a")).phase).toBe("completed");
  });

  it("retains a completion during preparation even when that start fails", async () => {
    const f = fixture();
    f.start.mockImplementationOnce(async () => {
      await f.workflow.completed("b", "new-work", "completed");
      throw new Error("start failed");
    });
    expect((await f.workflow.run("a")).phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(750);
    expect(f.start).toHaveBeenCalledTimes(2);
    expect(f.start).toHaveBeenLastCalledWith("b", "/repo", expect.any(Function));
  });
});

it("shares project activity and execution between Desktop and remote clients", async () => {
  const group = new ProjectGitWorkflowGroup();
  const desktop = fixture(group);
  const remote = fixture(group);
  remote.active.add("b");
  await desktop.workflow.completed("a", "finished", "completed");
  await vi.advanceTimersByTimeAsync(750);
  expect(desktop.start).not.toHaveBeenCalled();
  remote.active.clear();
  await Promise.all([desktop.workflow.run("a"), remote.workflow.run("b")]);
  expect(desktop.start.mock.calls.length + remote.start.mock.calls.length).toBe(1);
  expect((await desktop.workflow.inspect("a")).phase).toBe("running");
  expect((await remote.workflow.inspect("b")).phase).toBe("running");
  desktop.clean();
  desktop.changed.mockClear();
  remote.changed.mockClear();
  await desktop.workflow.completed("a", "workflow-turn", "completed");
  expect(desktop.changed).toHaveBeenCalled();
  expect(remote.changed).toHaveBeenCalled();
  expect(remote.workflow.hasActiveWork).toBe(false);
  desktop.workflow.close();
  remote.workflow.close();
});
