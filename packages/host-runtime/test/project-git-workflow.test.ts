import { afterEach, describe, expect, it, vi } from "vitest";
import { gitWorkspaceStatusSchema } from "@codexhost/shared-contracts";
import {
  ProjectGitWorkflow,
  ProjectGitWorkflowGroup,
  projectGitWorkflowInput,
} from "../src/project-git-workflow.js";
import type { ProjectGitRepository } from "../src/project-git-repositories.js";
import { GitWorkspaceError } from "../src/git-workspace.js";

function fixture(group?: ProjectGitWorkflowGroup) {
  vi.useFakeTimers();
  const active = new Set<string>();
  const projects = new Map([
    ["a", "/repo"],
    ["b", "/repo"],
    ["c", "/repo"],
    ["d", "/repo"],
    ["other", "/other"],
  ]);
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
  const linked = new Map<string, ProjectGitRepository>();
  const start = vi.fn<
    (
      id: string,
      cwd: string,
      check: () => Promise<void>,
      repositories: readonly ProjectGitRepository[],
    ) => Promise<string>
  >(async (_id, _cwd, check) => {
    await check();
    return "workflow-turn";
  });
  const read = vi.fn(async (workspace: string): Promise<ProjectGitRepository[]> => [
    { kind: "primary", status: { ...status, workspace } },
    ...[...linked.values()].map((repository) => ({
      ...repository,
      status: { ...repository.status },
    })),
  ]);
  const changed = vi.fn();
  const project = vi.fn(async (id: string) => projects.get(id) ?? null);
  const diagnose = vi.fn();
  const workflow = new ProjectGitWorkflow({
    ...(group ? { group } : {}),
    project,
    activeThreads: async () => [...active],
    repositories: read,
    linkedRepositories: async () => [...linked.keys()],
    start,
    diagnose,
    changed,
  });
  return {
    workflow,
    active,
    start,
    read,
    changed,
    project,
    diagnose,
    projects,
    linked,
    status() {
      return { ...status };
    },
    setStatus(value: Partial<typeof status>) {
      status = { ...status, ...value };
    },
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
  it("isolates a missing directory in another active project without hiding its own error", async () => {
    const f = fixture();
    const missing = new GitWorkspaceError(
      "cannot change to '/missing/iot-app': No such file or directory",
      "",
      "fatal: cannot change to '/missing/iot-app': No such file or directory\n",
    );
    f.project.mockImplementation(async (id) => {
      if (id === "other") throw missing;
      return f.projects.get(id) ?? null;
    });
    f.active.add("other");
    expect(await f.workflow.run("a")).toMatchObject({ phase: "running", workspace: "/repo" });
    expect(f.diagnose).toHaveBeenCalledWith(missing);
    await expect(f.workflow.inspect("other")).rejects.toThrow("/missing/iot-app");
    f.workflow.close();
  });

  it("does not ignore permission errors when checking another active project", async () => {
    const f = fixture();
    const denied = new GitWorkspaceError(
      "cannot change to '/other': Permission denied",
      "",
      "fatal: cannot change to '/other': Permission denied\n",
    );
    f.project.mockImplementation(async (id) => {
      if (id === "other") throw denied;
      return f.projects.get(id) ?? null;
    });
    f.active.add("other");
    expect(await f.workflow.run("a")).toMatchObject({ phase: "failed" });
    expect(f.start).not.toHaveBeenCalled();
    f.workflow.close();
  });

  it("does not queue a turn action or attach it to another running workflow", async () => {
    const f = fixture();
    f.active.add("b");
    expect(await f.workflow.run("a", { waitForIdle: false })).toMatchObject({
      phase: "failed",
      turnId: null,
    });
    f.active.clear();
    f.workflow.activityChanged();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.start).not.toHaveBeenCalled();
    await f.workflow.run("b");
    await expect(f.workflow.run("a", { waitForIdle: false })).rejects.toThrow("正在执行");
    expect(f.start).toHaveBeenCalledOnce();
    f.workflow.close();
  });
  it("cancels a pending automatic push for commit-only and rejects an already running workflow", async () => {
    const f = fixture();
    await f.workflow.completed("a", "source-turn", "completed");
    await f.workflow.skipAutomatic("a");
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.start).not.toHaveBeenCalled();
    await f.workflow.run("a");
    expect(f.start).toHaveBeenCalledOnce();
    await expect(f.workflow.skipAutomatic("a")).rejects.toThrow("正在执行");
    f.workflow.close();
  });
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
    expect(f.start).toHaveBeenCalledExactlyOnceWith(
      "b",
      "/repo",
      expect.any(Function),
      expect.any(Array),
    );
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

  it("identifies a missing Git project as the task project, not the terminal directory", async () => {
    const f = fixture();
    f.projects.delete("a");
    f.workflow.forget("a");

    expect(await f.workflow.inspect("a")).toMatchObject({
      workspace: null,
      message: "当前任务的项目不是 Git 仓库",
    });
    expect(await f.workflow.run("a")).toMatchObject({
      workspace: null,
      message: "当前任务的项目不是 Git 仓库",
    });
  });

  it("re-resolves a changed project for the same task", async () => {
    const f = fixture();
    expect(await f.workflow.inspect("a")).toMatchObject({ workspace: "/repo" });
    f.projects.set("a", "/other");
    f.workflow.forget("a");
    expect(await f.workflow.inspect("a")).toMatchObject({ workspace: "/other" });
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
    expect(f.start).toHaveBeenLastCalledWith("c", "/repo", expect.any(Function), expect.any(Array));
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
    expect(f.start).toHaveBeenLastCalledWith("b", "/repo", expect.any(Function), expect.any(Array));
  });

  it("runs when only a linked repository has work and verifies every repository", async () => {
    const f = fixture();
    f.clean();
    const frontend: ProjectGitRepository = {
      kind: "linked",
      status: { ...f.status(), workspace: "/frontend", ahead: 1 },
    };
    f.linked.set("/frontend", frontend);
    expect((await f.workflow.run("a")).phase).toBe("running");
    const repositories = f.start.mock.calls[0]?.[3];
    if (!repositories) throw new Error("Missing workflow repositories");
    const prompt = projectGitWorkflowInput(repositories);
    expect(prompt).toContain('"path":"/frontend"');
    expect(prompt).toContain("先提交并推送最深层子模块");
    await f.workflow.completed("a", "workflow-turn", "completed");
    expect(await f.workflow.inspect("a")).toMatchObject({
      phase: "failed",
      message: expect.stringContaining("/frontend"),
    });
    frontend.status = { ...frontend.status, ahead: 0 };
    expect((await f.workflow.run("a")).phase).toBe("skipped");
  });

  it("does not claim success when a repository is unlinked during execution", async () => {
    const f = fixture();
    f.linked.set("/frontend", {
      kind: "linked",
      status: { ...f.status(), workspace: "/frontend" },
    });
    await f.workflow.run("a");
    f.clean();
    f.linked.clear();
    await f.workflow.completed("a", "workflow-turn", "completed");
    expect(await f.workflow.inspect("a")).toMatchObject({
      phase: "failed",
      message: expect.stringContaining("/frontend"),
    });
  });

  it("waits for a task whose primary repository is linked to the project", async () => {
    const f = fixture();
    f.projects.set("frontend-task", "/frontend");
    f.linked.set("/frontend", {
      kind: "linked",
      status: { ...f.status(), workspace: "/frontend" },
    });
    f.active.add("frontend-task");
    expect((await f.workflow.run("a")).phase).toBe("waiting");
    expect(f.start).not.toHaveBeenCalled();
    f.active.clear();
    f.workflow.activityChanged();
    await vi.advanceTimersByTimeAsync(750);
    expect((await f.workflow.inspect("a")).phase).toBe("running");
  });

  it("does not read Git state in unrelated active projects", async () => {
    const f = fixture();
    f.active.add("other");
    expect((await f.workflow.run("a")).phase).toBe("running");
    expect(f.read).toHaveBeenCalledExactlyOnceWith("/repo");
  });

  it.each([{ behind: 1 }, { operation: "merge" as const }, { detached: true }, { upstream: null }])(
    "does not skip an unsynchronized primary repository: %j",
    async (value) => {
      const f = fixture();
      f.clean();
      f.setStatus(value);
      expect((await f.workflow.run("a")).phase).toBe("running");
      await f.workflow.completed("a", "workflow-turn", "completed");
      expect((await f.workflow.inspect("a")).phase).toBe("failed");
    },
  );

  it("accepts unchanged detached submodules but rejects detached commits changed during execution", async () => {
    const f = fixture();
    f.clean();
    const submodule: ProjectGitRepository = {
      kind: "submodule",
      status: {
        ...f.status(),
        workspace: "/repo/lib",
        detached: true,
        upstream: null,
      },
    };
    f.linked.set("/repo/lib", submodule);
    expect((await f.workflow.run("a")).phase).toBe("skipped");
    f.setStatus({ ahead: 1 });
    await f.workflow.run("a");
    f.clean();
    submodule.status = { ...submodule.status, head: "new-detached" };
    await f.workflow.completed("a", "workflow-turn", "completed");
    expect(await f.workflow.inspect("a")).toMatchObject({
      phase: "failed",
      message: expect.stringContaining("/repo/lib"),
    });
  });

  it("does not accept a clean detached submodule whose gitlink was already changed", async () => {
    const f = fixture();
    f.clean();
    const submodule: ProjectGitRepository = {
      kind: "submodule",
      gitlinkChanged: true,
      status: { ...f.status(), workspace: "/repo/lib", detached: true, upstream: null },
    };
    f.linked.set("/repo/lib", submodule);
    expect((await f.workflow.run("a")).phase).toBe("running");
    submodule.gitlinkChanged = false;
    await f.workflow.completed("a", "workflow-turn", "completed");
    expect(await f.workflow.inspect("a")).toMatchObject({
      phase: "failed",
      message: expect.stringContaining("/repo/lib"),
    });
  });
});

it("serializes workflows sharing a linked repository and wakes the waiting project after release", async () => {
  const group = new ProjectGitWorkflowGroup();
  const first = fixture(group);
  const second = fixture(group);
  const shared: ProjectGitRepository = {
    kind: "linked",
    status: { ...first.status(), workspace: "/shared" },
  };
  first.linked.set("/shared", shared);
  second.linked.set("/shared", shared);
  await Promise.all([first.workflow.run("a"), second.workflow.run("other")]);
  expect(first.start.mock.calls.length + second.start.mock.calls.length).toBe(1);
  const running = first.start.mock.calls.length ? first : second;
  const waiting = running === first ? second : first;
  const runningId = running === first ? "a" : "other";
  const waitingId = running === first ? "other" : "a";
  expect((await waiting.workflow.inspect(waitingId)).phase).toBe("waiting");
  await running.workflow.completed(runningId, "workflow-turn", "completed");
  await vi.advanceTimersByTimeAsync(750);
  expect(waiting.start).toHaveBeenCalledTimes(1);
  expect((await waiting.workflow.inspect(waitingId)).phase).toBe("running");
  first.workflow.close();
  second.workflow.close();
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
