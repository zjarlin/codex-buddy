import {
  GIT_REPOSITORIES_METHOD,
  GIT_REPOSITORY_LINK_METHOD,
  GIT_REPOSITORY_UNLINK_METHOD,
  gitRepositoriesParamsSchema,
  gitWorkflowParamsSchema,
  type GitWorkflowParams,
  gitRepositoryLinkParamsSchema,
  gitRepositoriesSchema,
  type GitRepositoriesParams,
  type GitRepositoryLinkParams,
  type GitRepositories,
} from "@codexhost/shared-contracts";
import {
  PROJECT_SYNC_INSPECT_METHOD,
  PROJECT_SYNC_INVITE_METHOD,
  PROJECT_SYNC_PAIR_METHOD,
  PROJECT_SYNC_ACCEPT_METHOD,
  PROJECT_SYNC_REJECT_METHOD,
  PROJECT_SYNC_GIT_CONFIGURE_METHOD,
  PROJECT_SYNC_GIT_PULL_METHOD,
  PROJECT_SYNC_GIT_PUSH_METHOD,
  PROJECT_SYNC_SYNC_METHOD,
  PROJECT_SYNC_REMOVE_PEER_METHOD,
  PROJECT_SYNC_ADD_METHOD,
  PROJECT_SYNC_BIND_METHOD,
  PROJECT_SYNC_CLONE_METHOD,
  projectSyncSnapshotSchema,
  projectSyncInviteSchema,
  projectSyncPairParamsSchema,
  projectSyncRequestParamsSchema,
  projectSyncGitConfigureParamsSchema,
  projectSyncPeerParamsSchema,
  projectSyncAddParamsSchema,
  projectSyncBindParamsSchema,
  projectSyncCloneParamsSchema,
  type ProjectSyncSnapshot,
  type ProjectSyncInvite,
  type ProjectSyncPairParams,
  type ProjectSyncRequestParams,
  type ProjectSyncGitConfigureParams,
  type ProjectSyncPeerParams,
  type ProjectSyncAddParams,
  type ProjectSyncBindParams,
  type ProjectSyncCloneParams,
  GIT_WORKFLOW_STATUS_METHOD,
  GIT_WORKFLOW_RUN_METHOD,
  gitWorkflowSnapshotSchema,
  type GitWorkflowSnapshot,
  GIT_STATUS_METHOD,
  GIT_DIFF_METHOD,
  GIT_CONTENT_METHOD,
  GIT_STAGE_METHOD,
  GIT_UNSTAGE_METHOD,
  GIT_COMMIT_METHOD,
  GIT_PUSH_METHOD,
  GIT_MESSAGE_MODEL_METHOD,
  GIT_MESSAGE_GENERATE_METHOD,
  GIT_SUBMODULES_METHOD,
  GIT_SUBMODULE_UPDATE_METHOD,
  GIT_LOG_METHOD,
  GIT_COMMIT_DETAIL_METHOD,
  GIT_COMMIT_DIFF_METHOD,
  GIT_FETCH_METHOD,
  GIT_SYNC_METHOD,
  GIT_MERGE_CONTINUE_METHOD,
  GIT_MERGE_ABORT_METHOD,
  gitWorkspaceParamsSchema,
  gitDiffParamsSchema,
  gitContentParamsSchema,
  gitStageParamsSchema,
  gitCommitParamsSchema,
  gitMessageGenerateParamsSchema,
  gitSubmoduleUpdateParamsSchema,
  gitLogParamsSchema,
  gitCommitDetailParamsSchema,
  gitCommitDiffParamsSchema,
  gitWorkspaceStatusSchema,
  gitDiffResultSchema,
  gitContentResultSchema,
  gitCommitResultSchema,
  gitSyncResultSchema,
  gitMessageModelsSchema,
  gitGeneratedMessageSchema,
  gitSubmoduleListSchema,
  gitLogResultSchema,
  gitCommitDetailSchema,
  type GitWorkspaceParams,
  type GitDiffParams,
  type GitContentParams,
  type GitStageParams,
  type GitCommitParams,
  type GitMessageGenerateParams,
  type GitWorkspaceStatus,
  type GitDiffResult,
  type GitContentResult,
  type GitCommitResult,
  type GitSyncResult,
  type GitMessageModels,
  type GitGeneratedMessage,
  type GitSubmoduleList,
  type GitLogParams,
  type GitLogResult,
  type GitCommitDetail,
  type GitCommitDetailParams,
  type GitCommitDiffParams,
  type GitSubmoduleUpdateParams,
  WORKSPACE_FILES_LIST_METHOD,
  WORKSPACE_FILES_READ_METHOD,
  WORKSPACE_FILES_WRITE_METHOD,
  workspaceFilesListParamsSchema,
  workspaceFilesListResultSchema,
  workspaceFileReadParamsSchema,
  workspaceFileReadResultSchema,
  workspaceFileWriteParamsSchema,
  workspaceFileWriteResultSchema,
  type WorkspaceFilesListParams,
  type WorkspaceFilesListResult,
  type WorkspaceFileReadParams,
  type WorkspaceFileReadResult,
  type WorkspaceFileWriteParams,
  type WorkspaceFileWriteResult,
  THREAD_TERMINAL_OPEN_METHOD,
  THREAD_TERMINAL_LIST_METHOD,
  threadTerminalListParamsSchema,
  threadTerminalListResultSchema,
  threadTerminalOpenParamsSchema,
  threadTerminalOpenResultSchema,
  type ThreadTerminalListResult,
  type ThreadTerminalOpenParams,
  type ThreadTerminalOpenResult,
  BUDDY_INTERRUPTED_METHOD,
  BUDDY_CONTINUE_METHOD,
  buddyInterruptedSchema,
  type BuddyInterrupted,
  BUDDY_PRIVATE_METHOD,
  buddyPrivateRequestSchema,
  buddyPrivateSnapshotSchema,
  type BuddyPrivateRequest,
  type BuddyPrivateSnapshot,
  BUDDY_MODELS_METHOD,
  BUDDY_CATALOG_SYNC_METHOD,
  buddyCatalogSyncSchema,
  type BuddyCatalogSync,
  BUDDY_JEV_KEY_METHOD,
  BUDDY_STATUS_METHOD,
  BUDDY_SETTINGS_METHOD,
  BUDDY_CANCEL_METHOD,
  BUDDY_ANSWER_METHOD,
  buddyAnswerSchema,
  type BuddyAnswer,
  buddySnapshotSchema,
  type BuddySnapshot,
  type BuddySettings,
} from "@codexhost/shared-contracts";
import {
  IDLE_RELEASE_SETTINGS_METHOD,
  LOADED_SESSIONS_METHOD,
  loadedSessionsSchema,
  type LoadedSession,
  idleReleaseSettingsSchema,
  type IdleReleaseSettings,
  harnessAccountInspectParamsSchema,
  harnessAccountInspectResultSchema,
  harnessAccountSourceListResultSchema,
  type HarnessAccountInspectParams,
  type HarnessAccountInspectResult,
  type HarnessAccountSourceListResult,
  harnessAccountListParamsSchema,
  harnessAccountListResultSchema,
  type HarnessAccountListParams,
  type HarnessAccountListResult,
  codexAccountUsageParamsSchema,
  codexAccountUsageResultSchema,
  type CodexAccountUsageParams,
  type CodexAccountUsageResult,
  codexAccountChangedSchema,
  codexAccountListResultSchema,
  externalThreadForkParamsSchema,
  externalThreadForkResultSchema,
  harnessCommandCatalogSchema,
  harnessCommandsInspectParamsSchema,
  harnessConfigurationStateSchema,
  harnessInspectParamsSchema,
  harnessInspectionSchema,
  harnessPluginListResultSchema,
  type HarnessPluginListResult,
  harnessWebUiOpenParamsSchema,
  harnessWebUiOpenResultSchema,
  harnessModelSelectionStateSchema,
  hostThreadIdSchema,
  threadInspectionParamsSchema,
  threadInspectionSchema,
  threadCommandExecuteParamsSchema,
  threadCommandExecuteResultSchema,
  threadCommandsInspectParamsSchema,
  threadModelSelectParamsSchema,
  threadPermissionModeSelectParamsSchema,
  threadThinkingSelectParamsSchema,
  threadOwnershipListParamsSchema,
  threadOwnershipListResultSchema,
  threadUsageInspectionParamsSchema,
  threadUsageInspectionSchema,
  updateCheckResultSchema,
  updateEmptyParamsSchema,
  updateStartResultSchema,
  updateStatusResultSchema,
  type ExternalThreadForkParams,
  type ExternalThreadForkResult,
  type CodexAccountChanged,
  type CodexAccountListResult,
  type HarnessCommandCatalog,
  type HarnessCommandsInspectParams,
  type HarnessConfigurationState,
  type HarnessInspection,
  type HarnessInspectParams,
  type HarnessWebUiOpenParams,
  type HarnessModelSelectionState,
  type ThreadInspection,
  type ThreadInspectionParams,
  type ThreadCommandExecuteParams,
  type ThreadCommandExecuteResult,
  type ThreadCommandsInspectParams,
  type ThreadModelSelectParams,
  type ThreadPermissionModeSelectParams,
  type ThreadThinkingSelectParams,
  type ThreadOwnershipListParams,
  type ThreadOwnershipListResult,
  type ThreadUsageInspection,
  type ThreadUsageInspectionParams,
  type UpdateCheckResult,
  type UpdateStartResult,
  type UpdateStatusResult,
} from "@codexhost/shared-contracts";

