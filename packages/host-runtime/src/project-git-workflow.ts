import type { GitWorkflowSnapshot, GitWorkspaceStatus } from "@codexhost/shared-contracts";

interface Options {
  project(threadId: string): Promise<string | null>;
  activeThreads(): Promise<string[]>;
  status(workspace: string): Promise<GitWorkspaceStatus>;
  start(threadId: string, workspace: string, beforeStart: () => Promise<void>): Promise<string>;
  diagnose(error: unknown): void;
  quietMs?: number;
  changed?(): void;
  automatic?(): boolean;
  group?: ProjectGitWorkflowGroup;
}

interface Project {
  snapshot: GitWorkflowSnapshot;
  timer?: ReturnType<typeof setTimeout> | undefined;
  pending: Promise<void> | null;
  // 工作流启动响应可能晚于终态通知，先保留终态，避免覆盖已完成状态。
  terminal: { turnId: string; status: string } | null;
  // 推送期间完成的新任务合并成一次后续检查，工作流自身的终态不会进入这里。
  queuedThreadId: string | null;
  timerOwner?: ProjectGitWorkflow;
}

const initial = (workspace: string | null): GitWorkflowSnapshot => ({
  workspace,
  phase: "idle",
  threadId: null,
  turnId: null,
  message: "项目任务全部完成后自动推送",
});

export const projectGitWorkflowPrompt = [
  "执行项目推送代码工作流。用户已启用项目所有任务结束后自动触发，也可通过按钮手动触发。",
  "先确认当前仓库、分支和远程；提交当前项目各任务留下的改动，生成合适的 Conventional Commit 消息，再推送当前分支。没有新改动时只推送未推送提交；已经同步则不创建空提交。",
  "保留现有权限和审批设置，不扩大到其他仓库，不强推，不删除改动。遵循仓库中对敏感文件和生成产物的现有约束。",
  "推送被拒时先 fetch 并 merge，按真实改动解决冲突和验证后再推送；无法判断业务语义时保留现场并报告。",
  "用远端分支和本地 HEAD 验证推送结果；明确报告成功或失败。",
].join("\n");

// 由 Host 组合根注入，同一个本机/远程服务的客户端共享工作区锁和终态去重记录。
export class ProjectGitWorkflowGroup {
  readonly members = new Set<ProjectGitWorkflow>();
  readonly projects = new Map<string, Project>();
  readonly seen = new Set<string>();
}

// 一个工作区只有一个推送工作流；终态事件只负责唤醒，启动前重新检查全部活动任务。
export class ProjectGitWorkflow {
  readonly #group: ProjectGitWorkflowGroup;
  readonly #projects: Map<string, Project>;
  readonly #threads = new Map<string, Promise<string | null>>();
  readonly #seen: Set<string>;
  #observing = 0;
  #closed = false;

  constructor(private readonly options: Options) {
    this.#group = options.group ?? new ProjectGitWorkflowGroup();
    this.#group.members.add(this);
    this.#projects = this.#group.projects;
    this.#seen = this.#group.seen;
  }

  forget(threadId: string): void {
    this.#threads.delete(threadId);
  }

