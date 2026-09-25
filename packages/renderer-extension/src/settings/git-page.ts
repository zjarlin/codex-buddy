import type {
  GitChange,
  GitDiffResult,
  GitCommitParams,
  GitDiffParams,
  GitMessageGenerateParams,
  GitMessageModel,
  GitStageParams,
  GitWorkspaceParams,
  GitWorkspaceStatus,
  GitLogParams,
  GitLogResult,
  GitCommitDetail,
  GitCommitDetailParams,
  GitCommitDiffParams,
  GitSubmoduleUpdateParams,
  HostThreadId,
} from "@codexhost/shared-contracts";

import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";
import { parseUnifiedDiff } from "./git-diff.js";

export interface RendererGitClient {
  inspectGitStatus(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  inspectGitDiff(input: GitDiffParams): Promise<GitDiffResult>;
  stageGitPaths(input: GitStageParams): Promise<GitWorkspaceStatus>;
  unstageGitPaths(input: GitStageParams): Promise<GitWorkspaceStatus>;
  commitGit(input: GitCommitParams): Promise<{
    commit: string | null;
    pushed: boolean;
    output: string;
    status: GitWorkspaceStatus;
  }>;
  pushGit(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  listGitMessageModels(input: GitWorkspaceParams): Promise<{
    models: GitMessageModel[];
    defaultModel: string | null;
  }>;
  generateGitMessage(input: GitMessageGenerateParams): Promise<{ message: string; model: string }>;
  listGitSubmodules?(
    input: GitWorkspaceParams,
  ): Promise<{ submodules: { path: string; status: string }[] }>;
  updateGitSubmodule?(input: GitSubmoduleUpdateParams): Promise<GitWorkspaceStatus>;
  inspectGitLog?(input: GitLogParams): Promise<GitLogResult>;
  inspectGitCommit?(input: GitCommitDetailParams): Promise<GitCommitDetail>;
  inspectGitCommitDiff?(input: GitCommitDiffParams): Promise<GitDiffResult>;
}

export interface RendererGitContext {
  threadId: HostThreadId | null;
  client: RendererGitClient | null;
}

function statusLabel(change: GitChange): string {
  const status = change.conflicted ? "!" : statusLetter(change);
  return status;
}

function statusLetter(change: GitChange): string {
  const value = change.indexStatus !== " " ? change.indexStatus : change.workTreeStatus;
  if (change.untracked || value === "?") return "U";
  if (value === "A") return "A";
  if (value === "D") return "D";
  if (value === "R" || value === "C") return "R";
  return "M";
}

function displayPath(pathValue: string, originalPath?: string): string {
  return originalPath ? `${originalPath} → ${pathValue}` : pathValue;
}

function pathParts(pathValue: string): { name: string; directory: string } {
  const separator = pathValue.lastIndexOf("/");
  return separator === -1
    ? { name: pathValue, directory: "" }
    : { name: pathValue.slice(separator + 1), directory: pathValue.slice(0, separator) };
}

function fileKind(pathValue: string): string {
  const name = pathValue.slice(pathValue.lastIndexOf("/") + 1);
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return (extension || "file").slice(0, 3).toUpperCase();
}

function createButton(
  document: Document,
  label: string,
  kind: "primary" | "secondary" | "danger" = "secondary",
  icon?: SVGElement,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `settings-command-button${kind === "secondary" ? " settings-command-button--secondary" : kind === "danger" ? " settings-command-button--danger" : ""}`;
  if (icon) button.append(icon, label);
  else button.textContent = label;
  return button;
}

export function createGitSettingsPage(
  messages: RendererSettingsMessages,
  getContext: () => RendererGitContext,
): RendererSettingsPageDefinition {
  return Object.freeze({
    id: "git",
    label: messages.pageLabels.git,
    icon: "git",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      context.content.className = [context.content.className, "settings-git-page"]
        .filter(Boolean)
        .join(" ");
      const refresh = createButton(
        document,
        messages.gitRefresh,
        "secondary",
        createRendererSettingsIcon("refresh", 15),
      );
      refresh.title = messages.gitRefresh;
      refresh.textContent = "";
      refresh.append(createRendererSettingsIcon("refresh", 15));

      const notice = document.createElement("div");
      notice.className = "settings-git-notice";
      notice.setAttribute("role", "status");
      notice.hidden = true;

      const summary = document.createElement("div");
      summary.className = "settings-git-summary";
      const branchValue = document.createElement("strong");
      const aheadValue = document.createElement("span");
      summary.append(branchValue, aheadValue);

      const workspace = document.createElement("p");
      workspace.className = "settings-git-workspace";

      const layout = document.createElement("div");
      layout.className = "settings-git-layout";
      const changesPanel = document.createElement("section");
      changesPanel.className = "settings-git-changes";
      const changesHead = document.createElement("div");
      changesHead.className = "settings-git-panel-title";
      changesHead.textContent = messages.gitChanges;
      const changeList = document.createElement("div");
      changeList.className = "settings-git-change-list";
      changesPanel.append(changesHead, changeList);

      const submodulePanel = document.createElement("section");
      submodulePanel.className = "settings-git-submodules";
      const submoduleHead = document.createElement("div");
      submoduleHead.className = "settings-git-panel-title";
      submoduleHead.textContent = messages.gitSubmodules;
      const submoduleList = document.createElement("div");
      submoduleList.className = "settings-git-submodule-list";
      submodulePanel.append(submoduleHead, submoduleList);

      const diffPanel = document.createElement("section");
      diffPanel.className = "settings-git-diff";
      const diffHead = document.createElement("div");
      diffHead.className = "settings-git-panel-title";
      diffHead.textContent = messages.gitDiff;
      const diffScroll = document.createElement("div");
      diffScroll.className = "settings-git-diff-scroll";
      const diffBody = document.createElement("div");
      diffBody.className = "settings-git-diff-body";
      const diffPlaceholder = document.createElement("p");
      diffPlaceholder.className = "settings-git-empty";
      diffPlaceholder.textContent = messages.gitSelectFile;
      diffBody.append(diffPlaceholder);
      diffScroll.append(diffBody);
      diffPanel.append(diffHead, diffScroll);

      const composer = document.createElement("section");
      composer.className = "settings-git-composer";
      const message = document.createElement("textarea");
      message.className = "settings-git-message";
      message.rows = 3;
      message.placeholder = messages.gitCommitMessagePlaceholder;
      message.setAttribute("aria-label", messages.gitCommitMessage);

      const modelRow = document.createElement("div");
      modelRow.className = "settings-git-model-row";
      const modelLabel = document.createElement("label");
      modelLabel.textContent = messages.gitMessageModel;
      const modelSelect = document.createElement("select");
      modelSelect.className = "settings-git-model";
      modelLabel.append(modelSelect);
      const generate = createButton(
        document,
        messages.gitGenerateMessage,
        "secondary",
        createRendererSettingsIcon("sparkles", 15),
      );
      modelRow.append(modelLabel, generate);

      const actions = document.createElement("div");
      actions.className = "settings-git-actions";
      const stageAll = createButton(document, messages.gitStageAll);
      const commit = createButton(
        document,
        messages.gitCommit,
        "secondary",
        createRendererSettingsIcon("check", 14),
      );
      const commitPush = createButton(
        document,
        messages.gitCommitAndPush,
        "primary",
        createRendererSettingsIcon("upload", 14),
      );
      const push = createButton(document, messages.gitPush, "secondary");
      actions.append(commitPush, commit);
      const secondaryActions = document.createElement("div");
      secondaryActions.className = "settings-git-actions settings-git-actions--secondary";
      secondaryActions.append(stageAll, push);
      composer.append(message, modelRow, actions, secondaryActions);

      const sidebar = document.createElement("div");
      sidebar.className = "settings-git-sidebar";
      const sidebarHeader = document.createElement("div");
      sidebarHeader.className = "settings-git-sidebar-header";
      const sidebarTitle = document.createElement("strong");
      sidebarTitle.textContent = messages.gitSourceControl;
      sidebarHeader.append(sidebarTitle, refresh);
      const branchRow = document.createElement("div");
      branchRow.className = "settings-git-branch-row";
      const branchIcon = createRendererSettingsIcon("git", 14);
      branchRow.append(branchIcon, summary);
      sidebar.append(sidebarHeader, composer, branchRow, changesPanel, submodulePanel);
      layout.append(sidebar, diffPanel);

      context.content.append(notice, layout);

      let current: GitWorkspaceStatus | null = null;
      let selectedPath: string | null = null;
      let busy = false;
      let modelsLoaded = false;
      const collapsedGroups = new Set<"staged" | "unstaged" | "conflicts">();

      const setNotice = (text: string, error = false): void => {
        notice.textContent = text;
        notice.className = error
          ? "settings-git-notice settings-git-notice--error"
          : "settings-git-notice";
        notice.hidden = text.length === 0;
      };

      const renderDiff = (result: GitDiffResult): void => {
        diffBody.replaceChildren();
        if (!result.diff) {
          const empty = document.createElement("p");
          empty.className = "settings-git-empty";
          empty.textContent = messages.gitNoDiff;
          diffBody.append(empty);
          return;
        }
        if (result.truncated && !result.diff.startsWith("diff --git")) {
          const fallback = document.createElement("pre");
          fallback.className = "settings-git-diff-fallback";
          fallback.textContent = `${messages.gitDiffTruncated}\n\n${result.diff}`;
          diffBody.append(fallback);
          return;
        }
        const table = document.createElement("div");
        table.className = "settings-git-diff-table";
        for (const line of parseUnifiedDiff(result.diff)) {
          if (line.kind === "hunk") {
            const hunk = document.createElement("div");
            hunk.className = "settings-git-diff-hunk";
            hunk.textContent = line.code;
            table.append(hunk);
            continue;
          }
          if (line.kind === "meta") {
            const meta = document.createElement("div");
            meta.className = "settings-git-diff-meta";
            meta.textContent = line.code;
            table.append(meta);
            continue;
          }
          const row = document.createElement("div");
          row.className = `settings-git-diff-line is-${line.kind}`;
          const oldNumber = document.createElement("span");
          oldNumber.className = "settings-git-diff-line__number";
          oldNumber.textContent = line.oldLine;
          const newNumber = document.createElement("span");
          newNumber.className = "settings-git-diff-line__number";
          newNumber.textContent = line.newLine;
          const marker = document.createElement("span");
          marker.className = "settings-git-diff-line__marker";
          marker.textContent = line.marker;
          const code = document.createElement("span");
          code.className = "settings-git-diff-line__code";
          code.textContent = line.code;
          row.append(oldNumber, newNumber, marker, code);
          table.append(row);
        }
        diffBody.append(table);
        if (result.truncated) {
          const truncated = document.createElement("div");
          truncated.className = "settings-git-diff-meta";
          truncated.textContent = messages.gitDiffTruncated;
          table.append(truncated);
        }
      };

      const stagedPaths = (): string[] =>
        (current?.changes ?? [])
          .filter((change) => change.staged && !change.conflicted)
          .map((change) => change.path);

      const updateBusy = (): void => {
        refresh.disabled = busy;
        commit.disabled = busy || message.value.trim().length === 0 || stagedPaths().length === 0;
        commitPush.disabled = commit.disabled;
        push.disabled = busy || !current || current.upstream === null || current.ahead === 0;
        stageAll.disabled = busy || !current || current.changes.length === 0;
        generate.disabled = busy || !current || current.changes.length === 0 || !modelSelect.value;
        message.disabled = busy;
        modelSelect.disabled = busy || !modelsLoaded;
      };

      const showDiffFor = async (pathValue: string): Promise<void> => {
        const request = getContext();
        if (!request.threadId || !request.client) return;
        selectedPath = pathValue;
        diffHead.textContent = `${messages.gitDiff} · ${pathValue}`;
        diffBody.replaceChildren();
        const loading = document.createElement("p");
        loading.className = "settings-git-empty";
        loading.textContent = messages.gitLoading;
        diffBody.append(loading);
        try {
          const result = await request.client.inspectGitDiff({
            threadId: request.threadId,
            path: pathValue,
          });
          if (selectedPath !== pathValue) return;
          renderDiff(result);
        } catch (error) {
          diffBody.replaceChildren();
          const failure = document.createElement("p");
          failure.className = "settings-git-empty";
          failure.textContent = error instanceof Error ? error.message : String(error);
          diffBody.append(failure);
        }
      };

      const run = async (operation: () => Promise<unknown>, success: string): Promise<void> => {
        if (busy) return;
        busy = true;
        updateBusy();
        setNotice("");
        let failed = false;
        try {
          await operation();
          setNotice(success);
        } catch (error) {
          failed = true;
          setNotice(error instanceof Error ? error.message : String(error), true);
        } finally {
          busy = false;
          updateBusy();
        }
        if (!failed) {
          await load();
          setNotice(success);
        }
      };

      const toggleStaged = async (change: GitChange, staged: boolean): Promise<void> => {
        const request = getContext();
        if (!request.threadId || !request.client || busy) return;
        await run(
          () => {
            if (!request.client || !request.threadId) {
              return Promise.reject(new Error("Git unavailable"));
            }
            return staged
              ? request.client.unstageGitPaths({
                  threadId: request.threadId,
                  paths: [change.path],
                })
              : request.client.stageGitPaths({
                  threadId: request.threadId,
                  paths: [change.path],
                });
          },
          staged ? messages.gitUnstagedSuccess : messages.gitStagedSuccess,
        );
      };

      const renderChange = (change: GitChange): HTMLElement => {
        const row = document.createElement("div");
        row.className = "settings-git-change";
        row.dataset.selected = String(selectedPath === change.path);
        row.dataset.path = change.path;
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.title = displayPath(change.path, change.originalPath);
        const kind = document.createElement("span");
        kind.className = "settings-git-change__kind";
        kind.textContent = fileKind(change.path);
        const copy = document.createElement("span");
        copy.className = "settings-git-change__copy";
        const parts = pathParts(change.path);
        const pathLabel = document.createElement("strong");
        pathLabel.textContent = parts.name;
        const detail = document.createElement("span");
        detail.textContent = parts.directory;
        copy.append(pathLabel, detail);
        const controls = document.createElement("span");
        controls.className = "settings-git-change__controls";
        const showDiff = document.createElement("button");
        showDiff.type = "button";
        showDiff.className = "settings-git-change__action";
        showDiff.title = messages.gitShowDiff;
        showDiff.setAttribute("aria-label", messages.gitShowDiff);
        showDiff.append(createRendererSettingsIcon("file-diff", 14));
        showDiff.addEventListener("click", (event) => {
          event.stopPropagation();
          void showDiffFor(change.path);
        });
        const stage = document.createElement("button");
        stage.type = "button";
        stage.className = "settings-git-change__action";
        const staged = change.staged && !change.untracked;
        stage.title = staged ? messages.gitUnstage : messages.gitStageFile;
        stage.setAttribute("aria-label", stage.title);
        stage.append(createRendererSettingsIcon(staged ? "undo" : "add", 14));
        stage.disabled = busy || change.conflicted;
        stage.addEventListener("click", (event) => {
          event.stopPropagation();
          void toggleStaged(change, staged);
        });
        controls.append(showDiff, stage);
        const badge = document.createElement("span");
        badge.className = "settings-git-change__badge";
        badge.dataset.status = statusLetter(change);
        badge.textContent = statusLabel(change);
        row.append(kind, copy, controls, badge);
        row.addEventListener("click", () => {
          void showDiffFor(change.path);
        });
        row.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          void showDiffFor(change.path);
        });
        return row;
      };

      const render = (): void => {
        changeList.replaceChildren();
        submoduleList.replaceChildren();
        if (!current) {
          branchValue.textContent = messages.gitUnavailable;
          aheadValue.textContent = "";
          updateBusy();
          return;
        }
        workspace.textContent = current.workspace;
        branchValue.textContent = current.detached
          ? messages.gitDetached
          : (current.branch ?? messages.gitUnknownBranch);
        aheadValue.textContent =
          current.upstream === null
            ? messages.gitNoUpstream
            : messages.gitAheadBehind(current.ahead, current.behind);
        changesHead.textContent = messages.gitChanges;
        const count = document.createElement("span");
        count.className = "settings-git-group-count";
        count.textContent = String(current.changes.length);
        changesHead.append(count);
        if (current.changes.length === 0) {
          const empty = document.createElement("p");
          empty.className = "settings-git-empty";
          empty.textContent = messages.gitNoChanges;
          changeList.append(empty);
        }
        const groups: Array<{
          id: "staged" | "unstaged" | "conflicts";
          label: string;
          changes: GitChange[];
        }> = [
          {
            id: "conflicts",
            label: messages.gitConflicts,
            changes: current.changes.filter((change) => change.conflicted),
          },
          {
            id: "staged",
            label: messages.gitStagedChanges,
            changes: current.changes.filter((change) => change.staged && !change.conflicted),
          },
          {
            id: "unstaged",
            label: messages.gitUnstagedChanges,
            changes: current.changes.filter((change) => !change.staged && !change.conflicted),
          },
        ];
        for (const group of groups) {
          if (group.changes.length === 0) continue;
          const section = document.createElement("section");
          section.className = "settings-git-change-group";
          const collapsed = collapsedGroups.has(group.id);
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "settings-git-group-toggle";
          toggle.setAttribute("aria-expanded", String(!collapsed));
          toggle.append(
            createRendererSettingsIcon(collapsed ? "chevron-right" : "chevron-down", 14),
            group.label,
          );
          const count = document.createElement("span");
          count.className = "settings-git-group-count";
          count.textContent = String(group.changes.length);
          toggle.append(count);
          toggle.addEventListener("click", () => {
            if (collapsed) collapsedGroups.delete(group.id);
            else collapsedGroups.add(group.id);
            render();
          });
          section.append(toggle);
          if (!collapsed) {
            for (const change of group.changes) {
              section.append(renderChange(change));
            }
          }
          changeList.append(section);
        }
        if (!busy) updateBusy();
      };

      const renderSubmodules = (): void => {
        submoduleList.replaceChildren();
        const entries = current?.submodules ?? [];
        if (!entries.length) {
          const empty = document.createElement("p");
          empty.className = "settings-git-empty";
          empty.textContent = messages.gitNoSubmodules;
          submoduleList.append(empty);
          return;
        }
        for (const submodule of entries) {
          const row = document.createElement("div");
          row.className = "settings-git-submodule";
          const copy = document.createElement("span");
          copy.className = "settings-git-submodule__copy";
          const name = document.createElement("strong");
          name.textContent = submodule.path;
          const status = document.createElement("span");
          status.textContent = submodule.status;
          copy.append(name, status);
          const update = createButton(
            document,
            submodule.status === "uninitialized"
              ? messages.gitInitializeSubmodule
              : messages.gitUpdateSubmodule,
          );
          const context = getContext();
          update.disabled =
            busy || submodule.status === "current" || !context.client?.updateGitSubmodule;
          update.addEventListener("click", () => {
            const request = getContext();
            const client = request.client;
            const threadId = request.threadId;
            const updateSubmodule = client?.updateGitSubmodule;
            if (!threadId || !updateSubmodule) return;
            void run(
              () =>
                updateSubmodule({
                  threadId,
                  path: submodule.path,
                  init: submodule.status === "uninitialized",
                }),
              messages.gitSubmoduleUpdated,
            );
          });
          row.append(copy, update);
          submoduleList.append(row);
        }
      };

      const load = async (): Promise<boolean> => {
        const request = getContext();
        if (!request.threadId || !request.client) {
          current = null;
          workspace.textContent = messages.gitNoThread;
          render();
          return false;
        }
        busy = true;
        updateBusy();
        setNotice("");
        try {
          current = await request.client.inspectGitStatus({ threadId: request.threadId });
          render();
          renderSubmodules();
          const first = current.changes[0];
          if (first) await showDiffFor(first.path);
          return true;
        } catch (error) {
          current = null;
          render();
          setNotice(error instanceof Error ? error.message : String(error), true);
          return false;
        } finally {
          busy = false;
          updateBusy();
        }
      };

      const loadModels = async (): Promise<void> => {
        const request = getContext();
        if (!request.threadId || !request.client) return;
        try {
          const result = await request.client.listGitMessageModels({ threadId: request.threadId });
          modelSelect.replaceChildren();
          for (const model of result.models.filter((candidate) => candidate.eligible)) {
            const option = document.createElement("option");
            option.value = model.id;
            option.textContent = `${model.label} · ${model.tier}`;
            option.dataset.tier = model.tier;
            modelSelect.append(option);
          }
          if (result.defaultModel) modelSelect.value = result.defaultModel;
          modelsLoaded = modelSelect.childElementCount > 0;
          if (!modelsLoaded) setNotice(messages.gitNoMessageModel);
        } catch (error) {
          modelsLoaded = false;
          setNotice(error instanceof Error ? error.message : String(error), true);
        } finally {
          updateBusy();
        }
      };

      refresh.addEventListener("click", () => void load());
      stageAll.addEventListener("click", () => {
        const { threadId, client } = getContext();
        if (!threadId || !client || !current) return;
        const paths = current.changes
          .filter((change) => !change.conflicted)
          .map((change) => change.path);
        void run(() => client.stageGitPaths({ threadId, paths }), messages.gitStagedSuccess);
      });
      message.addEventListener("input", updateBusy);
      generate.addEventListener("click", () => {
        const { threadId, client } = getContext();
        if (!threadId || !client || !modelSelect.value) return;
        void run(async () => {
          const result = await client.generateGitMessage({
            threadId,
            model: modelSelect.value,
            paths: stagedPaths(),
          });
          if (result) message.value = result.message;
        }, messages.gitMessageGenerated);
      });
      commit.addEventListener("click", () => {
        const { threadId, client } = getContext();
        if (!threadId || !client) return;
        void run(async () => {
          await client.commitGit({
            threadId,
            message: message.value,
            paths: stagedPaths(),
            push: false,
          });
          message.value = "";
        }, messages.gitCommitted);
      });
      commitPush.addEventListener("click", () => {
        const { threadId, client } = getContext();
        if (!threadId || !client) return;
        void run(async () => {
          await client.commitGit({
            threadId,
            message: message.value,
            paths: stagedPaths(),
            push: true,
          });
          message.value = "";
        }, messages.gitCommittedAndPushed);
      });
      push.addEventListener("click", () => {
        const { threadId, client } = getContext();
        if (!threadId || !client) return;
        void run(() => client.pushGit({ threadId }), messages.gitPushed);
      });

      context.content.tabIndex = -1;
      render();
      void load();
      void loadModels();
      return () => {
        current = null;
      };
    },
  });
}