import {
  createRendererRequestSender,
  RendererMethodUnavailableError,
} from "./renderer-request-sender.js";
import {
  createRendererSessionImportClient,
  type RendererSessionImportClient,
} from "./renderer-session-import-client.js";

export const HARNESS_INSPECT_METHOD = "codexhost/harness/inspect";
export const HARNESS_PLUGIN_LIST_METHOD = "codexhost/harness/plugins/list";
export const HARNESS_ACCOUNT_SOURCES_METHOD = "codexhost/harness/accounts/sources";
export const HARNESS_ACCOUNT_INSPECT_METHOD = "codexhost/harness/accounts/inspect";
export const HARNESS_WEB_UI_OPEN_METHOD = "codexhost/harness/web-ui/open";
export const THREAD_FORK_METHOD = "codexhost/thread/fork";
export const THREAD_INSPECT_METHOD = "codexhost/thread/inspect";
export const HARNESS_COMMANDS_INSPECT_METHOD = "codexhost/harness/commands/inspect";
export const THREAD_COMMANDS_INSPECT_METHOD = "codexhost/thread/commands/inspect";
export const THREAD_COMMAND_EXECUTE_METHOD = "codexhost/thread/command/execute";
export const THREAD_MODEL_SELECT_METHOD = "codexhost/thread/model/select";
export const THREAD_THINKING_SELECT_METHOD = "codexhost/thread/thinking/select";
export const THREAD_PERMISSION_MODE_SELECT_METHOD = "codexhost/thread/permission-mode/select";
export const THREAD_OWNERSHIP_LIST_METHOD = "codexhost/thread/ownership/list";
export const THREAD_USAGE_INSPECT_METHOD = "codexhost/thread/usage/inspect";
export const THREAD_USAGE_UPDATED_METHOD = "codexhost/thread/usage/updated";
export const THREAD_TOKEN_USAGE_UPDATED_METHOD = "thread/tokenUsage/updated";
/**
 * Codex Desktop does not dispatch the custom `codexhost/thread/usage/updated`
 * notification to renderer callbacks, and the native token-usage carrier is
 * only projected once Context usage is known. Turn completion is dispatched,
 * so it is the guaranteed point to re-read account quota after a reply.
 */