  #project(threadId: string): Promise<string | null> {
    let project = this.#threads.get(threadId);
    if (!project) {
      project = this.options.project(threadId).catch((error) => {
        this.#threads.delete(threadId);
        throw error;
      });
      this.#threads.set(threadId, project);
    }
    return project;
  }

  #state(workspace: string): Project {
    let project = this.#projects.get(workspace);
    if (!project) {
      project = {
        snapshot: initial(workspace),
        pending: null,
        terminal: null,
        queuedThreadId: null,
      };
      this.#projects.set(workspace, project);
    }
    return project;
  }

  async inspect(threadId: string): Promise<GitWorkflowSnapshot> {
    const workspace = await this.#project(threadId);
    return workspace
      ? {
          ...this.#state(workspace).snapshot,
          ...(this.options.automatic?.() === false &&
          this.#state(workspace).snapshot.phase === "idle"
            ? { message: "自动推送已关闭，可手动触发" }
            : {}),
        }
      : { ...initial(null), message: "当前项目不是 Git 仓库" };
  }

  async completed(threadId: string, turnId: string, status: string): Promise<void> {
    this.#observing++;
    try {
      await this.#completed(threadId, turnId, status);
    } finally {
      this.#observing--;
      this.#changed();
    }
  }

  #changed(): void {
    for (const member of this.#group.members) member.options.changed?.();
  }

  async #completed(threadId: string, turnId: string, status: string): Promise<void> {
    if (this.#closed) return;
    if (
      this.options.automatic?.() === false &&
      ![...this.#projects.values()].some(
        ({ snapshot }) =>
          snapshot.threadId === threadId &&
          (snapshot.phase === "starting" || snapshot.phase === "running"),
      )
    )
      return;
    const key = `${threadId}:${turnId}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    const oldest = this.#seen.values().next().value;
    if (this.#seen.size > 2048 && oldest) this.#seen.delete(oldest);
    this.forget(threadId);
    const workspace = await this.#project(threadId);
    if (!workspace || this.#closed) return;
    const project = this.#state(workspace);
    const snapshot = project.snapshot;
    if (
      snapshot.threadId === threadId &&
      (snapshot.phase === "starting" || snapshot.phase === "running")
    ) {
      if (snapshot.turnId === turnId || snapshot.turnId === null) {
        project.terminal = { turnId, status };
        if (snapshot.phase === "running") await this.#finish(project, status);
        return;
      }
    }
    // 失败或用户中止不会新增自动推送请求。
    if (status !== "completed" || this.options.automatic?.() === false) return;
    if (project.pending || snapshot.phase === "running") {
      project.queuedThreadId = threadId;
      return;
    }
    this.#wait(project, threadId);
  }

  #wait(project: Project, threadId: string): void {
    project.snapshot = {
      ...initial(project.snapshot.workspace),
      phase: "waiting",
      threadId,
      message: "等待项目其他任务结束",
    };
    this.#schedule(project);
  }

  #resumeQueued(project: Project): void {
    if (project.pending || project.snapshot.phase === "running" || this.#closed) return;
    const threadId = project.queuedThreadId;
    project.queuedThreadId = null;
    if (threadId) this.#wait(project, threadId);
  }

  #schedule(project: Project): void {
    clearTimeout(project.timer);
    project.timerOwner = this;
    project.timer = setTimeout(() => {
      project.timer = undefined;
      const id = project.snapshot.threadId;
      if (id && !this.#closed) void this.run(id).catch(this.options.diagnose);
    }, this.options.quietMs ?? 750);
    project.timer.unref?.();
  }

  // 其他任务失败、取消或子任务结束时也要重新判断已有的等待请求。
  activityChanged(): void {
    if (this.#closed) return;
    for (const project of this.#projects.values()) {
      if (project.snapshot.phase === "waiting") this.#schedule(project);
    }
  }

  async #isBusy(workspace: string): Promise<boolean> {
    const active = await Promise.all(
      [...this.#group.members].map((member) => member.options.activeThreads()),
    );
    const threads = [...new Set(active.flat())];
    const projects = await Promise.all(threads.map((id) => this.#project(id)));
    return projects.includes(workspace);
  }

  async run(threadId: string): Promise<GitWorkflowSnapshot> {
    if (this.#closed) throw new Error("推送工作流已关闭。");
    const workspace = await this.#project(threadId);
    if (!workspace) return { ...initial(null), message: "当前项目不是 Git 仓库" };
    const project = this.#state(workspace);
    clearTimeout(project.timer);
    if (project.pending || project.snapshot.phase === "running") return { ...project.snapshot };
    project.snapshot = {
      ...initial(workspace),
      phase: "starting",
      threadId,
      message: "正在准备推送工作流…",
    };
    project.terminal = null;
    project.pending = this.#start(project, threadId, workspace).finally(() => {
      project.pending = null;
      this.#resumeQueued(project);
      this.#changed();
    });
    await project.pending;
    return { ...project.snapshot };
  }

  async #start(project: Project, threadId: string, workspace: string): Promise<void> {
    const beforeStart = async (): Promise<void> => {
      if (this.#closed) throw new Error("推送工作流已关闭。");
      if (await this.#isBusy(workspace)) {
        project.snapshot = {
          ...project.snapshot,
          phase: "waiting",
          message: "等待项目其他任务结束",
        };
        throw new ProjectBusy();
      }
    };
    try {
      await beforeStart();
      const status = await this.options.status(workspace);
      if (!status.changes.length && status.ahead === 0 && status.upstream) {
        project.snapshot = { ...project.snapshot, phase: "skipped", message: "没有需要推送的改动" };
        return;
      }
      const turnId = await this.options.start(threadId, workspace, beforeStart);
      project.snapshot = {
        ...project.snapshot,
        phase: "running",
        turnId,
        message: "推送工作流运行中…",
      };
      if (project.terminal?.turnId === turnId) await this.#finish(project, project.terminal.status);
    } catch (error) {
      if (error instanceof ProjectBusy) return;
      project.snapshot = {
        ...project.snapshot,
        phase: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
      this.options.diagnose(error);
    }
  }

  async #finish(project: Project, outcome: string): Promise<void> {
    try {
      const workspace = project.snapshot.workspace;
      if (!workspace) throw new Error("推送工作流缺少项目路径。");
      const status = await this.options.status(workspace);
      const synchronized =
        outcome === "completed" &&
        !status.changes.length &&
        status.upstream !== null &&
        status.ahead === 0;
      project.snapshot = {
        ...project.snapshot,
        phase: synchronized ? "completed" : "failed",
        message: synchronized ? "推送工作流已完成" : "推送尚未完成，请查看任务结果后重试",
      };
    } catch (error) {
      project.snapshot = { ...project.snapshot, phase: "failed", message: String(error) };
      this.options.diagnose(error);
    } finally {
      this.#resumeQueued(project);
      this.#changed();
    }
  }

  get hasActiveWork(): boolean {
    return (
      [...this.#group.members].some((member) => member.#observing > 0) ||
      [...this.#projects.values()].some(
        ({ pending, timer, snapshot }) => pending || timer || snapshot.phase === "running",
      )
    );
  }

  close(): void {
    this.#closed = true;
    this.#group.members.delete(this);
    const successor = this.#group.members.values().next().value;
    for (const project of this.#projects.values()) {
      if (project.timerOwner !== this) continue;
      clearTimeout(project.timer);
      project.timer = undefined;
      if (successor && project.snapshot.phase === "waiting") successor.#schedule(project);
    }
  }
}

class ProjectBusy extends Error {}