export const TURN_COMPLETED_METHOD = "turn/completed";
const THREAD_USAGE_REFRESH_METHODS = [
  THREAD_TOKEN_USAGE_UPDATED_METHOD,
  THREAD_USAGE_UPDATED_METHOD,
  TURN_COMPLETED_METHOD,
] as const;
export const UPDATE_CHECK_METHOD = "codexhost/update/check";
export const UPDATE_START_METHOD = "codexhost/update/start";
export const UPDATE_STATUS_METHOD = "codexhost/update/status";
export const CODEX_ACCOUNT_LIST_METHOD = "codexhost/account/list";
export const CODEX_ACCOUNT_REFRESH_METHOD = "codexhost/account/refresh";
export const CODEX_ACCOUNT_CHANGED_METHOD = "codexhost/account/changed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function notifiedThreadId(notification: unknown): ThreadUsageInspectionParams["threadId"] | null {
  if (
    !isRecord(notification) ||
    !(THREAD_USAGE_REFRESH_METHODS as readonly unknown[]).includes(notification.method)
  ) {
    return null;
  }
  const params = notification.params;
  if (!isRecord(params)) return null;
  const parsed = hostThreadIdSchema.safeParse(params.threadId);
  return parsed.success ? parsed.data : null;
}

interface RequestManagerCandidate {
  addNotificationCallback?: (
    method: string | readonly string[],
    callback: (notification: unknown) => void,
  ) => () => void;
  sendRequest?: (method: string, params: unknown, options?: unknown) => Promise<unknown> | unknown;
  requestClient?: RequestManagerCandidate;
}

function notificationTarget(manager: RequestManagerCandidate): RequestManagerCandidate | null {
  if (typeof manager.addNotificationCallback === "function") return manager;
  const nested = manager.requestClient;
  return nested && typeof nested.addNotificationCallback === "function" ? nested : null;
}

export interface RendererModelClient extends Partial<RendererSessionImportClient> {
  inspectProjectSync?(): Promise<ProjectSyncSnapshot>;
  inviteProjectSync?(): Promise<ProjectSyncInvite>;
  pairProjectSync?(input: ProjectSyncPairParams): Promise<ProjectSyncSnapshot>;
  acceptProjectSync?(input: ProjectSyncRequestParams): Promise<ProjectSyncSnapshot>;
  rejectProjectSync?(input: ProjectSyncRequestParams): Promise<ProjectSyncSnapshot>;
  configureProjectSyncGit?(input: ProjectSyncGitConfigureParams): Promise<ProjectSyncSnapshot>;
  pullProjectSyncGit?(): Promise<ProjectSyncSnapshot>;
  pushProjectSyncGit?(): Promise<ProjectSyncSnapshot>;
  syncProjectSync?(input: ProjectSyncPeerParams): Promise<ProjectSyncSnapshot>;
  removeProjectSyncPeer?(input: ProjectSyncPeerParams): Promise<ProjectSyncSnapshot>;
  addProjectSync?(input: ProjectSyncAddParams): Promise<ProjectSyncSnapshot>;
  bindProjectSync?(input: ProjectSyncBindParams): Promise<ProjectSyncSnapshot>;
  cloneProjectSync?(input: ProjectSyncCloneParams): Promise<ProjectSyncSnapshot>;
  listGitRepositories?(input: GitRepositoriesParams): Promise<GitRepositories>;
  linkGitRepository?(input: GitRepositoryLinkParams): Promise<GitRepositories>;
  unlinkGitRepository?(input: GitRepositoryLinkParams): Promise<GitRepositories>;
  inspectGitWorkflow?(input: GitWorkflowParams): Promise<GitWorkflowSnapshot>;
  runGitWorkflow?(input: GitWorkflowParams): Promise<GitWorkflowSnapshot>;
  inspectGitStatus?(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  inspectGitDiff?(input: GitDiffParams): Promise<GitDiffResult>;
  inspectGitContent?(input: GitContentParams): Promise<GitContentResult>;
  stageGitPaths?(input: GitStageParams): Promise<GitWorkspaceStatus>;
  unstageGitPaths?(input: GitStageParams): Promise<GitWorkspaceStatus>;
  commitGit?(input: GitCommitParams): Promise<GitCommitResult>;
  pushGit?(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  fetchGit?(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  syncGit?(input: GitWorkspaceParams): Promise<GitSyncResult>;
  continueGitMerge?(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  abortGitMerge?(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  listGitMessageModels?(input: GitWorkspaceParams): Promise<GitMessageModels>;
  generateGitMessage?(input: GitMessageGenerateParams): Promise<GitGeneratedMessage>;
  listGitSubmodules?(input: GitWorkspaceParams): Promise<GitSubmoduleList>;
  updateGitSubmodule?(input: GitSubmoduleUpdateParams): Promise<GitWorkspaceStatus>;
  inspectGitLog?(input: GitLogParams): Promise<GitLogResult>;
  inspectGitCommit?(input: GitCommitDetailParams): Promise<GitCommitDetail>;
  inspectGitCommitDiff?(input: GitCommitDiffParams): Promise<GitDiffResult>;
  listWorkspaceFiles?(input: WorkspaceFilesListParams): Promise<WorkspaceFilesListResult>;
  readWorkspaceFile?(input: WorkspaceFileReadParams): Promise<WorkspaceFileReadResult>;
  writeWorkspaceFile?(input: WorkspaceFileWriteParams): Promise<WorkspaceFileWriteResult>;
  listThreadTerminals?(): Promise<ThreadTerminalListResult>;
  openThreadTerminal?(input: ThreadTerminalOpenParams): Promise<ThreadTerminalOpenResult>;
  buddyInterrupted?(): Promise<BuddyInterrupted>;
  buddyContinue?(threadId: string, turnId: string): Promise<void>;
  buddyPrivate?(input: BuddyPrivateRequest): Promise<BuddyPrivateSnapshot>;
  buddyStatus?(): Promise<BuddySnapshot>;
  buddyModels?(): Promise<BuddySnapshot>;
  syncCodexCatalog?(): Promise<BuddyCatalogSync>;
  buddyConfigure?(settings: BuddySettings): Promise<BuddySnapshot>;
  buddyJevKey?(config: {
    apiKey?: string | null | undefined;
    baseURL?: string | null | undefined;
  }): Promise<BuddySnapshot>;
  buddyCancel?(threadId: string): Promise<BuddySnapshot>;
  buddyAnswer?(input: BuddyAnswer): Promise<BuddySnapshot>;
  setIdleReleaseSettings?(settings: IdleReleaseSettings): Promise<IdleReleaseSettings>;
  listLoadedSessions?(): Promise<LoadedSession[]>;
  currentHostId?(): string | null;
  listHarnessPlugins?(): Promise<HarnessPluginListResult>;
  clientForHost?(hostId: string): RendererModelClient | null;
  forkThread(input: ExternalThreadForkParams): Promise<ExternalThreadForkResult>;
  inspectHarness(input: HarnessInspectParams): Promise<HarnessInspection>;
  openHarnessWebUi?(input: HarnessWebUiOpenParams): Promise<void>;
  inspectThread(input: ThreadInspectionParams): Promise<ThreadInspection>;
  inspectHarnessCommands(input: HarnessCommandsInspectParams): Promise<HarnessCommandCatalog>;
  inspectThreadCommands(input: ThreadCommandsInspectParams): Promise<HarnessCommandCatalog>;
  executeThreadCommand(input: ThreadCommandExecuteParams): Promise<ThreadCommandExecuteResult>;
  listThreadOwnership(input: ThreadOwnershipListParams): Promise<ThreadOwnershipListResult>;
  inspectThreadUsage(input: ThreadUsageInspectionParams): Promise<ThreadUsageInspection>;
  subscribeThreadUsage?(listener: (update: ThreadUsageInspection) => void): () => void;
  selectThreadModel(input: ThreadModelSelectParams): Promise<HarnessModelSelectionState>;
  selectThreadThinking(input: ThreadThinkingSelectParams): Promise<HarnessModelSelectionState>;
  selectThreadPermissionMode(
    input: ThreadPermissionModeSelectParams,
  ): Promise<HarnessConfigurationState>;
  checkUpdate(): Promise<UpdateCheckResult>;
  startUpdate(): Promise<UpdateStartResult>;
  readUpdateStatus(): Promise<UpdateStatusResult>;
  inspectCodexAccountUsage?(input: CodexAccountUsageParams): Promise<CodexAccountUsageResult>;
  listHarnessAccountSources?(): Promise<HarnessAccountSourceListResult>;
  inspectHarnessAccount?(input: HarnessAccountInspectParams): Promise<HarnessAccountInspectResult>;
  listHarnessAccounts?(input?: HarnessAccountListParams): Promise<HarnessAccountListResult>;
  listCodexAccounts(): Promise<CodexAccountListResult>;
  refreshCodexAccounts(): Promise<CodexAccountListResult>;
  subscribeCodexAccounts?(listener: (state: CodexAccountChanged) => void): () => void;
}

export function createThreadUsageSubscriptionRelay(): {
  connect(client: Pick<RendererModelClient, "subscribeThreadUsage"> | null): void;
  subscribe(listener: (update: ThreadUsageInspection) => void): () => void;
  dispose(): void;
} {
  const listeners = new Set<(update: ThreadUsageInspection) => void>();
  let removeNotificationCallback: (() => void) | null = null;
  let connectedClient: Pick<RendererModelClient, "subscribeThreadUsage"> | null = null;
  let generation = 0;
  const disconnect = (): void => {
    generation += 1;
    removeNotificationCallback?.();
    removeNotificationCallback = null;
    connectedClient = null;
  };
  return {
    connect(client) {
      if (client === connectedClient && removeNotificationCallback) return;
      disconnect();
      if (!client || listeners.size === 0) return;
      connectedClient = client;
      const subscriptionGeneration = generation;
      try {
        removeNotificationCallback =
          client.subscribeThreadUsage?.((update) => {
            if (subscriptionGeneration !== generation) return;
            for (const listener of listeners) listener(update);
          }) ?? null;
      } catch {
        disconnect();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        disconnect();
      };
    },
    dispose() {
      disconnect();
      listeners.clear();
    },
  };
}

export function createRendererModelClient(
  candidates: readonly RequestManagerCandidate[],
): RendererModelClient | null {
  const managers = candidates.filter(
    (
      candidate,
    ): candidate is RequestManagerCandidate &
      Required<Pick<RequestManagerCandidate, "sendRequest">> =>
      typeof candidate.sendRequest === "function",
  );
  const source = managers[0];
  if (managers.length !== 1 || !source) return null;
  const manager = {
    sendRequest: createRendererRequestSender((method, params) =>
      source.sendRequest(method, params),
    ),
  };

  const inspectHarness = async (input: HarnessInspectParams): Promise<HarnessInspection> => {
    const params = harnessInspectParamsSchema.parse(input);
    const result = await manager.sendRequest(HARNESS_INSPECT_METHOD, params);
    return harnessInspectionSchema.parse(result);
  };
  const inspectHarnessCommands = async (
    input: HarnessCommandsInspectParams,
  ): Promise<HarnessCommandCatalog> => {
    const params = harnessCommandsInspectParamsSchema.parse(input);
    const result = await manager.sendRequest(HARNESS_COMMANDS_INSPECT_METHOD, params);
    return harnessCommandCatalogSchema.parse(result);
  };
  const inspectThreadCommands = async (
    input: ThreadCommandsInspectParams,
  ): Promise<HarnessCommandCatalog> => {
    const params = threadCommandsInspectParamsSchema.parse(input);
    const result = await manager.sendRequest(THREAD_COMMANDS_INSPECT_METHOD, params);
    return harnessCommandCatalogSchema.parse(result);
  };
  const executeThreadCommand = async (
    input: ThreadCommandExecuteParams,
  ): Promise<ThreadCommandExecuteResult> => {
    const params = threadCommandExecuteParamsSchema.parse(input);
    const result = await manager.sendRequest(THREAD_COMMAND_EXECUTE_METHOD, params);
    return threadCommandExecuteResultSchema.parse(result);
  };
  const inspectThreadUsage = async (
    input: ThreadUsageInspectionParams,
  ): Promise<ThreadUsageInspection> => {
    const params = threadUsageInspectionParamsSchema.parse(input);
    const result = await manager.sendRequest(THREAD_USAGE_INSPECT_METHOD, params);
    return threadUsageInspectionSchema.parse(result);
  };
  const selectThreadModel = async (
    input: ThreadModelSelectParams,
  ): Promise<HarnessModelSelectionState> => {
    const params = threadModelSelectParamsSchema.parse(input);
    const result = await manager.sendRequest(THREAD_MODEL_SELECT_METHOD, params);
    return harnessModelSelectionStateSchema.parse(result);
  };
  const selectThreadThinking = async (
    input: ThreadThinkingSelectParams,
  ): Promise<HarnessModelSelectionState> => {
    const params = threadThinkingSelectParamsSchema.parse(input);
    const result = await manager.sendRequest(THREAD_THINKING_SELECT_METHOD, params);
    return harnessModelSelectionStateSchema.parse(result);
  };
  const selectThreadPermissionMode = async (
    input: ThreadPermissionModeSelectParams,
  ): Promise<HarnessConfigurationState> => {
    const params = threadPermissionModeSelectParamsSchema.parse(input);
    const result = await manager.sendRequest(THREAD_PERMISSION_MODE_SELECT_METHOD, params);
    return harnessConfigurationStateSchema.parse(result);
  };

  return Object.freeze({
    async inspectProjectSync(): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(PROJECT_SYNC_INSPECT_METHOD, {}),
      );
    },
    async inviteProjectSync(): Promise<ProjectSyncInvite> {
      return projectSyncInviteSchema.parse(
        await manager.sendRequest(PROJECT_SYNC_INVITE_METHOD, {}),
      );
    },
    async pairProjectSync(input: ProjectSyncPairParams): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(
          PROJECT_SYNC_PAIR_METHOD,
          projectSyncPairParamsSchema.parse(input),
        ),
      );
    },
    async acceptProjectSync(input: ProjectSyncRequestParams): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(
          PROJECT_SYNC_ACCEPT_METHOD,
          projectSyncRequestParamsSchema.parse(input),
        ),
      );
    },
    async rejectProjectSync(input: ProjectSyncRequestParams): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(
          PROJECT_SYNC_REJECT_METHOD,
          projectSyncRequestParamsSchema.parse(input),
        ),
      );
    },
    async configureProjectSyncGit(
      input: ProjectSyncGitConfigureParams,
    ): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(
          PROJECT_SYNC_GIT_CONFIGURE_METHOD,
          projectSyncGitConfigureParamsSchema.parse(input),
        ),
      );
    },
    async pullProjectSyncGit(): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(PROJECT_SYNC_GIT_PULL_METHOD, {}),
      );
    },
    async pushProjectSyncGit(): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(PROJECT_SYNC_GIT_PUSH_METHOD, {}),
      );
    },
    async syncProjectSync(input: ProjectSyncPeerParams): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(
          PROJECT_SYNC_SYNC_METHOD,
          projectSyncPeerParamsSchema.parse(input),
        ),
      );
    },
    async removeProjectSyncPeer(input: ProjectSyncPeerParams): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(
          PROJECT_SYNC_REMOVE_PEER_METHOD,
          projectSyncPeerParamsSchema.parse(input),
        ),
      );
    },
    async addProjectSync(input: ProjectSyncAddParams): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(PROJECT_SYNC_ADD_METHOD, projectSyncAddParamsSchema.parse(input)),
      );
    },
    async bindProjectSync(input: ProjectSyncBindParams): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(
          PROJECT_SYNC_BIND_METHOD,
          projectSyncBindParamsSchema.parse(input),
        ),
      );
    },
    async cloneProjectSync(input: ProjectSyncCloneParams): Promise<ProjectSyncSnapshot> {
      return projectSyncSnapshotSchema.parse(
        await manager.sendRequest(
          PROJECT_SYNC_CLONE_METHOD,
          projectSyncCloneParamsSchema.parse(input),
        ),
      );
    },
    async listGitRepositories(input: GitRepositoriesParams): Promise<GitRepositories> {
      return gitRepositoriesSchema.parse(
        await manager.sendRequest(
          GIT_REPOSITORIES_METHOD,
          gitRepositoriesParamsSchema.parse(input),
        ),
      );
    },
    async linkGitRepository(input: GitRepositoryLinkParams): Promise<GitRepositories> {
      return gitRepositoriesSchema.parse(
        await manager.sendRequest(
          GIT_REPOSITORY_LINK_METHOD,
          gitRepositoryLinkParamsSchema.parse(input),
        ),
      );
    },
    async unlinkGitRepository(input: GitRepositoryLinkParams): Promise<GitRepositories> {
      return gitRepositoriesSchema.parse(
        await manager.sendRequest(
          GIT_REPOSITORY_UNLINK_METHOD,
          gitRepositoryLinkParamsSchema.parse(input),
        ),
      );
    },
    async inspectGitWorkflow(input: GitWorkflowParams): Promise<GitWorkflowSnapshot> {
      return gitWorkflowSnapshotSchema.parse(
        await manager.sendRequest(GIT_WORKFLOW_STATUS_METHOD, gitWorkflowParamsSchema.parse(input)),
      );
    },
    async runGitWorkflow(input: GitWorkflowParams): Promise<GitWorkflowSnapshot> {
      return gitWorkflowSnapshotSchema.parse(
        await manager.sendRequest(GIT_WORKFLOW_RUN_METHOD, gitWorkflowParamsSchema.parse(input)),
      );
    },
    async inspectGitStatus(input: GitWorkspaceParams): Promise<GitWorkspaceStatus> {
      const params = gitWorkspaceParamsSchema.parse(input);
      return gitWorkspaceStatusSchema.parse(await manager.sendRequest(GIT_STATUS_METHOD, params));
    },
    async inspectGitDiff(input: GitDiffParams): Promise<GitDiffResult> {
      const params = gitDiffParamsSchema.parse(input);
      return gitDiffResultSchema.parse(await manager.sendRequest(GIT_DIFF_METHOD, params));
    },
    async inspectGitContent(input: GitContentParams): Promise<GitContentResult> {
      const params = gitContentParamsSchema.parse(input);
      return gitContentResultSchema.parse(await manager.sendRequest(GIT_CONTENT_METHOD, params));
    },
    async stageGitPaths(input: GitStageParams): Promise<GitWorkspaceStatus> {
      const params = gitStageParamsSchema.parse(input);
      return gitWorkspaceStatusSchema.parse(await manager.sendRequest(GIT_STAGE_METHOD, params));
    },
    async unstageGitPaths(input: GitStageParams): Promise<GitWorkspaceStatus> {
      const params = gitStageParamsSchema.parse(input);
      return gitWorkspaceStatusSchema.parse(await manager.sendRequest(GIT_UNSTAGE_METHOD, params));
    },
    async commitGit(input: GitCommitParams): Promise<GitCommitResult> {
      const params = gitCommitParamsSchema.parse(input);
      return gitCommitResultSchema.parse(await manager.sendRequest(GIT_COMMIT_METHOD, params));
    },
    async pushGit(input: GitWorkspaceParams): Promise<GitWorkspaceStatus> {
      const params = gitWorkspaceParamsSchema.parse(input);
      return gitWorkspaceStatusSchema.parse(await manager.sendRequest(GIT_PUSH_METHOD, params));
    },
    async fetchGit(input: GitWorkspaceParams): Promise<GitWorkspaceStatus> {
      const params = gitWorkspaceParamsSchema.parse(input);
      return gitWorkspaceStatusSchema.parse(await manager.sendRequest(GIT_FETCH_METHOD, params));
    },
    async syncGit(input: GitWorkspaceParams): Promise<GitSyncResult> {
      const params = gitWorkspaceParamsSchema.parse(input);
      return gitSyncResultSchema.parse(await manager.sendRequest(GIT_SYNC_METHOD, params));
    },
    async continueGitMerge(input: GitWorkspaceParams): Promise<GitWorkspaceStatus> {
      const params = gitWorkspaceParamsSchema.parse(input);
      return gitWorkspaceStatusSchema.parse(
        await manager.sendRequest(GIT_MERGE_CONTINUE_METHOD, params),
      );
    },
    async abortGitMerge(input: GitWorkspaceParams): Promise<GitWorkspaceStatus> {
      const params = gitWorkspaceParamsSchema.parse(input);
      return gitWorkspaceStatusSchema.parse(
        await manager.sendRequest(GIT_MERGE_ABORT_METHOD, params),
      );
    },
    async listGitMessageModels(input: GitWorkspaceParams): Promise<GitMessageModels> {
      const params = gitWorkspaceParamsSchema.parse(input);
      return gitMessageModelsSchema.parse(
        await manager.sendRequest(GIT_MESSAGE_MODEL_METHOD, params),
      );
    },
    async generateGitMessage(input: GitMessageGenerateParams): Promise<GitGeneratedMessage> {
      const params = gitMessageGenerateParamsSchema.parse(input);
      return gitGeneratedMessageSchema.parse(
        await manager.sendRequest(GIT_MESSAGE_GENERATE_METHOD, params),
      );
    },
    async listGitSubmodules(input: GitWorkspaceParams): Promise<GitSubmoduleList> {
      const params = gitWorkspaceParamsSchema.parse(input);
      return gitSubmoduleListSchema.parse(await manager.sendRequest(GIT_SUBMODULES_METHOD, params));
    },
    async updateGitSubmodule(input: GitSubmoduleUpdateParams): Promise<GitWorkspaceStatus> {
      const params = gitSubmoduleUpdateParamsSchema.parse(input);
      return gitWorkspaceStatusSchema.parse(
        await manager.sendRequest(GIT_SUBMODULE_UPDATE_METHOD, params),
      );
    },
    async inspectGitLog(input: GitLogParams): Promise<GitLogResult> {
      const params = gitLogParamsSchema.parse(input);
      return gitLogResultSchema.parse(await manager.sendRequest(GIT_LOG_METHOD, params));
    },
    async inspectGitCommit(input: GitCommitDetailParams): Promise<GitCommitDetail> {
      const params = gitCommitDetailParamsSchema.parse(input);
      return gitCommitDetailSchema.parse(
        await manager.sendRequest(GIT_COMMIT_DETAIL_METHOD, params),
      );
    },
    async inspectGitCommitDiff(input: GitCommitDiffParams): Promise<GitDiffResult> {
      const params = gitCommitDiffParamsSchema.parse(input);
      return gitDiffResultSchema.parse(await manager.sendRequest(GIT_COMMIT_DIFF_METHOD, params));
    },
    async listWorkspaceFiles(input: WorkspaceFilesListParams): Promise<WorkspaceFilesListResult> {
      const params = workspaceFilesListParamsSchema.parse(input);
      return workspaceFilesListResultSchema.parse(
        await manager.sendRequest(WORKSPACE_FILES_LIST_METHOD, params),
      );
    },
    async readWorkspaceFile(input: WorkspaceFileReadParams): Promise<WorkspaceFileReadResult> {
      const params = workspaceFileReadParamsSchema.parse(input);
      const result = await manager.sendRequest(WORKSPACE_FILES_READ_METHOD, params);
      if (
        typeof result === "object" &&
        result !== null &&
        !("revision" in result) &&
        "content" in result &&
        typeof result.content === "string"
      ) {
        // 兼容尚未发送 revision 的旧 Host，避免升级期间文件预览整体失败。
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(result.content),
        );
        return workspaceFileReadResultSchema.parse({
          ...result,
          revision: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        });
      }
      return workspaceFileReadResultSchema.parse(result);
    },
    async writeWorkspaceFile(input: WorkspaceFileWriteParams): Promise<WorkspaceFileWriteResult> {
      const params = workspaceFileWriteParamsSchema.parse(input);
      return workspaceFileWriteResultSchema.parse(
        await manager.sendRequest(WORKSPACE_FILES_WRITE_METHOD, params),
      );
    },
    async listThreadTerminals(): Promise<ThreadTerminalListResult> {
      const params = threadTerminalListParamsSchema.parse({});
      return threadTerminalListResultSchema.parse(
        await manager.sendRequest(THREAD_TERMINAL_LIST_METHOD, params),
      );
    },
    async openThreadTerminal(input: ThreadTerminalOpenParams): Promise<ThreadTerminalOpenResult> {
      const params = threadTerminalOpenParamsSchema.parse(input);
      return threadTerminalOpenResultSchema.parse(
        await manager.sendRequest(THREAD_TERMINAL_OPEN_METHOD, params),
      );
    },
    buddyPrivate: async (input: BuddyPrivateRequest) => {
      const params = buddyPrivateRequestSchema.safeParse(input);
      if (!params.success) {
        throw new Error("Invalid private request");
      }
      return buddyPrivateSnapshotSchema.parse(
        await manager.sendRequest(BUDDY_PRIVATE_METHOD, params.data),
      );
    },
    buddyStatus: async () =>
      buddySnapshotSchema.parse(await manager.sendRequest(BUDDY_STATUS_METHOD, {})),
    buddyInterrupted: async () =>
      buddyInterruptedSchema.parse(await manager.sendRequest(BUDDY_INTERRUPTED_METHOD, {})),
    buddyContinue: async (threadId: string, turnId: string) => {
      await manager.sendRequest(BUDDY_CONTINUE_METHOD, { threadId, turnId });
    },
    buddyModels: async () =>
      buddySnapshotSchema.parse(await manager.sendRequest(BUDDY_MODELS_METHOD, {})),
    syncCodexCatalog: async () =>
      buddyCatalogSyncSchema.parse(await manager.sendRequest(BUDDY_CATALOG_SYNC_METHOD, {})),
    buddyConfigure: async (settings: BuddySettings) =>
      buddySnapshotSchema.parse(await manager.sendRequest(BUDDY_SETTINGS_METHOD, settings)),
    buddyJevKey: async (config: {
      apiKey?: string | null | undefined;
      baseURL?: string | null | undefined;
    }) => buddySnapshotSchema.parse(await manager.sendRequest(BUDDY_JEV_KEY_METHOD, config)),
    buddyAnswer: async (input: BuddyAnswer) =>
      buddySnapshotSchema.parse(
        await manager.sendRequest(BUDDY_ANSWER_METHOD, buddyAnswerSchema.parse(input)),
      ),
    buddyCancel: async (threadId: string) =>
      buddySnapshotSchema.parse(await manager.sendRequest(BUDDY_CANCEL_METHOD, { threadId })),
    async listLoadedSessions(): Promise<LoadedSession[]> {
      return loadedSessionsSchema.parse(await manager.sendRequest(LOADED_SESSIONS_METHOD, {}));
    },
    async setIdleReleaseSettings(settings: IdleReleaseSettings): Promise<IdleReleaseSettings> {
      const params = idleReleaseSettingsSchema.parse(settings);
      return idleReleaseSettingsSchema.parse(
        await manager.sendRequest(IDLE_RELEASE_SETTINGS_METHOD, params),
      );
    },
    ...createRendererSessionImportClient(async (method, params) =>
      manager.sendRequest(method, params),
    ),
    async forkThread(input: ExternalThreadForkParams): Promise<ExternalThreadForkResult> {
      const params = externalThreadForkParamsSchema.parse(input);
      const result = await manager.sendRequest(THREAD_FORK_METHOD, params);
      return externalThreadForkResultSchema.parse(result);
    },
    inspectHarness,
    async listHarnessPlugins(): Promise<HarnessPluginListResult> {
      return harnessPluginListResultSchema.parse(
        await manager.sendRequest(HARNESS_PLUGIN_LIST_METHOD, {}),
      );
    },
    async openHarnessWebUi(input: HarnessWebUiOpenParams): Promise<void> {
      const params = harnessWebUiOpenParamsSchema.parse(input);
      const result = await manager.sendRequest(HARNESS_WEB_UI_OPEN_METHOD, params);
      harnessWebUiOpenResultSchema.parse(result);
    },
    async inspectThread(input: ThreadInspectionParams): Promise<ThreadInspection> {
      const params = threadInspectionParamsSchema.parse(input);
      let result: unknown;
      try {
        result = await manager.sendRequest(THREAD_INSPECT_METHOD, params);
      } catch (error) {
        if (!(error instanceof RendererMethodUnavailableError)) throw error;

        // Stock Codex has no Host inspection API. Verify its native Thread on
        // this same connection; neither an RPC failure nor a missing Account
        // establishes ownership. Match the external markers used by the Host.
        const native = await manager.sendRequest("thread/read", {
          threadId: params.threadId,
          includeTurns: false,
        });
        const thread = isRecord(native) ? native.thread : null;
        if (
          !isRecord(thread) ||
          thread.id !== params.threadId ||
          typeof thread.modelProvider !== "string" ||
          !thread.modelProvider ||
          thread.modelProvider === "codexhost" ||
          typeof thread.cliVersion !== "string" ||
          !thread.cliVersion ||
          thread.cliVersion === "codexhost"
        ) {
          throw new Error("Native Thread response cannot establish Codex ownership");
        }
        return { owner: "codex", locked: true };
      }
      return threadInspectionSchema.parse(result);
    },
    inspectHarnessCommands,
    inspectThreadCommands,
    executeThreadCommand,
    async listThreadOwnership(
      input: ThreadOwnershipListParams,
    ): Promise<ThreadOwnershipListResult> {
      const params = threadOwnershipListParamsSchema.parse(input);
      const value = await manager.sendRequest(THREAD_OWNERSHIP_LIST_METHOD, params);
      const result = threadOwnershipListResultSchema.parse(value);
      if (
        result.threads.length !== params.threadIds.length ||
        result.threads.some((thread, index) => thread.threadId !== params.threadIds[index])
      ) {
        throw new Error("Thread ownership-list result does not match the requested IDs");
      }
      return result;
    },
    inspectThreadUsage,
    subscribeThreadUsage(listener: (update: ThreadUsageInspection) => void): () => void {
      const notifications = notificationTarget(source);
      if (!notifications?.addNotificationCallback) {
        throw new Error("Renderer Usage notification callback is unavailable");
      }
      let disposed = false;
      const generations = new Map<ThreadUsageInspectionParams["threadId"], number>();
      const removeNotificationCallback = notifications.addNotificationCallback(
        THREAD_USAGE_REFRESH_METHODS,
        (notification) => {
          const threadId = notifiedThreadId(notification);
          if (!threadId) return;
          const generation = (generations.get(threadId) ?? 0) + 1;
          generations.set(threadId, generation);
          void inspectThreadUsage({ threadId })
            .then((update) => {
              if (!disposed && generations.get(threadId) === generation) listener(update);
            })
            .catch(() => undefined);
        },
      );
      return () => {
        if (disposed) return;
        disposed = true;
        generations.clear();
        removeNotificationCallback();
      };
    },
    selectThreadModel,
    selectThreadThinking,
    selectThreadPermissionMode,
    async checkUpdate(): Promise<UpdateCheckResult> {
      const result = await manager.sendRequest(
        UPDATE_CHECK_METHOD,
        updateEmptyParamsSchema.parse({}),
      );
      return updateCheckResultSchema.parse(result);
    },
    async startUpdate(): Promise<UpdateStartResult> {
      const result = await manager.sendRequest(
        UPDATE_START_METHOD,
        updateEmptyParamsSchema.parse({}),
      );
      return updateStartResultSchema.parse(result);
    },
    async readUpdateStatus(): Promise<UpdateStatusResult> {
      const result = await manager.sendRequest(
        UPDATE_STATUS_METHOD,
        updateEmptyParamsSchema.parse({}),
      );
      return updateStatusResultSchema.parse(result);
    },
    async inspectCodexAccountUsage(
      input: CodexAccountUsageParams,
    ): Promise<CodexAccountUsageResult> {
      const result = await manager.sendRequest(
        "codexhost/account/usage/inspect",
        codexAccountUsageParamsSchema.parse(input),
      );
      return codexAccountUsageResultSchema.parse(result);
    },
    async listHarnessAccountSources(): Promise<HarnessAccountSourceListResult> {
      return harnessAccountSourceListResultSchema.parse(
        await manager.sendRequest(HARNESS_ACCOUNT_SOURCES_METHOD, {}),
      );
    },
    async inspectHarnessAccount(
      input: HarnessAccountInspectParams,
    ): Promise<HarnessAccountInspectResult> {
      return harnessAccountInspectResultSchema.parse(
        await manager.sendRequest(
          HARNESS_ACCOUNT_INSPECT_METHOD,
          harnessAccountInspectParamsSchema.parse(input),
        ),
      );
    },
    async listHarnessAccounts(
      input: HarnessAccountListParams = {},
    ): Promise<HarnessAccountListResult> {
      return harnessAccountListResultSchema.parse(
        await manager.sendRequest(
          "codexhost/harness/accounts/list",
          harnessAccountListParamsSchema.parse(input),
        ),
      );
    },
    async listCodexAccounts(): Promise<CodexAccountListResult> {
      const result = await manager.sendRequest(CODEX_ACCOUNT_LIST_METHOD, {});
      return codexAccountListResultSchema.parse(result);
    },
    async refreshCodexAccounts(): Promise<CodexAccountListResult> {
      const result = await manager.sendRequest(CODEX_ACCOUNT_REFRESH_METHOD, {});
      return codexAccountListResultSchema.parse(result);
    },
    subscribeCodexAccounts(listener: (state: CodexAccountChanged) => void): () => void {
      const notifications = notificationTarget(source);
      if (!notifications?.addNotificationCallback) {
        throw new Error("Renderer Account notification callback is unavailable");
      }
      return notifications.addNotificationCallback(CODEX_ACCOUNT_CHANGED_METHOD, (notification) => {
        if (!isRecord(notification) || notification.method !== CODEX_ACCOUNT_CHANGED_METHOD) return;
        const state = codexAccountChangedSchema.safeParse(notification.params);
        if (state.success) listener(state.data);
      });
    },
  });
}
