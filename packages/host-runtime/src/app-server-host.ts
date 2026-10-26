import { readSshTurnActions } from "./ssh-auto-model-routes.js";
import { TurnActions, type TurnActionContext } from "./turn-actions.js";
import { actionThreadTurns, actionGitFeatures } from "./turn-action-context.js";
import type { RegisteredTurnAction } from "./turn-action-registry.js";
import {
  SSH_TURN_ACTIONS_METHOD,
  TURN_ACTIONS_INSPECT_METHOD,
  TURN_ACTION_EXECUTE_METHOD,
} from "@codexhost/shared-contracts";
import { SshGitWorkspaces, type GitWorkspaceServices } from "./ssh-git.js";
import { discoverChildRepositories } from "./git-child-repositories.js";
import { GitRepositoryLinks } from "./git-repository-links.js";
import { listGitRepositoryDirectories } from "./git-repository-directories.js";
import { cloneGitRepository } from "./git-repository-clone.js";
import {
  DOUBAO_OPEN_METHOD,
  doubaoOpenParamsSchema,
  PROJECT_TERMINAL_OPEN_METHOD,
  projectTerminalOpenParamsSchema,
  PROJECT_WORKSPACE_OPEN_METHOD,
  projectWorkspaceOpenParamsSchema,
  SSH_GIT_METHOD,
  sshGitParamsSchema,
  GIT_REPOSITORIES_METHOD,
  GIT_REPOSITORY_LINK_METHOD,
  GIT_REPOSITORY_UNLINK_METHOD,
  GIT_REPOSITORY_DIRECTORIES_METHOD,
  GIT_REPOSITORY_CLONE_METHOD,
  gitRepositoriesParamsSchema,
  gitWorkflowParamsSchema,
  gitRepositoryLinkParamsSchema,
  gitRepositoryDirectoriesParamsSchema,
  gitRepositoryCloneParamsSchema,
} from "@codexhost/shared-contracts";
import {
  ProjectGitWorkflow,
  type ProjectGitWorkflowGroup,
  projectGitWorkflowInput,
} from "./project-git-workflow.js";
import {
  readProjectGitRepositories,
  type ProjectGitRepository,
} from "./project-git-repositories.js";
import { BUDDY_PRIVATE_TURN_MARKER, BuddyRouter } from "./buddy/router.js";
import { recentCompletedSessions } from "@codexhost/desktop-control/renderer-bindings";
import { syncCodexCatalog } from "./buddy/catalog-sync.js";
import { LiveModelCatalog } from "./buddy/live-model-catalog.js";
import { ModelAvailability } from "./model-availability.js";
import { ProviderRouting } from "./provider-routing/routing.js";
import { PROVIDER_ROUTING_METHOD, providerRoutingParamsSchema } from "@codexhost/shared-contracts";
import { MODEL_AVAILABILITY_METHOD } from "@codexhost/shared-contracts";
import { InterruptedConversations } from "./buddy/continuation.js";
import {
  BUDDY_INTERRUPTED_METHOD,
  BUDDY_CONTINUE_METHOD,
  THREAD_ARCHIVE_COMPLETED_METHOD,
  buddyContinueSchema,
  threadArchiveCompletedParamsSchema,
  threadArchiveCompletedResultSchema,
} from "@codexhost/shared-contracts";
import { BuddyPrivateChat, privacySafeRequest } from "./buddy/private-chat.js";
import { BuddyTranslator } from "./buddy/translator.js";
import { BuddySpeech } from "./buddy/speech.js";
import {
  AUTO_MODEL_ROUTES_METHOD,
  SSH_AUTO_MODEL_ROUTES_METHOD,
  BUDDY_PRIVATE_METHOD,
  BUDDY_TRANSLATE_METHOD,
  BUDDY_TRANSLATE_BATCH_METHOD,
  BUDDY_SPEECH_METHOD,
  REMOTE_PROJECTS_INSPECT_METHOD,
  REMOTE_PROJECTS_SYNC_METHOD,
} from "@codexhost/shared-contracts";
import { readAutoModelRoutes } from "./auto-model-routes.js";
import { readSshAutoModelRoutes } from "./ssh-auto-model-routes.js";
import { inspectSshRemoteProjects, syncSshRemoteProjects } from "./ssh-remote-projects.js";
import {
  BUDDY_MODELS_METHOD,
  BUDDY_CATALOG_SYNC_METHOD,
  BUDDY_JEV_KEY_METHOD,
  BUDDY_STATUS_METHOD,
  BUDDY_SETTINGS_METHOD,
  BUDDY_CANCEL_METHOD,
  buddyJevKeySchema,
  EMERGENCY_PROVIDER_METHOD,
  emergencyProviderConfigSchema,
  buddySnapshotSchema,
  type BuddyCatalogSync,
} from "@codexhost/shared-contracts";
import {
  GIT_WORKFLOW_STATUS_METHOD,
  GIT_WORKFLOW_RUN_METHOD,
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
  type GitWorkspaceTarget,
  gitDiffParamsSchema,
  gitContentParamsSchema,
  gitStageParamsSchema,
  gitCommitParamsSchema,
  gitMessageGenerateParamsSchema,
  gitSubmoduleUpdateParamsSchema,
  gitLogParamsSchema,
  gitCommitDetailParamsSchema,
  gitCommitDiffParamsSchema,
  WORKSPACE_FILES_LIST_METHOD,
  WORKSPACE_FILES_READ_METHOD,
  WORKSPACE_FILES_WRITE_METHOD,
  workspaceFilesListParamsSchema,
  workspaceFileReadParamsSchema,
  workspaceFileWriteParamsSchema,
  THREAD_TERMINAL_OPEN_METHOD,
  THREAD_OPEN_TARGET_METHOD,
  threadOpenTargetParamsSchema,
  threadOpenTargetSchema,
  THREAD_TERMINAL_LIST_METHOD,
  THREAD_TERMINAL_SETTINGS_GET_METHOD,
  THREAD_TERMINAL_SETTINGS_SET_METHOD,
  PROJECT_TABS_GET_METHOD,
  PROJECT_TABS_SET_METHOD,
  projectTabsConfigSchema,
  projectTabsGetParamsSchema,
  type ProjectTabsState,
  PROJECT_TOOLS_GET_METHOD,
  PROJECT_TOOLS_SET_METHOD,
  PROJECT_TOOLS_RUN_SCRIPT_METHOD,
  projectToolsConfigSchema,
  projectToolsGetParamsSchema,
  projectScriptRunParamsSchema,
  projectToolTargetKey,
  type ProjectToolsState,
  THREAD_FOLDERS_GET_METHOD,
  THREAD_FOLDERS_SET_METHOD,
  threadFoldersConfigSchema,
  threadFoldersGetParamsSchema,
  type ThreadFoldersState,
  threadTerminalListParamsSchema,
  threadTerminalOpenParamsSchema,
  THREAD_WORKSPACE_OPEN_METHOD,
  threadWorkspaceOpenParamsSchema,
} from "@codexhost/shared-contracts";
import {
  DELEGATION_READ_METHOD,
  delegationReadParamsSchema,
  EXTERNAL_THREAD_PREWARM_PARAM,
  THREAD_PREWARM_DISCARD_METHOD,
  threadPrewarmDiscardParamsSchema,
  REMOTE_SSH_SETUP_METHOD,
  CONSOLE_REMOTE_CONNECTIONS_METHOD,
  remoteSshSetupParamsSchema,
  RUNTIME_STATUS_METHOD,
  REMOTE_UPDATE_METHOD,
  remoteUpdateParamsSchema,
} from "@codexhost/shared-contracts";
import { requestDesktopRemoteConnections } from "@codexhost/desktop-control";
import type { RuntimeMaintenance } from "./runtime-maintenance.js";
import { ExternalThreadPrewarms } from "./external-thread-prewarms.js";
import { HarnessLaunchSettingsStore } from "@codexhost/harness-plugin-files";
import type { SharedThreadBridge } from "./shared-thread-bridge.js";
import {
  HARNESS_INSTALLATION_METHOD,
  HARNESS_INSTALLATION_START_METHOD,
  HARNESS_INSTALLATION_STATUS_METHOD,
} from "@codexhost/shared-contracts";
import { handleHarnessInstallation, HarnessInstallationError } from "./harness-installation.js";
import { HarnessInstallationTasks } from "./harness-installation-tasks.js";
import {
  isConsoleHostMethod,
  CONSOLE_OPEN_METHOD,
  consoleOpenParamsSchema,
  consoleOpenResultSchema,
} from "@codexhost/shared-contracts";
import {
  DELEGATION_MENTION_PATH_PREFIX,
  threadTerminalSettingsSchema,
  IDLE_RELEASE_SETTINGS_METHOD,
  restoreHarnessCommandMentions,
  LOADED_SESSIONS_METHOD,
  THREAD_MANUAL_COMPACTION_STARTED_METHOD,
  idleReleaseSettingsSchema,
  THREAD_AUTO_ARCHIVE_SETTINGS_METHOD,
  threadAutoArchiveSettingsSchema,
  SESSION_ROUTE_METHOD,
  sessionRouteParamsSchema,
  sessionRouteResultSchema,
} from "@codexhost/shared-contracts";
import {
  CREDENTIAL_IMPORTS_METHOD,
  credentialImportsParamsSchema,
} from "@codexhost/shared-contracts";
import { handleCredentialImports } from "./credential-imports.js";
import { HarnessDisplaySettingsStore } from "./harness-display-settings.js";
import {
  handleModelPriceOverridesRequest,
  isModelPriceOverridesMethod,
  ModelPriceOverridesError,
} from "./model-price-overrides-file.js";
import {
  HARNESS_DISPLAY_GET_METHOD,
  HARNESS_DISPLAY_SET_METHOD,
  harnessDisplayGetSchema,
  harnessDisplaySetSchema,
} from "@codexhost/shared-contracts";
import {
  rewriteDelegationMentionInput,
  rewriteDelegationMentionText,
} from "./delegation-mention-rewrite.js";
import { managedDelegationSkillReference } from "./delegation-skill.js";
import { AccountRateLimits } from "./codex-runtime/account-rate-limits.js";
import { listThreadTerminals, openProjectTerminal, openThreadTerminal } from "./thread-terminal.js";
import { desktopSshConnection } from "./desktop-ssh-connection.js";
import { openProjectWorkspace, openThreadWorkspace } from "./thread-workspace.js";
import { createLauncherDoubaoOpener } from "./launcher-url-opener.js";
import { ThreadTerminalSettingsStore } from "./thread-terminal-settings.js";
import { ProjectTabsSettingsStore } from "./project-tabs-settings.js";
import { ProjectToolsSettingsStore } from "./project-tools-settings.js";
import { ProjectScriptRunner } from "./project-script-runner.js";
import { ThreadFoldersSettingsStore } from "./thread-folders-settings.js";
import { NativeAccountObserver } from "./native-account-observer.js";
import { ProjectSyncPeer } from "./project-sync-peer.js";
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
  projectSyncPairParamsSchema,
  projectSyncRequestParamsSchema,
  projectSyncGitConfigureParamsSchema,
  projectSyncPeerParamsSchema,
  projectSyncAddParamsSchema,
  projectSyncBindParamsSchema,
  projectSyncCloneParamsSchema,
  projectSyncEmptyParamsSchema,
} from "@codexhost/shared-contracts";
import { nativeThreadSupportsReferences } from "./native-thread-reference-capability.js";
import { THREAD_REFERENCE_SOURCE_HOST_PARAM } from "@codexhost/shared-contracts";
import {
  HarnessAccountInspectionCache,
  listedHarnessAccounts,
  listHarnessAccountSources,
} from "./harness-accounts.js";
import type { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

import type {
  HarnessAdapter,
  HarnessOutput,
  HarnessSession,
  HostApprovalInteraction,
  HostSubagentState,
  HostApprovalResponse,
  HostQuestionInteraction,
} from "@codexhost/harness-adapter";
import {
  parseHarnessAccountCredits,
  type HostEvent,
  type HostUsage,
} from "@codexhost/harness-adapter";
import type {
  HarnessPluginContext,
  HarnessUsageStatisticsAdapter,
} from "@codexhost/harness-adapter/plugin";
import type { StoredThreadRecordV1 } from "@codexhost/mapping-store";
import {
  harnessAccountInspectParamsSchema,
  harnessAccountInspectResultSchema,
  type HarnessAccountInspectResult,
  harnessAccountListParamsSchema,
  harnessAccountListResultSchema,
  harnessAccountSourceListParamsSchema,
  codexAccountUsageParamsSchema,
  codexAccountUsageResultSchema,
  harnessPluginListParamsSchema,
  harnessPluginListResultSchema,
  type HarnessPluginDescriptor,
  externalThreadForkParamsSchema,
  harnessCommandCatalogSchema,
  type HarnessCommandCatalog,
  type HarnessCommandDescriptor,
  harnessCommandsInspectParamsSchema,
  type HarnessId,
  harnessIdSchema,
  threadCommandExecuteParamsSchema,
  threadCommandExecuteResultSchema,
  threadCommandsInspectParamsSchema,
  externalThreadForkResultSchema,
  harnessInspectParamsSchema,
  harnessConfigurationStateSchema,
  harnessInspectionSchema,
  harnessWebUiOpenParamsSchema,
  harnessWebUiOpenResultSchema,
  harnessModelSelectionStateSchema,
  harnessThinkingOptionIdSchema,
  harnessModelRefSchema,
  hostItemIdSchema,
  hostThreadIdSchema,
  hostTurnIdSchema,
  jsonValueSchema,
  threadInspectionParamsSchema,
  threadInspectionSchema,
  threadModelSelectParamsSchema,
  threadUsageInspectionParamsSchema,
  threadUsageInspectionSchema,
  threadPermissionModeSelectParamsSchema,
  threadThinkingSelectParamsSchema,
  threadOwnershipListParamsSchema,
  threadOwnershipListResultSchema,
  threadSteeringInspectParamsSchema,
  threadSteeringInspectResultSchema,
  permissionModeFixedAtCreate,
  updateCheckResultSchema,
  updateEmptyParamsSchema,
  updateStartResultSchema,
  updateStatusResultSchema,
  type AccountCreditsSnapshot,
  type HarnessModelRef,
  type HarnessModelSelectionState,
  type HarnessPermissionModeId,
  type HarnessThinkingOptionId,
  type HostInteractionId,
  type HostItemId,
  type HostTurnId,
} from "@codexhost/shared-contracts";
import { executeExternalThreadFork } from "./external-thread-fork.js";
import { settleExternalOutputFailure } from "./external-output-failure.js";
import { isSessionImportRequest, SessionImportRequests } from "./session-import-requests.js";
import {
  ExternalHistoryRequestError,
  listExternalItems,
  listExternalTurns,
} from "./external-thread-history.js";
import { executeExternalThreadRollback } from "./external-thread-rollback.js";
import {
  createExternalThreadRecordInput,
  createProductionExternalThreadStore,
  ExternalThreadRepository,
  externalThreadValue,
  threadSectionFields,
  type ExternalThreadStore,
} from "./external-thread-repository.js";
import {
  ExternalThreadRuntime,
  type ExternalThread,
  type ExternalThreadLocation,
  type ExternalThreadResolution,
} from "./external-thread-runtime.js";
import {
  ExternalSteerError,
  ExternalTurnSteering,
  externalSteeringDelivery,
  insertNativeSteer,
} from "./external-turn-steering.js";
import {
  ExternalCommandError,
  inspectLiveCommandCatalog,
  isExternalCommandCandidate,
  resolveExternalCommand,
} from "./external-command-routing.js";
import {
  isLiveCommandCatalog,
  LiveCommandCatalogCache,
  sameWorkspace,
} from "./live-command-catalog-cache.js";
import {
  DELEGATION_CLI_PATH_ENV,
  DELEGATION_RUNTIME_ENDPOINT_ENV,
  DELEGATION_RUNTIME_TOKEN_ENV,
  DELEGATION_THREAD_ID_ENV,
  DelegationControlError,
} from "./delegation-types.js";
import { HarnessDelegationCoordinator } from "./harness-delegation-coordinator.js";
import { loadHarnessPlugins } from "./harness-plugin-loader.js";
import type { HarnessPluginRegistry } from "./harness-plugin-registry.js";
import {
  HARNESS_LAUNCH_SETTINGS_GET_METHOD,
  HARNESS_LAUNCH_SETTINGS_SET_METHOD,
  harnessLaunchSettingsGetSchema,
  harnessLaunchSettingsSetSchema,
} from "@codexhost/shared-contracts";
import { DesktopRequestQueue } from "./desktop-request-queue.js";
import { ThreadAutoArchive } from "./thread-auto-archive.js";
import type {
  DelegationControlRegistration,
  DelegationStartInput,
  DelegationStartResult,
  DelegationThreadListResult,
  DelegationThreadSnapshot,
  HarnessInspectInput,
  HarnessInspectResult,
  ThreadCancelInput,
  ThreadCancelResult,
  ThreadListInput,
  ThreadReadInput,
  ThreadSendInput,
  ThreadSendResult,
} from "./delegation-types.js";
import { projectDelegationThreadSnapshot } from "./delegation-snapshot.js";
import {
  canonicalizeOfficialCodexModelRef,
  decodeOfficialCodexModelRef,
  encodeOfficialCodexModelRef,
} from "./official-codex-model-ref.js";
import {
  spawnOfficialAppServerConnection,
  type OfficialAppServerConnection,
} from "./official-app-server-connection.js";
import {
  SingleNativeCodexAccount,
  type CodexAccountControl,
} from "./account/codex-account-control.js";

import {
  createOwnedConnectionBackend,
  OfficialRuntimeClient,
  OfficialRuntimeScope,
} from "./codex-runtime/official-runtime-scope.js";
import type { HostUpdateCoordinator } from "./update-coordinator.js";
import {
  GitPushRejectedError,
  GitSyncConflictError,
  GitWorkspace,
  GitWorkspaceError,
} from "./git-workspace.js";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  WorkspaceFilesError,
  writeWorkspaceFile,
} from "./workspace-files.js";
import type { HostConsoleOpener } from "./console-opener.js";

const CONSOLE_REQUEST_TIMEOUT_MS = 120_000;

export type ConsoleHostReply = { result: JsonValue } | { error: { code: number; message: string } };

const SUBAGENT_TERMINAL_REFRESH_DELAYS_MS = [0, 50, 100, 150] as const;
const THREAD_USAGE_UPDATED_METHOD = "codexhost/thread/usage/updated";
// Native Codex account quota is still pulled through its official API; keep
// that reading briefly cached so concurrent Composer inspections coalesce.

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
import {
  classifyThreadPurpose,
  RequestRouteObservationTracker,
  type CreateRequestRouteObservation,
  type RequestRouteObservation,
} from "./route-observation.js";
import {
  aggregateThreadList,
  officialThreadListPageFromResponse,
  OfficialThreadListError,
} from "./thread-list-aggregator.js";
import { listSectionThreads, moveThreadSection } from "./external-thread-sections.js";
import { externalThreadListEntries } from "./external-thread-list.js";
import { externalThreadEmptyOfficialResult } from "./external-thread-official-defaults.js";
import { ModelPriceCatalog } from "./model-prices.js";
import { ObservedSessionUsage } from "./observed-session-usage.js";
import type { UsageStatistics, UsageStatisticsSource } from "./usage-statistics.js";
import { USAGE_STATISTICS_METHOD, usageStatisticsParamsSchema } from "@codexhost/shared-contracts";
import {
  carriesHostThreadListCursor,
  CodexTurnProjector,
  decodeCreateRoute,
  decodeExternalTransportSelection,
  encodeExternalTransportSelection,
  decodeThreadArchiveRequest,
  decodeThreadForkRequest,
  decodeThreadListRequest,
  decodeThreadMetadataUpdateRequest,
  decodeThreadRevertRequest,
  decodeThreadRollbackRequest,
  decodeThreadSectionMoveRequest,
  encodeJsonFrame,
  mapExternalThreadHarnessError,
  projectCodexRateLimitsToCredits,
  observeCodexRateLimits,
  observeDeletedProject,
  parseJsonFrame,
  projectCodexThreadUsage,
  readLfFrames,
  writeFrame,
  writeJsonFrame,
  jsonRpcRequestSchema,
  threadForkResult,
  threadRevertResult,
  threadRollbackResult,
  transportModelIdForHarness,
  type CodexApprovalProjection,
  type CodexQuestionProjection,
  type DecodedThreadForkRequest,
  type DecodedThreadListRequest,
  type DecodedThreadMetadataUpdateRequest,
  type DecodedThreadSectionMoveRequest,
  type DecodedThreadRevertRequest,
  type DecodedThreadRollbackRequest,
  type ExternalThreadRpcError,
  type CodexApprovalRequestProjection,
  type CodexQuestionRequestProjection,
  type ExternalHarnessId,
  type JsonObject,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonValue,
  type ProjectableHostEvent,
} from "@codexhost/protocol-core";

export interface AppServerHostOptions {
  /** Private external-session owner: never forwards requests to native Codex. */
  externalOnly?: boolean;
  /** GUI connection to the single external-session owner. */
  sharedThreads?: SharedThreadBridge;
  /** In-process SSH fronts send external Delegations to the same owner as GUI requests. */
  sharedDelegation?: DelegationControlRegistration;
  stockCodexPath: string;
  arguments: string[];
  buddyRouting?: boolean;
  defaultAgent?: "codex" | "pi";
  environment?: NodeJS.ProcessEnv;
  desktopInput?: Readable;
  desktopOutput?: Writable;
  diagnosticOutput?: Writable;
  externalAdapters?: ReadonlyMap<ExternalHarnessId, HarnessAdapter>;
  pluginRoots?: readonly string[];
  pluginContext?: HarnessPluginContext;
  mappingStore?: ExternalThreadStore;
  /** Defaults to true. A listener that shares one store across sessions owns closing it. */
  closeMappingStoreOnExit?: boolean;
  spawnOfficial?: typeof spawn;
  /** Grace period for each official app-server stop step. Tests shorten it. */
  officialCloseTimeoutMs?: number;
  createOfficialConnection?: () =>
    OfficialAppServerConnection | Promise<OfficialAppServerConnection>;
  accountControl?: CodexAccountControl;
  /** Shared by all Desktop/Remote Control sessions belonging to one Host. */
  officialRuntimeScope?: OfficialRuntimeScope;
  onCreateRequestRoute?: (observation: CreateRequestRouteObservation) => void;
  onRequestRoute?: (observation: RequestRouteObservation) => void;
  updateCoordinator?: HostUpdateCoordinator;
  gitWorkflowGroup?: ProjectGitWorkflowGroup;
  runtimeMaintenance?: RuntimeMaintenance;
  /** Present only on the local Host started by the Launcher. */
  consoleOpener?: HostConsoleOpener;
  onDelegationApi?: (api: DelegationControlRegistration) => (() => void) | undefined;
  /** Shared by all Hosts of one runtime; defaults to the bundled snapshot only. */
  modelPrices?: ModelPriceCatalog;
  /** Machine-wide usage statistics; one per runtime, read from the loaded Harness plugins. */
  usageStatistics?: UsageStatistics;
}

interface TurnProjectionGate {
  promise: Promise<void>;
  resolve(): void;
}

interface ProjectedTurn {
  projector: CodexTurnProjector;
}

type HostApprovalRequestId = number;
type HostQuestionRequestId = number;

interface PendingDesktopApproval {
  thread: ExternalThread;
  interaction: HostApprovalInteraction;
  projection: CodexApprovalRequestProjection;
}

interface PendingDesktopQuestion {
  thread: ExternalThread;
  interaction: HostQuestionInteraction;
  projection: CodexQuestionRequestProjection;
  timeout: NodeJS.Timeout | null;
}

type ExternalThreadStatus = { type: "active"; activeFlags: [] } | { type: "idle" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function officialThreadBusy(thread: Record<string, unknown> | null): boolean {
  if (thread && isRecord(thread.status) && thread.status.type === "active") return true;
  const turns = thread && Array.isArray(thread.turns) ? thread.turns : [];
  const latestTurn = turns.at(-1);
  return (
    isRecord(latestTurn) && (latestTurn.status === "inProgress" || latestTurn.status === "running")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Codex app-server reports an unknown Thread with these messages. Any other
 * error from a Thread read is a failure to read, not proof that it is missing.
 */
const OFFICIAL_THREAD_MISSING =
  /no rollout found for thread id|thread not found|invalid thread id/i;

function officialThreadReadError(error: Record<string, unknown>): DelegationControlError {
  const message = typeof error.message === "string" ? error.message : "";
  return OFFICIAL_THREAD_MISSING.test(message)
    ? new DelegationControlError("THREAD_NOT_FOUND", message || "Official Thread was not found")
    : new DelegationControlError(
        "INTERNAL_ERROR",
        message ? `Official Thread read failed: ${message}` : "Official Thread read failed",
      );
}

function codexAccountRpcError(error: unknown): { code: number; message: string } {
  const message = error instanceof Error ? error.message : "";
  return message === "Unknown Codex Account"
    ? { code: -32086, message }
    : { code: -32086, message: "Codex Account operation failed" };
}

export function officialEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set([
    DELEGATION_CLI_PATH_ENV,
    DELEGATION_RUNTIME_ENDPOINT_ENV,
    DELEGATION_RUNTIME_TOKEN_ENV,
  ]);
  const internal = new Set([
    "CODEX_CLI_PATH",
    "CODEXHOST_HOST_NODE_PATH",
    "CODEXHOST_DATA_DIR",
    // Retired setting still exported by older remote SSH profile blocks.
    "CODEXHOST_DEFAULT_AGENT",
    "CODEXHOST_HOST_RUNTIME_PATH",
    "CODEXHOST_PI_COMMAND",
    "CODEXHOST_ENABLE_CLAUDE_CODE",
    "CODEXHOST_CLAUDE_COMMAND",
    "CODEXHOST_OPENCODE_COMMAND",
    "CODEXHOST_STOCK_CODEX_PATH",
    "CODEXHOST_LAUNCHER_PID",
    "CODEXHOST_LAUNCHER_EXECUTABLE",
    "CODEXHOST_RUNTIME_DESCRIPTOR_PATH",
    "CODEXHOST_CONTROL_PORT",
    "CODEXHOST_CONTROL_NONCE",
    "CODEXHOST_NPM_NODE_PATH",
    "CODEXHOST_NPM_CLI_PATH",
    "CODEXHOST_NPM_LAUNCHER_PATH",
    "CODEXHOST_NPM_PACKAGE_ROOT",
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !internal.has(key) || allowed.has(key)),
  );
}

function rpcEnvelope(request: JsonRpcRequest, value: JsonObject): JsonObject {
  return {
    ...(request.jsonrpc === "2.0" ? { jsonrpc: "2.0" } : {}),
    id: request.id,
    ...value,
  };
}

function rpcError(request: JsonRpcRequest, code: number, message: string): JsonObject {
  return rpcEnvelope(request, { error: { code, message } });
}

function unixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const HOST_APPROVAL_REQUEST_ID_MIN = -2_000_000;
const HOST_APPROVAL_REQUEST_ID_MAX = -1_000_001;
const HOST_QUESTION_REQUEST_ID_MIN = -1_000_000;
const HOST_QUESTION_REQUEST_ID_MAX = -1;
const EXPLICIT_EXTERNAL_THREAD_METHODS = new Set([
  "thread/archive",
  "thread/delete",
  "thread/fork",
  "thread/items/list",
  "thread/metadata/update",
  "thread/name/set",
  "thread/read",
  "thread/resume",
  "thread/revert",
  "thread/rollback",
  "thread/section/move",
  "thread/turns/list",
  "thread/unarchive",
  "thread/unsubscribe",
]);

function isHostApprovalRequestId(value: unknown): value is HostApprovalRequestId {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= HOST_APPROVAL_REQUEST_ID_MIN &&
    value <= HOST_APPROVAL_REQUEST_ID_MAX
  );
}

function isHostQuestionRequestId(value: unknown): value is HostQuestionRequestId {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= HOST_QUESTION_REQUEST_ID_MIN &&
    value <= HOST_QUESTION_REQUEST_ID_MAX
  );
}

/** Only an explicit codexhost transport Model selects an External Harness. */
export function classifyCreateRequestRoute(
  request: JsonRpcRequest,
): CreateRequestRouteObservation | null {
  const route = decodeCreateRoute(request);
  if (!route) return null;
  if (route.harnessId !== "codex") {
    return {
      requestMethod: "thread/start",
      modelCarrier: `${route.harnessId}-transport`,
      selectedHarness: route.harnessId,
      selectionSource: "transport-model",
    };
  }
  return {
    requestMethod: "thread/start",
    modelCarrier: "official-model",
    selectedHarness: "codex",
    selectionSource: "official-model",
  };
}

/**
 * Reads routing fields before ownership is known. Never throws: a shape the Host does not
 * recognize belongs to native Codex, which validates its own protocol.
 */
function routingParams(request: JsonRpcRequest): JsonObject {
  return isRecord(request.params) ? (request.params as JsonObject) : {};
}

function requestObject(request: JsonRpcRequest): JsonObject {
  if (!isRecord(request.params)) throw new Error(`${request.method} params must be an object`);
  return request.params as JsonObject;
}

function requestText(params: JsonObject): string {
  if (!Array.isArray(params.input)) throw new Error("turn/start input must be an array");
  const text = params.input
    .filter((item): item is JsonObject => isRecord(item) && item.type === "text")
    .map((item) => item.text)
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  if (!text) throw new Error("turn/start must contain text input");
  return text;
}

function sandboxResult(params: JsonObject): JsonObject {
  const sandbox = params.sandbox;
  if (sandbox === "read-only") return { type: "readOnly", networkAccess: false };
  if (sandbox === "danger-full-access") return { type: "dangerFullAccess" };
  return {
    type: "workspaceWrite",
    networkAccess: false,
    writableRoots: [],
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function turnProjectionGate(): TurnProjectionGate {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

class OrderedWriter {
  #tail = Promise.resolve();

  constructor(
    private readonly stream: Writable,
    /** Returns true for a message it consumed instead of the stream. */
    private readonly intercept: (value: JsonValue) => boolean = () => false,
  ) {}

  frame(frame: Buffer<ArrayBufferLike>): Promise<void> {
    return this.#enqueue(() => writeFrame(this.stream, frame));
  }

  json(value: JsonValue): Promise<void> {
    if (this.intercept(value)) return Promise.resolve();
    return this.#enqueue(() => writeJsonFrame(this.stream, value));
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.#tail.then(operation, operation);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}

// 原生任务列表可能长期保留 active；超时只结束等待，不跳过启动前的仓库锁检查。
function gitWorkflowWaitTimeoutMs(environment: NodeJS.ProcessEnv): number {
  const parsed = Number(environment.CODEXHOST_GIT_WAIT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60_000;
}

export class AppServerHost {
  #buddy: BuddyRouter | undefined;
  #interrupted = new InterruptedConversations(
    (method, params) => this.#requestOfficial(method, params),
    (id) => this.#activeOfficialTurns.has(id),
    async () => !(await this.#buddy?.privateMode()),
  );
  #privateChat: BuddyPrivateChat | undefined;
  #translator: BuddyTranslator | undefined;
  #speech: BuddySpeech | undefined;
  readonly #options: Required<
    Pick<AppServerHostOptions, "desktopInput" | "desktopOutput" | "diagnosticOutput">
  > &
    AppServerHostOptions;
  #officialRuntime: OfficialRuntimeClient;
  #officialRuntimeScope: OfficialRuntimeScope;
  #ownsOfficialRuntimeScope: boolean;
  #accountControl: CodexAccountControl;
  #nativeAccountObserver: NativeAccountObserver | undefined;
  #externalAdapters: Map<ExternalHarnessId, HarnessAdapter>;
  #pluginDescriptors: HarnessPluginDescriptor[] = [];
  #usageOnlyAdapters: HarnessUsageStatisticsAdapter[] = [];
  #plugins: HarnessPluginRegistry | undefined;
  readonly #launchSettings: HarnessLaunchSettingsStore;
  readonly #accountInspections = new HarnessAccountInspectionCache();
  readonly #installationTasks = new HarnessInstallationTasks();
  #externalRuntime: ExternalThreadRuntime;
  readonly #executionHosts = new WeakMap<ExternalThread, string>();
  readonly #externalPrewarms = new ExternalThreadPrewarms();
  readonly #externalSteering = new ExternalTurnSteering();
  readonly #liveCommandCache = new LiveCommandCatalogCache();
  readonly #modelPrices: ModelPriceCatalog;
  readonly #observedSessionUsage: ObservedSessionUsage;
  #repository: ExternalThreadRepository;
  #pendingDesktopApprovals = new Map<HostApprovalRequestId, PendingDesktopApproval>();
  #pendingDesktopQuestions = new Map<HostQuestionRequestId, PendingDesktopQuestion>();
  #nextApprovalRequestId = HOST_APPROVAL_REQUEST_ID_MAX;
  #nextQuestionRequestId = HOST_QUESTION_REQUEST_ID_MAX;
  #delegationCoordinator: HarnessDelegationCoordinator;
  #sessionImportRequests: SessionImportRequests | undefined;
  readonly #gitWorkspace = new GitWorkspace();
  readonly #gitRepositoryLinks: GitRepositoryLinks;
  readonly #sshGit: SshGitWorkspaces;
  readonly #gitWorkflow: ProjectGitWorkflow;
  readonly #turnActions: TurnActions;
  readonly #turnActionPlanModes = new Map<string, boolean>();
  readonly #projectSync: ProjectSyncPeer;
  #unregisterDelegationApi: (() => void) | undefined;
  #unsubscribeAccountState: (() => void) | undefined;
  #activeOfficialTurns = new Map<string, string>();
  /** Active reply guards by request ID; each records whether its request was answered. */
  readonly #replyGuards = new Map<unknown, Set<{ answered: boolean }>>();
  #pendingOfficialTurnStarts = new Map<unknown, string>();
  #activeWorkDrainWaiters = new Set<() => void>();
  #pendingOfficialDelegationThreads = new Set<string>();
  #pendingOfficialTerminalStatuses = new Map<string, DelegationStartResult["status"]>();
  readonly #officialRateLimits = new AccountRateLimits();
  #routeObservationTracker = new RequestRouteObservationTracker();
  #officialServerRequests = new Map<JsonRpcId, JsonRpcId>();
  #nextOfficialServerRequestId = 0;
  #sectionMoves: Promise<void> = Promise.resolve();
  #writer: OrderedWriter;
  /** Console requests share Desktop handling; their replies return to the console. */
  readonly #consoleRequestPrefix = `codexhost-console:${randomUUID()}:`;
  readonly #consoleReplies = new Map<string, (message: JsonValue) => void>();
  #nextConsoleRequest = 0;
  #subagentThreadStatuses = new Map<string, "active" | "idle">();
  #runningSubagentsByParent = new Map<string, Set<string>>();
  #pendingExternalCommandRequests = new Set<string>();
  #manualCompactionTurns = new WeakMap<ExternalThread, HostTurnId>();
  #closeRequested = false;
  readonly #pluginLoadAbort = new AbortController();
  #pluginLoading: Promise<void> | undefined;
  #usagePluginsReady: Promise<void> | undefined;
  readonly #desktopRequests = new DesktopRequestQueue();
  #drainActiveWorkOnInputEnd = false;
  #desktopInputEnded = false;
  readonly #threadTerminalSettings: ThreadTerminalSettingsStore;
  readonly #projectTabsSettings: ProjectTabsSettingsStore;
  readonly #projectToolsSettings: ProjectToolsSettingsStore;
  readonly #projectScriptRunner: ProjectScriptRunner;
  readonly #threadFoldersSettings: ThreadFoldersSettingsStore;
  #liveCodexModels: LiveModelCatalog | undefined;
  #catalogRefresh: Promise<BuddyCatalogSync> | undefined;
  readonly #modelAvailability: ModelAvailability;
  #threadAutoArchive: ThreadAutoArchive;
  #modelCatalogGeneration = 0;

  constructor(options: AppServerHostOptions) {
    this.#options = {
      desktopInput: process.stdin,
      desktopOutput: process.stdout,
      diagnosticOutput: process.stderr,
      ...options,
    };
    this.#gitWorkflow = new ProjectGitWorkflow({
      ...(options.gitWorkflowGroup ? { group: options.gitWorkflowGroup } : {}),
      project: async (threadId) =>
        this.#projectGitRoot(await this.#gitWorkspaceForThread(threadId)),
      activeThreads: () => this.#projectActiveThreads(),
      repositories: (cwd) =>
        readProjectGitRepositories(cwd, this.#gitRepositoryLinks, this.#gitWorkspace),
      linkedRepositories: async (cwd) =>
        (await this.#gitRepositoryLinks.list(cwd)).repositories.map(({ path }) => path),
      start: (threadId, cwd, beforeStart, repositories) =>
        this.#startProjectGitWorkflow(threadId, cwd, beforeStart, repositories),
      diagnose: (error) => this.#diagnose(error),
      changed: () => this.#signalActiveWorkChanged(false),
      automatic: () => (this.#options.environment ?? process.env).CODEXHOST_GIT_AUTO_PUSH !== "0",
      waitTimeoutMs: gitWorkflowWaitTimeoutMs(this.#options.environment ?? process.env),
    });
    this.#modelPrices = options.modelPrices ?? new ModelPriceCatalog();
    this.#observedSessionUsage = new ObservedSessionUsage(
      () =>
        [...this.#externalAdapters.values(), ...this.#usageOnlyAdapters].flatMap((adapter) =>
          adapter.sessionUsage ? [adapter.sessionUsage] : [],
        ),
      this.#modelPrices,
      (error) => this.#diagnose(error),
    );
    this.#writer = new OrderedWriter(this.#options.desktopOutput, (value) => {
      this.#noteDesktopReply(value);
      return this.#takeConsoleReply(value);
    });
    const environment = this.#options.environment ?? process.env;
    this.#turnActions = new TurnActions({
      environment,
      privateMode: async () => (await this.#buddy?.privateMode()) ?? false,
      context: (threadId) => this.#turnActionContext(threadId),
      start: (threadId, action, argumentText) =>
        this.#startTurnAction(threadId, action, argumentText),
    });
    this.#threadTerminalSettings = new ThreadTerminalSettingsStore(environment);
    this.#projectTabsSettings = new ProjectTabsSettingsStore(environment);
    this.#projectToolsSettings = new ProjectToolsSettingsStore(environment);
    this.#projectScriptRunner = new ProjectScriptRunner(environment);
    this.#threadFoldersSettings = new ThreadFoldersSettingsStore(environment);
    this.#projectSync = new ProjectSyncPeer(environment);
    this.#launchSettings = new HarnessLaunchSettingsStore(
      this.#options.pluginContext?.environment ?? environment,
    );
    const permanentHome = path.resolve(environment.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
    this.#modelAvailability = new ModelAvailability({
      home: permanentHome,
      environment,
      privateMode: async () => (await this.#buddy?.privateMode()) ?? false,
    });
    this.#threadAutoArchive = new ThreadAutoArchive({
      allowed: async () => !(await this.#buddy?.privateMode()),
      listOfficial: (cutoffSeconds) => this.#listAutoArchiveOfficial(cutoffSeconds),
      listExternal: (cutoffSeconds) => this.#listAutoArchiveExternal(cutoffSeconds),
      canArchiveOfficial: (threadId, cutoffSeconds) =>
        this.#canAutoArchiveOfficial(threadId, cutoffSeconds),
      canArchiveExternal: (threadId, cutoffSeconds) =>
        this.#canAutoArchiveExternal(threadId, cutoffSeconds),
      archiveOfficial: async (threadId, cutoffSeconds) => {
        if (!(await this.#canAutoArchiveOfficial(threadId, cutoffSeconds))) return;
        const response = await this.#requestOfficial("thread/archive", { threadId });
        if (isRecord(response.error)) {
          throw new Error(String(response.error.message ?? "Official Thread archive failed"));
        }
      },
      archiveExternal: async (threadId, cutoffSeconds) => {
        if (!(await this.#canAutoArchiveExternal(threadId, cutoffSeconds))) return;
        const parsed = hostThreadIdSchema.parse(threadId);
        const record = await this.#repository.setArchived(parsed, true);
        const loaded = this.#externalRuntime.get(threadId);
        if (loaded) {
          loaded.record = record;
          loaded.thread = {
            ...externalThreadValue({
              record,
              turns: [],
              sessionId: loaded.sessionId,
              running: loaded.running,
            }),
            turns: loaded.thread.turns ?? [],
          };
        }
        await this.#writer.json({ method: "thread/archived", params: { threadId } });
      },
      diagnose: (error) => this.#diagnose(error),
    });
    this.#sshGit = new SshGitWorkspaces(permanentHome, environment);
    this.#gitRepositoryLinks = new GitRepositoryLinks(
      permanentHome,
      (cwd) => this.#gitWorkspace.root(cwd),
      (cwd, submodule) => this.#gitWorkspace.submoduleRoot(cwd, submodule),
      (project) => discoverChildRepositories(this.#gitWorkspace, project),
    );
    const providerRouting =
      options.officialRuntimeScope?.providerRouting ?? new ProviderRouting(permanentHome);
    this.#ownsOfficialRuntimeScope = options.officialRuntimeScope === undefined;
    this.#officialRuntimeScope =
      options.officialRuntimeScope ??
      new OfficialRuntimeScope({
        providerRouting,
        diagnosticOutput: this.#options.diagnosticOutput,
        permanentHome,
        createBackend: () =>
          createOwnedConnectionBackend(() =>
            options.createOfficialConnection
              ? options.createOfficialConnection()
              : spawnOfficialAppServerConnection({
                  stockCodexPath: this.#options.stockCodexPath,
                  arguments: providerRouting.arguments(this.#options.arguments),
                  environment: {
                    ...officialEnvironment(environment),
                    CODEX_HOME: permanentHome,
                  },
                  ...(this.#options.spawnOfficial
                    ? { spawnOfficial: this.#options.spawnOfficial }
                    : {}),
                  ...(this.#options.officialCloseTimeoutMs === undefined
                    ? {}
                    : { closeTimeoutMs: this.#options.officialCloseTimeoutMs }),
                }),
          ),
      });
    this.#accountControl =
      options.accountControl ??
      new SingleNativeCodexAccount(() => ({
        version: 2,
        currentAccountId: "00000000-0000-4000-8000-000000000001",
        phase: this.#officialRuntimeScope.gate.phase,
        revision: this.#officialRuntimeScope.gate.revision,
        accounts: [
          {
            accountId: "00000000-0000-4000-8000-000000000001",
            label: "Native Codex Account",
          },
        ],
      }));
    this.#officialRuntime = new OfficialRuntimeClient({
      scope: this.#officialRuntimeScope,
      onBackendStopped: () => {
        this.#liveCodexModels = undefined;
        this.#modelCatalogGeneration++;
        this.#pendingOfficialTurnStarts.clear();
        this.#activeOfficialTurns.clear();
        this.#signalActiveWorkChanged();
      },
      output: async (output) =>
        this.#handleOfficialOutput({
          ...output,
          accountId: (await this.#currentCodexAccountId()) ?? "signed-out",
        }),
    });
    if (options.buddyRouting) {
      this.#privateChat = new BuddyPrivateChat(environment);
      this.#translator = new BuddyTranslator(environment);
      this.#speech = new BuddySpeech(environment);
      this.#buddy = new BuddyRouter({
        environment,
        activeWorkChanged: () => this.#signalActiveWorkChanged(),
        request: (method, params) => this.#requestOfficial(method, params),
        send: (message) => this.#writer.json(message),
        forward: async (request) => {
          const params = isRecord(request.params) ? request.params : null;
          const privateTurn = params?.[BUDDY_PRIVATE_TURN_MARKER] === true;
          if ((await this.#buddy?.privateMode()) && !privateTurn) {
            throw new Error("隐私模式已阻止在线执行。");
          }
          const forwarded =
            privateTurn && params ? this.#withoutPrivateTurnMarker(request, params) : request;
          await this.#officialRuntime.send(jsonValueSchema.parse(forwarded) as JsonObject);
        },
        diagnose: (error) => this.#diagnose(error),
      });
    }
    this.#nativeAccountObserver = this.#accountControl.refresh
      ? new NativeAccountObserver({
          control: this.#accountControl,
          scope: this.#officialRuntimeScope,
          notify: (method, params) => this.#writer.json({ method, params }),
          diagnose: () =>
            this.#diagnose("Codex Account identity or notification could not be updated"),
        })
      : undefined;
    this.#unsubscribeAccountState = this.#officialRuntimeScope.gate.subscribe(() => {
      if (this.#options.externalOnly) return;
      const snapshot = this.#accountControl.snapshot();
      void this.#writer
        .json({ method: "codexhost/account/changed", params: jsonValueSchema.parse(snapshot) })
        .catch(() => undefined);
    });
    this.#repository = new ExternalThreadRepository(
      options.mappingStore ??
        createProductionExternalThreadStore(this.#options.environment ?? process.env),
    );
    this.#externalAdapters = new Map(options.externalAdapters);
    for (const [harnessId, adapter] of this.#externalAdapters) {
      if (adapter.harnessId !== harnessId) {
        throw new Error(`External Adapter '${harnessId}' has mismatched Harness ID`);
      }
    }
    this.#externalRuntime = new ExternalThreadRuntime({
      adapters: this.#externalAdapters,
      environment: this.#options.environment ?? process.env,
      repository: this.#repository,
      consumeOutputs: (thread) => this.#consumeHarnessOutputs(thread),
      diagnose: (error) => this.#diagnose(error),
      subagentRunning: (threadId) => this.#subagentThreadStatuses.get(threadId) === "active",
      hasRunningDescendants: (threadId) => this.#hasRunningSubagents(threadId),
      idleRelease: {
        queue: this.#desktopRequests,
        onClosed: async (thread) => {
          for (const pending of [...this.#pendingDesktopApprovals.values()]) {
            if (pending.thread === thread)
              await this.#resolveDesktopApproval(pending.interaction.interactionId);
          }
          for (const pending of [...this.#pendingDesktopQuestions.values()]) {
            if (pending.thread === thread)
              await this.#resolveDesktopQuestion(pending.interaction.interactionId);
          }
        },
        canRelease: (thread) =>
          !this.#hasRunningSubagents(thread.id) &&
          !thread.session.hasBackgroundWork?.() &&
          !this.#externalSteering.hasPending(thread.id) &&
          !this.#pendingExternalCommandRequests.has(thread.id) &&
          ![...this.#pendingDesktopApprovals.values()].some(
            (pending) => pending.thread === thread,
          ) &&
          ![...this.#pendingDesktopQuestions.values()].some((pending) => pending.thread === thread),
      },
    });
    this.#delegationCoordinator = new HarnessDelegationCoordinator({
      adapters: this.#externalAdapters,
      environment: this.#options.environment ?? process.env,
      externalRuntime: this.#externalRuntime,
      repository: this.#repository,
      registerExternalThread: (input) => this.#registerExternalThread(input),
      startExternalTurn: (thread, text, turnId) =>
        this.#startDelegatedExternalTurn(thread, text, turnId),
      notifyThreadStarted: (thread) => this.#notifyExternalThreadStarted(thread),
      inspectOfficial: (input) => this.#inspectOfficialDelegationTarget(input),
      readOfficial: (input) => this.#readOfficialDelegationThread(input),
      sendOfficial: (input) => this.#sendOfficialDelegationThread(input),
      cancelOfficial: (input) => this.#cancelOfficialDelegationThread(input),
      startOfficial: (input) => this.#startOfficialDelegation(input),
      listOfficial: (input) => this.#listDelegationThreads(input),
      officialThreadMetadata: (threadId) => this.#readOfficialThreadMetadata(threadId),
      activeOfficialParents: () => [...this.#activeOfficialTurns.keys()],
      externalThreadBusy: (thread) => this.#externalThreadBusy(thread),
    });
    const maintenanceOperation = <T>(run: () => Promise<T>): Promise<T> =>
      options.runtimeMaintenance ? options.runtimeMaintenance.operation(run) : run();
    const unregisterDelegationApi = options.onDelegationApi?.({
      listHarnesses: () =>
        this.#waitForPlugins().then(() => this.#delegationCoordinator.listHarnesses()),
      inspect: (input) =>
        this.#waitForPlugins().then(() => this.#delegationCoordinator.inspect(input)),
      start: (input) =>
        maintenanceOperation(async () => {
          if (options.sharedDelegation && input.harnessId !== "codex") {
            const active = [...this.#activeOfficialTurns.keys()];
            const parentThreadId =
              input.parentThreadId ?? (active.length === 1 ? active[0] : undefined);
            return options.sharedDelegation.start({
              ...input,
              ...(parentThreadId ? { parentThreadId } : {}),
            });
          }
          return this.#waitForPlugins().then(() => this.#delegationCoordinator.start(input));
        }),
      send: (input) =>
        maintenanceOperation(() =>
          this.#waitForPlugins().then(() => this.#delegationCoordinator.send(input)),
        ),
      cancel: (input) =>
        this.#waitForPlugins().then(() => this.#delegationCoordinator.cancel(input)),
      read: (input) => this.#waitForPlugins().then(() => this.#delegationCoordinator.read(input)),
      wait: (input) => this.#waitForPlugins().then(() => this.#delegationCoordinator.wait(input)),
      list: (input) => this.#waitForPlugins().then(() => this.#delegationCoordinator.list(input)),
      canHandleStart: (input) => this.#canHandleDelegationStart(input),
      ownsThread: (threadId) => this.#ownsDelegationThread(threadId),
      executionHostId: (threadId) => {
        const thread = this.#externalRuntime.get(threadId);
        return thread ? this.#executionHosts.get(thread) : undefined;
      },
    });
    this.#unregisterDelegationApi =
      typeof unregisterDelegationApi === "function" ? unregisterDelegationApi : undefined;
  }

  close(): void {
    if (this.#closeRequested) return;
    this.#closeRequested = true;
    this.#gitWorkflow.close();
    this.#buddy?.close();
    this.#modelAvailability.close();
    this.#privateChat?.close();
    this.#options.sharedThreads?.close();
    this.#externalRuntime.idleRelease.disable();
    this.#threadAutoArchive.disable();
    this.#pluginLoadAbort.abort();
    this.#externalSteering.close();
    this.#signalActiveWorkChanged();
    this.#options.desktopInput.destroy();
    // run() still awaits shutdown and propagates unconfirmed exit. This eager
    // close attempt must not create an independent unhandled rejection.
    void this.#closeOfficialRuntime().catch((error: unknown) => this.#diagnose(error));
  }

  async #closeOfficialRuntime(): Promise<void> {
    this.#gitWorkflow.close();
    await this.#projectSync.close();
    this.#buddy?.close();
    this.#privateChat?.close();
    this.#nativeAccountObserver?.close();
    if (this.#ownsOfficialRuntimeScope) await this.#officialRuntimeScope.close();
    await this.#officialRuntime.close();
  }

  disconnect(): void {
    if (this.#closeRequested || this.#desktopInputEnded || this.#drainActiveWorkOnInputEnd) return;
    this.#drainActiveWorkOnInputEnd = true;
    this.#externalSteering.close();
    const desktopInput = this.#options.desktopInput as Readable & { end?: () => void };
    if (typeof desktopInput.end === "function") desktopInput.end();
    else desktopInput.destroy();
  }

  #attachUsageStatistics(): void {
    this.#options.usageStatistics?.attach(
      (): UsageStatisticsSource[] =>
        [...new Set([...this.#externalAdapters.values(), ...this.#usageOnlyAdapters])].flatMap(
          (adapter) =>
            adapter.usageStatistics
              ? [{ harness: adapter.harnessId, capability: adapter.usageStatistics }]
              : [],
        ),
      () => this.#repository.list(),
    );
  }

  #waitForPlugins(): Promise<void> {
    if (!this.#pluginLoading) {
      const ready = Promise.withResolvers<undefined>();
      const usageReady = () => ready.resolve(undefined);
      this.#usagePluginsReady = ready.promise;
      this.#pluginLoading = this.#loadInstalledPlugins(usageReady)
        .catch((error: unknown) => {
          this.#diagnose(`Harness plugin load failed: ${errorMessage(error)}`);
        })
        .finally(usageReady);
    }
    return this.#pluginLoading;
  }

  async #loadInstalledPlugins(usageReady: () => void): Promise<void> {
    if (!this.#options.pluginRoots || this.#pluginLoadAbort.signal.aborted) return;
    const plugins = await loadHarnessPlugins({
      roots: this.#options.pluginRoots,
      onUsageAdaptersLoaded: (adapters) => {
        if (!this.#pluginLoadAbort.signal.aborted) this.#usageOnlyAdapters = [...adapters.values()];
        usageReady();
      },
      launchCommandForPlugin: (id) => this.#launchSettings.initialCommand(id),
      context: this.#options.pluginContext ?? {
        environment: this.#options.environment ?? process.env,
        platform: process.platform,
        managedRemoteHost: false,
      },
      reservedIds: new Set(this.#externalAdapters.keys()),
      signal: this.#pluginLoadAbort.signal,
      diagnose: (diagnostic) => this.#diagnose(`Harness plugin: ${JSON.stringify(diagnostic)}`),
    });
    if (this.#pluginLoadAbort.signal.aborted) {
      await plugins.close().catch((error: unknown) => this.#diagnose(error));
      return;
    }
    this.#plugins = plugins;
    this.#pluginDescriptors = plugins.list();
    this.#usageOnlyAdapters = [...plugins.usageAdapters.values()];
    for (const [id, adapter] of plugins.adapters) this.#externalAdapters.set(id, adapter);
  }

  async #closeAdapters(): Promise<void> {
    this.#observedSessionUsage.close();
    const results = await Promise.allSettled([
      this.#plugins?.close(),
      ...[...new Set(this.#options.externalAdapters?.values())].map((adapter) =>
        Promise.resolve().then(() => adapter.close()),
      ),
    ]);
    for (const result of results) {
      if (result.status === "rejected") this.#diagnose("Harness plugin cleanup failed");
    }
  }

  async run(): Promise<number> {
    try {
      await this.#repository.initialize();
    } catch (error) {
      this.#diagnose(`Host initialization failed: ${errorMessage(error)}`);
      this.#pluginLoadAbort.abort();
      await this.#pluginLoading;
      await this.#closeAdapters();
      this.#unregisterDelegationApi?.();
      this.#unregisterDelegationApi = undefined;
      this.#unsubscribeAccountState?.();
      this.#unsubscribeAccountState = undefined;
      if (this.#options.closeMappingStoreOnExit !== false) {
        await this.#repository.close().catch((closeError) => this.#diagnose(closeError));
      }
      await this.#closeOfficialRuntime();
      return this.#closeRequested ? 0 : 1;
    }
    try {
      if (!this.#options.externalOnly) await this.#officialRuntime.initialize();
    } catch (error) {
      this.#diagnose(`Official app-server connection failed: ${errorMessage(error)}`);
      // Keep the Desktop client attached for Host initialization and later recovery.
      if (this.#ownsOfficialRuntimeScope) {
        await this.#officialRuntimeScope.owner
          .stop()
          .catch((closeError: unknown) => this.#diagnose(closeError));
      }
    }
    // Load statistics plugins before native subscription negotiation; Session plugins continue
    // independently and must not hold up the official initialization.
    void this.#waitForPlugins().then(() => this.#attachUsageStatistics());
    this.#options.sharedThreads?.start((message) => {
      void this.#writer.json(message).catch((error: unknown) => this.#diagnose(error));
    });
    if (this.#closeRequested) await this.#closeOfficialRuntime();
    try {
      // The Scope proves official exit (and optionally restarts it); this native
      // client stays attached so a replacement generation can reuse it.
      await this.#forwardDesktop();
      return 0;
    } catch (error) {
      if (!this.#closeRequested) this.#diagnose(error);
      this.#options.desktopInput.destroy();
      await this.#closeOfficialRuntime();
      return this.#closeRequested ? 0 : 1;
    } finally {
      this.#options.sharedThreads?.close();
      this.#pluginLoadAbort.abort();
      // Stop replacement waiters before waiting for their tracked Host operations.
      this.#externalSteering.close();
      await this.#desktopRequests.drain();
      this.#externalRuntime.idleRelease.stop();
      await this.#externalRuntime.idleRelease.drain();
      this.#threadAutoArchive.stop();
      await this.#threadAutoArchive.drain();
      await this.#pluginLoading;
      const threads = this.#externalRuntime.values();
      await Promise.allSettled(threads.map(({ session }) => session.close()));
      await Promise.allSettled(threads.map(({ outputTask }) => outputTask));
      await this.#closeAdapters();
      await this.#externalRuntime.drain();
      for (const pending of [...this.#pendingDesktopApprovals.values()]) {
        await this.#resolveDesktopApproval(pending.interaction.interactionId).catch(
          () => undefined,
        );
      }
      for (const pending of [...this.#pendingDesktopQuestions.values()]) {
        await this.#resolveDesktopQuestion(pending.interaction.interactionId).catch(
          () => undefined,
        );
      }
      await this.#closeOfficialRuntime();
      this.#externalRuntime.clear();
      this.#externalPrewarms.clear();
      this.#pendingOfficialTurnStarts.clear();
      this.#routeObservationTracker.clear();
      this.#unregisterDelegationApi?.();
      this.#unregisterDelegationApi = undefined;
      this.#unsubscribeAccountState?.();
      this.#unsubscribeAccountState = undefined;
      if (this.#options.closeMappingStoreOnExit !== false) {
        await this.#repository.close().catch((error) => this.#diagnose(error));
      }
    }
  }

  #hasActiveWork(): boolean {
    return (
      this.#gitWorkflow.hasActiveWork ||
      this.#buddy?.hasActiveWork === true ||
      this.#externalSteering.hasPending() ||
      this.#pendingOfficialTurnStarts.size > 0 ||
      this.#activeOfficialTurns.size > 0 ||
      this.#runningSubagentsByParent.size > 0 ||
      this.#externalRuntime
        .values()
        .some((thread) => thread.running || thread.activeTurnId !== null)
    );
  }

  async #waitForActiveWorkToDrain(): Promise<void> {
    while (!this.#closeRequested && this.#hasActiveWork()) {
      await new Promise<void>((resolve) => this.#activeWorkDrainWaiters.add(resolve));
    }
  }

  #signalActiveWorkChanged(notifyWorkflow = true): void {
    if (notifyWorkflow) this.#gitWorkflow.activityChanged();
    if (!this.#closeRequested && this.#hasActiveWork()) return;
    const waiters = [...this.#activeWorkDrainWaiters];
    this.#activeWorkDrainWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  #observeOfficialTurnStartResponse(value: JsonValue): void {
    if (!isRecord(value) || !("id" in value)) return;
    const threadId = this.#pendingOfficialTurnStarts.get(value.id);
    if (!threadId) return;
    this.#pendingOfficialTurnStarts.delete(value.id);
    const result = isRecord(value.result) ? value.result : null;
    const turn = result && isRecord(result.turn) ? result.turn : null;
    if (turn && typeof turn.id === "string") {
      this.#activeOfficialTurns.set(threadId, turn.id);
    }
    this.#signalActiveWorkChanged();
  }

  #takeConsoleReply(value: JsonValue): boolean {
    if (!isRecord(value) || typeof value.id !== "string") return false;
    const reply = this.#consoleReplies.get(value.id);
    if (!reply) return false;
    this.#consoleReplies.delete(value.id);
    reply(value);
    return true;
  }

  /**
   * Runs one console request through the same handling as Codex Desktop's
   * settings requests. Only {@link CONSOLE_HOST_METHODS} are accepted.
   */
  async handleConsoleRequest(
    method: string,
    params: unknown,
    timeoutMs = CONSOLE_REQUEST_TIMEOUT_MS,
  ): Promise<ConsoleHostReply> {
    if (!isConsoleHostMethod(method)) {
      return { error: { code: -32601, message: `${method} is not available to the console` } };
    }
    if (this.#closeRequested || this.#desktopInputEnded) {
      return { error: { code: -32090, message: "Codex Desktop is closing" } };
    }
    if (method === CONSOLE_REMOTE_CONNECTIONS_METHOD) {
      return requestDesktopRemoteConnections(this.#options.environment ?? process.env, params);
    }
    if (method === REMOTE_SSH_SETUP_METHOD) timeoutMs = Math.max(timeoutMs, 330_000);
    const parsed = jsonRpcRequestSchema.safeParse({
      id: `${this.#consoleRequestPrefix}${++this.#nextConsoleRequest}`,
      method,
      params: params ?? {},
    });
    if (!parsed.success) return { error: { code: -32602, message: "Invalid console request" } };
    const request = parsed.data;
    const id = String(request.id);
    let timer: NodeJS.Timeout | undefined;
    const reply = new Promise<JsonValue>((resolve) => {
      this.#consoleReplies.set(id, resolve);
      timer = setTimeout(
        () => resolve({ id, error: { code: -32093, message: "The Host did not answer in time" } }),
        timeoutMs,
      );
    });
    this.#dispatchDesktopRequest(() =>
      this.#guardReply(request, () =>
        this.#handleDesktopRequest(request, Buffer.from(JSON.stringify(request))),
      ),
    );
    try {
      const message = await reply;
      if (isRecord(message) && "result" in message) {
        return { result: (message.result ?? null) as JsonValue };
      }
      const error = isRecord(message) && isRecord(message.error) ? message.error : undefined;
      return {
        error: {
          code: typeof error?.code === "number" ? error.code : -32603,
          message: typeof error?.message === "string" ? error.message : "Host request failed",
        },
      };
    } finally {
      clearTimeout(timer);
      this.#consoleReplies.delete(id);
    }
  }

  #forgetPendingOfficialTurnStarts(threadId: string): void {
    for (const [requestId, pendingThreadId] of this.#pendingOfficialTurnStarts) {
      if (pendingThreadId === threadId) this.#pendingOfficialTurnStarts.delete(requestId);
    }
  }

  async #forwardDesktop(): Promise<void> {
    for await (const frame of readLfFrames(this.#options.desktopInput)) {
      const parsed = parseJsonFrame(frame);
      try {
        if (await this.#options.sharedThreads?.respond(parsed)) continue;
      } catch (error) {
        // An expired remote interaction must not tear down this GUI's native
        // connection or its unrelated local Sessions.
        this.#diagnose(error);
        continue;
      }
      if (isRecord(parsed) && parsed.method === "initialized" && !("id" in parsed)) {
        continue;
      }
      if (isRecord(parsed) && !("method" in parsed) && (await this.#buddy?.privateMode())) {
        // 隐私模式期间不把任何普通审批或问答回复交给在线执行链。
        continue;
      }
      if (await this.#handleDesktopApprovalResponse(parsed)) continue;
      if (await this.#handleDesktopQuestionResponse(parsed)) continue;
      const requestResult = jsonRpcRequestSchema.safeParse(parsed);
      if (!requestResult.success) {
        await this.#forwardOfficialNonRequest(parsed, frame).catch(() => {
          this.#diagnose("Official notification or server reply could not be delivered");
        });
        continue;
      }
      const request = requestResult.data;
      if (request.method === "initialize") {
        try {
          const nativeGeneration =
            this.#officialRuntimeScope.gate.phase === "ready"
              ? this.#officialRuntimeScope.owner.generation
              : undefined;
          // Native exclusions are immutable after initialization. Wait for the statistics
          // phase to settle (including loader failures/timeouts), not an arbitrary race and
          // not the much larger Session plugin registry.
          void this.#waitForPlugins();
          await this.#usagePluginsReady;
          const params = requestObject(request);
          const options = this.#observedSessionUsage.requestOptions("initialize", params);
          const nativeParams = options ? { ...params, ...options } : params;
          const response = await this.#officialRuntime.initializeProtocol(nativeParams);
          if (!isRecord(response.error)) this.#observedSessionUsage.initialized(nativeParams);
          await this.#writer.json({ ...response, id: request.id });
          this.#nativeAccountObserver?.initialized(nativeGeneration);
        } catch (error) {
          await this.#writer.json(rpcError(request, -32087, errorMessage(error)));
        }
        continue;
      }
      const threadId =
        isRecord(request.params) && typeof request.params.threadId === "string"
          ? request.params.threadId
          : undefined;
      this.#dispatchDesktopRequest(() =>
        this.#desktopRequests.run(threadId, () =>
          this.#externalRuntime.idleRelease.runOperation(threadId, () =>
            this.#guardReply(request, () => this.#handleDesktopRequest(request, frame)),
          ),
        ),
      );
    }
    this.#desktopInputEnded = true;
    this.#modelAvailability.close();
    this.#externalRuntime.idleRelease.disable();
    this.#threadAutoArchive.disable();
    // Cancel loading before draining requests that may be waiting for it.
    this.#pluginLoadAbort.abort();
    await this.#desktopRequests.drain();
    this.#externalSteering.close();
    if (this.#drainActiveWorkOnInputEnd) await this.#waitForActiveWorkToDrain();
    await this.#closeOfficialRuntime();
  }

  /**
   * A handler failure must still answer the request; otherwise Codex Desktop waits forever.
   * Requests already answered or handed to native Codex are left alone. Work a handler detaches
   * through {@link #dispatchDesktopReply} keeps its own guard.
   */
  async #guardReply(request: JsonRpcRequest, run: () => Promise<void>): Promise<void> {
    const guard = { answered: false };
    let guards = this.#replyGuards.get(request.id);
    if (!guards) {
      guards = new Set();
      this.#replyGuards.set(request.id, guards);
    }
    guards.add(guard);
    try {
      await run();
    } catch (error) {
      this.#diagnose(error);
      if (!guard.answered) {
        await this.#writer
          .json(rpcError(request, -32603, "codexhost could not handle the request"))
          .catch((writeError: unknown) => this.#diagnose(writeError));
      }
    } finally {
      guards.delete(guard);
      if (guards.size === 0) this.#replyGuards.delete(request.id);
    }
  }

  #markDesktopRequestAnswered(id: unknown): void {
    for (const guard of this.#replyGuards.get(id) ?? []) guard.answered = true;
  }

  #noteDesktopReply(value: JsonValue): void {
    if (isRecord(value) && "id" in value && !("method" in value)) {
      this.#markDesktopRequestAnswered(value.id);
    }
  }

  /** Detaches work that answers `request`, keeping the failure fallback. */
  #dispatchDesktopReply(
    request: JsonRpcRequest,
    run: () => Promise<void>,
    threadId?: string,
  ): void {
    this.#dispatchDesktopRequest(() => this.#guardReply(request, run), threadId);
  }

  async #handleDesktopRequest(
    request: JsonRpcRequest,
    frame: Buffer<ArrayBufferLike>,
  ): Promise<void> {
    if (this.#closeRequested) return;
    if (
      request.method === RUNTIME_STATUS_METHOD ||
      request.method === REMOTE_UPDATE_METHOD ||
      request.method === REMOTE_SSH_SETUP_METHOD
    ) {
      const maintenance = this.#options.runtimeMaintenance;
      try {
        if (!maintenance)
          throw new Error("Runtime version management is unavailable in this build");
        const result =
          request.method === RUNTIME_STATUS_METHOD
            ? await maintenance.status()
            : request.method === REMOTE_SSH_SETUP_METHOD
              ? await maintenance.setupSsh(remoteSshSetupParamsSchema.parse(request.params))
              : await maintenance.start(remoteUpdateParamsSchema.parse(request.params).version);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      } catch (error) {
        await this.#writer.json(rpcError(request, -32090, errorMessage(error)));
      }
      return;
    }
    if (this.#options.runtimeMaintenance?.blocked) {
      await this.#writer.json(
        rpcError(request, -32090, "Remote service is updating; reconnect shortly"),
      );
      return;
    }
    if (request.method === DELEGATION_READ_METHOD) {
      const parsed = delegationReadParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        await this.#writer.json(rpcError(request, -32602, "Invalid Thread read request"));
        return;
      }
      const shared = await this.#options.sharedThreads?.route(request);
      if (shared) {
        await this.#writer.json(shared);
        return;
      }
      await this.#waitForPlugins();
      const result = await this.#delegationCoordinator.read({
        threadId: parsed.data.threadId,
        view: parsed.data.view,
        ...(parsed.data.cursor !== undefined ? { cursor: parsed.data.cursor } : {}),
        ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      });
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      return;
    }
    if (this.#options.externalOnly && request.method === "codexhost/shared-threads/placements") {
      await this.#writer.json(
        rpcEnvelope(request, {
          result: jsonValueSchema.parse(await this.#repository.listSectionPlacements()),
        }),
      );
      return;
    }
    if (
      this.#options.sharedThreads &&
      (request.method.startsWith("thread/") ||
        request.method.startsWith("turn/") ||
        request.method.startsWith("codexhost/thread/"))
    ) {
      try {
        const reply = await this.#options.sharedThreads.route(request);
        if (reply) {
          await this.#writer.json(reply);
          return;
        }
      } catch (error) {
        await this.#writer.json(rpcError(request, -32090, errorMessage(error)));
        return;
      }
    }
    if (
      this.#options.externalOnly &&
      !(
        request.method.startsWith("thread/") ||
        request.method.startsWith("turn/") ||
        request.method.startsWith("codexhost/thread/") ||
        request.method.startsWith("codexhost/harness/")
      )
    ) {
      await this.#writer.json(
        rpcError(request, -32601, "Method is unavailable on the shared Thread service"),
      );
      return;
    }
    if (this.#externalPrewarms.observe(request)) {
      await this.#writer.json(
        rpcError(request, -32075, "External prewarm close was not confirmed"),
      );
      return;
    }
    if (request.method === THREAD_PREWARM_DISCARD_METHOD) {
      const parsed = threadPrewarmDiscardParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        await this.#writer.json(rpcError(request, -32602, "Invalid prewarm discard request"));
        return;
      }
      try {
        const discarded = await this.#externalPrewarms.discard(parsed.data.threadId, {
          get: (id) => this.#externalRuntime.get(id),
          remove: async (thread) => {
            await this.#repository.removeThread(thread.id);
            this.#externalRuntime.remove(thread.id);
            this.#routeObservationTracker.forgetThread(thread.id);
          },
        });
        await this.#writer.json(rpcEnvelope(request, { result: { discarded } }));
      } catch (error) {
        this.#diagnose(error);
        await this.#writer.json(rpcError(request, -32075, "External prewarm could not close"));
      }
      return;
    }
    if (
      request.method === HARNESS_DISPLAY_GET_METHOD ||
      request.method === HARNESS_DISPLAY_SET_METHOD
    ) {
      const parsed = (
        request.method === HARNESS_DISPLAY_SET_METHOD
          ? harnessDisplaySetSchema
          : harnessDisplayGetSchema
      ).safeParse(request.params ?? {});
      if (!parsed.success) {
        await this.#writer.json(rpcError(request, -32602, "Invalid Harness display settings"));
        return;
      }
      try {
        const store = new HarnessDisplaySettingsStore(this.#options.environment ?? process.env);
        const result =
          request.method === HARNESS_DISPLAY_SET_METHOD
            ? await store.set(harnessDisplaySetSchema.parse(parsed.data))
            : await store.get();
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      } catch {
        await this.#writer.json(
          rpcError(request, -32000, "Could not save or read Harness display settings"),
        );
      }
      return;
    }
    if (request.method === USAGE_STATISTICS_METHOD) {
      const parsed = usageStatisticsParamsSchema.safeParse(request.params ?? {});
      const statistics = this.#options.usageStatistics;
      if (!parsed.success || !statistics) {
        await this.#writer.json(
          parsed.success
            ? rpcError(request, -32000, "Usage statistics are unavailable on this Host")
            : rpcError(request, -32602, "Invalid usage statistics request"),
        );
        return;
      }
      try {
        await this.#waitForPlugins();
        this.#attachUsageStatistics();
        const result = await statistics.get(parsed.data);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      } catch (error) {
        this.#diagnose(error);
        await this.#writer.json(rpcError(request, -32000, errorMessage(error)));
      }
      return;
    }
    if (isModelPriceOverridesMethod(request.method)) {
      try {
        const result = await handleModelPriceOverridesRequest(
          this.#modelPrices,
          request.method,
          request.params,
        );
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      } catch (error) {
        if (!(error instanceof ModelPriceOverridesError)) this.#diagnose(error);
        await this.#writer.json(rpcError(request, -32000, errorMessage(error)));
      }
      return;
    }
    if (
      (request.method === "turn/start" || request.method === "turn/steer") &&
      isRecord(request.params) &&
      typeof request.params.threadId === "string" &&
      isRecord(request.params.collaborationMode)
    ) {
      this.#turnActionPlanModes.set(
        request.params.threadId,
        request.params.collaborationMode.mode === "plan",
      );
    }
    if (
      request.method === TURN_ACTIONS_INSPECT_METHOD ||
      request.method === TURN_ACTION_EXECUTE_METHOD
    ) {
      this.#dispatchDesktopRequest(
        async () => {
          try {
            const result =
              request.method === TURN_ACTIONS_INSPECT_METHOD
                ? await this.#turnActions.inspect(request.params)
                : await this.#turnActions.execute(request.params);
            await this.#writer.json(
              rpcEnvelope(request, { result: jsonValueSchema.parse(result) }),
            );
          } catch (error) {
            await this.#writer.json(rpcError(request, -32090, errorMessage(error)));
          }
        },
        isRecord(request.params) && typeof request.params.threadId === "string"
          ? request.params.threadId
          : undefined,
      );
      return;
    }
    if (request.method === BUDDY_INTERRUPTED_METHOD || request.method === BUDDY_CONTINUE_METHOD) {
      try {
        if (request.method === BUDDY_CONTINUE_METHOD) {
          const params = buddyContinueSchema.parse(request.params);
          this.#buddy?.cancel(params.threadId);
          await this.#interrupted.continue(
            params.threadId,
            params.turnId,
            params.model ? { model: params.model } : undefined,
          );
          await this.#writer.json(rpcEnvelope(request, { result: {} }));
        } else {
          await this.#writer.json(
            rpcEnvelope(request, { result: jsonValueSchema.parse(await this.#interrupted.list()) }),
          );
        }
      } catch (error) {
        await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
      }
      return;
    }
    if (request.method === THREAD_ARCHIVE_COMPLETED_METHOD) {
      try {
        const params = threadArchiveCompletedParamsSchema.parse(request.params);
        const result = threadArchiveCompletedResultSchema.parse(
          await this.#interrupted.archiveCompleted(params.threadId),
        );
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      } catch (error) {
        await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
      }
      return;
    }
    if (request.method === BUDDY_PRIVATE_METHOD) {
      try {
        if (!this.#privateChat || !this.#buddy) {
          throw new Error("当前 Host 不支持离线隐私通道；未发送内容。");
        }
        const snapshot = await this.#privateChat.handle(
          request.params,
          await this.#buddy.privateMode(),
        );
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(snapshot) }));
      } catch (error) {
        await this.#writer.json(rpcError(request, -32091, errorMessage(error)));
      }
      return;
    }
    if (request.method === BUDDY_TRANSLATE_METHOD) {
      try {
        if (!this.#translator) {
          throw new Error("当前 Host 不支持翻译功能；未配置 Buddy。");
        }
        const result = await this.#translator.translate(request.params);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      } catch (error) {
        await this.#writer.json(rpcError(request, -32092, errorMessage(error)));
      }
      return;
    }
    if (request.method === BUDDY_TRANSLATE_BATCH_METHOD) {
      try {
        if (!this.#translator) {
          throw new Error("当前 Host 不支持翻译功能；未配置 Buddy。");
        }
        const result = await this.#translator.translateBatch(request.params);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      } catch (error) {
        await this.#writer.json(rpcError(request, -32092, errorMessage(error)));
      }
      return;
    }
    if (request.method === BUDDY_SPEECH_METHOD) {
      try {
        if (!this.#speech) {
          throw new Error("当前 Host 不支持语音播报；未配置 Buddy。");
        }
        // 播报会把回合摘要送到网关，隐私模式下必须保持静默。
        if (await this.#buddy?.privateMode()) {
          throw new Error("隐私模式已阻止语音播报。");
        }
        const result = await this.#speech.synthesize(request.params);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      } catch (error) {
        await this.#writer.json(rpcError(request, -32093, errorMessage(error)));
      }
      return;
    }
    if (request.method === SSH_TURN_ACTIONS_METHOD) {
      this.#dispatchDesktopRequest(async () => {
        try {
          const result = await readSshTurnActions({
            params: request.params,
            environment: this.#options.environment ?? process.env,
          });
          await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        } catch (error) {
          await this.#writer.json(rpcError(request, -32090, errorMessage(error)));
        }
      });
      return;
    }
    if (request.method === SSH_AUTO_MODEL_ROUTES_METHOD) {
      this.#dispatchDesktopRequest(async () => {
        try {
          const result = await readSshAutoModelRoutes({
            params: request.params,
            environment: this.#options.environment ?? process.env,
          });
          await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        } catch (error) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
        }
      });
      return;
    }
    if (
      request.method === REMOTE_PROJECTS_INSPECT_METHOD ||
      request.method === REMOTE_PROJECTS_SYNC_METHOD
    ) {
      this.#dispatchDesktopRequest(async () => {
        try {
          const input = {
            params: request.params,
            environment: this.#options.environment ?? process.env,
          };
          const result =
            request.method === REMOTE_PROJECTS_SYNC_METHOD
              ? await syncSshRemoteProjects(input)
              : await inspectSshRemoteProjects(input);
          await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        } catch (error) {
          await this.#writer.json(rpcError(request, -32090, errorMessage(error)));
        }
      });
      return;
    }
    if (request.method === AUTO_MODEL_ROUTES_METHOD) {
      this.#dispatchDesktopRequest(async () => {
        try {
          const result = await readAutoModelRoutes({
            params: request.params,
            environment: this.#options.environment ?? process.env,
            privateMode: async () => this.#buddy?.privateMode(),
            readThread: (threadId) =>
              this.#requestOfficial("thread/read", { threadId, includeTurns: false }),
          });
          await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        } catch (error) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
        }
      });
      return;
    }
    if (request.method === SESSION_ROUTE_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleSessionRoute(request));
      return;
    }
    if (request.method === MODEL_AVAILABILITY_METHOD) {
      this.#dispatchDesktopRequest(async () => {
        try {
          const snapshot = await this.#modelAvailability.handle(request.params);
          await this.#writer.json(
            rpcEnvelope(request, { result: jsonValueSchema.parse(snapshot) }),
          );
        } catch (error) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
        }
      });
      return;
    }
    if (request.method === BUDDY_CATALOG_SYNC_METHOD) {
      this.#dispatchDesktopRequest(async () => {
        try {
          if (!this.#buddy || (await this.#buddy.privateMode())) {
            throw new Error("隐私模式或未启用 Buddy 时不刷新在线模型目录。");
          }
          const pending = this.#catalogRefresh ?? this.#syncLiveModelCatalog();
          this.#catalogRefresh = pending;
          try {
            const result = await pending;
            await this.#writer.json(
              rpcEnvelope(request, { result: jsonValueSchema.parse(result) }),
            );
          } finally {
            if (this.#catalogRefresh === pending) this.#catalogRefresh = undefined;
          }
        } catch (error) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
        }
      });
      return;
    }
    if (
      [
        BUDDY_STATUS_METHOD,
        BUDDY_SETTINGS_METHOD,
        BUDDY_CANCEL_METHOD,
        BUDDY_MODELS_METHOD,
        BUDDY_JEV_KEY_METHOD,
      ].includes(request.method)
    ) {
      if (!this.#buddy) {
        await this.#writer.json(
          rpcError(request, -32601, "Buddy Router is not enabled on this Host"),
        );
        return;
      }
      try {
        if (request.method === BUDDY_JEV_KEY_METHOD) {
          await this.#buddy.configureJevKey(buddyJevKeySchema.parse(request.params));
        }
        if (request.method === BUDDY_CANCEL_METHOD) {
          const params = requestObject(request);
          if (typeof params.threadId !== "string") {
            throw new Error("Missing threadId");
          }
          this.#buddy.cancel(params.threadId);
        }
        const snapshot =
          request.method === BUDDY_SETTINGS_METHOD
            ? await this.#buddy.configure(request.params)
            : request.method === BUDDY_JEV_KEY_METHOD
              ? await this.#buddy.snapshot()
              : request.method === BUDDY_MODELS_METHOD
                ? await this.#buddy.refreshModels()
                : await this.#buddy.snapshot();
        if (request.method === BUDDY_SETTINGS_METHOD && !snapshot.settings.privateMode) {
          this.#privateChat?.close();
        }
        if (request.method === BUDDY_SETTINGS_METHOD && snapshot.settings.privateMode) {
          this.#modelAvailability.close();
        }
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(snapshot) }));
      } catch (error) {
        await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
      }
      return;
    }
    if (request.method === PROVIDER_ROUTING_METHOD) {
      try {
        const routing = this.#officialRuntimeScope.providerRouting;
        if (!routing) throw new Error("Provider routing is unavailable on this Host");
        const snapshot = await routing.configure(providerRoutingParamsSchema.parse(request.params));
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(snapshot) }));
      } catch (error) {
        await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
      }
      return;
    }
    if (request.method === EMERGENCY_PROVIDER_METHOD) {
      try {
        const parsed = emergencyProviderConfigSchema.parse(request.params);
        const routing = this.#officialRuntimeScope.providerRouting;
        if (!routing) throw new Error("Provider routing is unavailable on this Host");
        let snapshot = await routing.configure({ action: "read" });
        const existing = snapshot.providers.find((provider) => provider.id === "legacy-emergency");
        if (
          parsed.apiKey === null ||
          parsed.baseURL === null ||
          parsed.apiKey === "" ||
          parsed.baseURL === ""
        ) {
          snapshot = await routing.configure({ action: "remove", id: "legacy-emergency" });
        } else if (parsed.apiKey || parsed.baseURL) {
          snapshot = await routing.configure({
            action: "save",
            provider: {
              id: "legacy-emergency",
              name: "Emergency",
              baseUrl: parsed.baseURL ?? existing?.baseUrl ?? "",
              model: "",
              enabled: true,
            },
            ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
          });
        }
        if (parsed.enabled !== undefined) {
          snapshot = await routing.configure({ action: "configure", enabled: parsed.enabled });
        }
        const emergency = snapshot.providers.find((provider) => provider.id === "legacy-emergency");
        const buddy = await this.#buddy?.snapshot();
        const result = buddySnapshotSchema.parse({
          ...(buddy ?? { settings: {}, models: [], decisions: [] }),
          emergencyConfigured: Boolean(emergency?.keyConfigured),
          emergencyEnabled: snapshot.enabled && Boolean(emergency?.enabled),
          emergencyBaseUrl: emergency?.baseUrl ?? null,
        });
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      } catch (error) {
        await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
      }
      return;
    }
    if (request.method === "model/list" && this.#liveCodexModels) {
      this.#dispatchDesktopRequest(async () => {
        try {
          const params = request.params == null ? {} : requestObject(request);
          const response = await this.#requestOfficial(request.method, params);
          const envelope =
            response.error === undefined
              ? { result: response.result ?? null }
              : { error: response.error };
          await this.#writer.json(rpcEnvelope(request, envelope));
        } catch (error) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
        }
      });
      return;
    }
    if (
      request.method === GIT_WORKFLOW_STATUS_METHOD ||
      request.method === GIT_WORKFLOW_RUN_METHOD
    ) {
      this.#dispatchDesktopRequest(async () => {
        try {
          const { threadId } = gitWorkflowParamsSchema.parse(request.params);
          const snapshot =
            request.method === GIT_WORKFLOW_RUN_METHOD
              ? await this.#gitWorkflow.run(threadId)
              : await this.#gitWorkflow.inspect(threadId);
          await this.#writer.json(
            rpcEnvelope(request, { result: jsonValueSchema.parse(snapshot) }),
          );
        } catch (error) {
          await this.#writer.json(rpcError(request, -32090, errorMessage(error)));
        }
      });
      return;
    }
    if (request.method === LOADED_SESSIONS_METHOD) {
      await this.#writer.json(
        rpcEnvelope(request, { result: this.#externalRuntime.idleRelease.list() }),
      );
      return;
    }
    if (request.method === IDLE_RELEASE_SETTINGS_METHOD) {
      const parsed = idleReleaseSettingsSchema.safeParse(request.params);
      if (!parsed.success) {
        await this.#writer.json(rpcError(request, -32602, "Invalid idle release settings"));
      } else {
        const settings = this.#externalRuntime.idleRelease.configure(parsed.data);
        await this.#writer.json(rpcEnvelope(request, { result: settings }));
      }
      return;
    }
    if (request.method === THREAD_AUTO_ARCHIVE_SETTINGS_METHOD) {
      const parsed = threadAutoArchiveSettingsSchema.safeParse(request.params);
      if (!parsed.success) {
        await this.#writer.json(rpcError(request, -32602, "Invalid Thread auto archive settings"));
      } else {
        const settings = this.#threadAutoArchive.configure(parsed.data);
        await this.#writer.json(rpcEnvelope(request, { result: settings }));
      }
      return;
    }
    if (
      request.method === "codexhost/update/check" ||
      request.method === "codexhost/update/start" ||
      request.method === "codexhost/update/restart" ||
      request.method === "codexhost/update/status"
    ) {
      this.#dispatchDesktopReply(request, () => this.#handleUpdateRequest(request));
      return;
    }
    if (request.method === CONSOLE_OPEN_METHOD) {
      this.#dispatchDesktopReply(request, () => this.#handleConsoleOpen(request));
      return;
    }
    if (request.method === SSH_GIT_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleSshGitRequest(request));
      return;
    }
    if (
      request.method === GIT_REPOSITORIES_METHOD ||
      request.method === GIT_REPOSITORY_LINK_METHOD ||
      request.method === GIT_REPOSITORY_UNLINK_METHOD ||
      request.method === GIT_REPOSITORY_DIRECTORIES_METHOD ||
      request.method === GIT_REPOSITORY_CLONE_METHOD ||
      request.method === GIT_STATUS_METHOD ||
      request.method === GIT_DIFF_METHOD ||
      request.method === GIT_CONTENT_METHOD ||
      request.method === GIT_STAGE_METHOD ||
      request.method === GIT_UNSTAGE_METHOD ||
      request.method === GIT_COMMIT_METHOD ||
      request.method === GIT_PUSH_METHOD ||
      request.method === GIT_MESSAGE_MODEL_METHOD ||
      request.method === GIT_MESSAGE_GENERATE_METHOD ||
      request.method === GIT_SUBMODULES_METHOD ||
      request.method === GIT_SUBMODULE_UPDATE_METHOD ||
      request.method === GIT_LOG_METHOD ||
      request.method === GIT_COMMIT_DETAIL_METHOD ||
      request.method === GIT_COMMIT_DIFF_METHOD ||
      request.method === GIT_FETCH_METHOD ||
      request.method === GIT_SYNC_METHOD ||
      request.method === GIT_MERGE_CONTINUE_METHOD ||
      request.method === GIT_MERGE_ABORT_METHOD
    ) {
      this.#dispatchDesktopRequest(() => this.#handleGitRequest(request));
      return;
    }
    if (
      request.method === WORKSPACE_FILES_LIST_METHOD ||
      request.method === WORKSPACE_FILES_READ_METHOD ||
      request.method === WORKSPACE_FILES_WRITE_METHOD
    ) {
      this.#dispatchDesktopRequest(() => this.#handleWorkspaceFilesRequest(request));
      return;
    }
    if (request.method === THREAD_OPEN_TARGET_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleThreadOpenTargetRequest(request));
      return;
    }
    if (request.method === THREAD_TERMINAL_OPEN_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleThreadTerminalRequest(request));
      return;
    }
    if (request.method === THREAD_TERMINAL_LIST_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleThreadTerminalListRequest(request));
      return;
    }
    if (request.method === THREAD_WORKSPACE_OPEN_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleThreadWorkspaceOpenRequest(request));
      return;
    }
    if (request.method === DOUBAO_OPEN_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleDoubaoOpenRequest(request));
      return;
    }
    if (request.method === PROJECT_TERMINAL_OPEN_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleProjectTerminalOpenRequest(request));
      return;
    }
    if (request.method === PROJECT_WORKSPACE_OPEN_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleProjectWorkspaceOpenRequest(request));
      return;
    }
    if (
      request.method === THREAD_TERMINAL_SETTINGS_GET_METHOD ||
      request.method === THREAD_TERMINAL_SETTINGS_SET_METHOD
    ) {
      this.#dispatchDesktopRequest(() => this.#handleThreadTerminalSettingsRequest(request));
      return;
    }
    if (request.method === PROJECT_TABS_GET_METHOD || request.method === PROJECT_TABS_SET_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleProjectTabsSettingsRequest(request));
      return;
    }
    if (
      request.method === PROJECT_TOOLS_GET_METHOD ||
      request.method === PROJECT_TOOLS_SET_METHOD
    ) {
      this.#dispatchDesktopRequest(() => this.#handleProjectToolsSettingsRequest(request));
      return;
    }
    if (request.method === PROJECT_TOOLS_RUN_SCRIPT_METHOD) {
      this.#dispatchDesktopRequest(() => this.#handleProjectToolsRunScriptRequest(request));
      return;
    }
    if (
      request.method === THREAD_FOLDERS_GET_METHOD ||
      request.method === THREAD_FOLDERS_SET_METHOD
    ) {
      this.#dispatchDesktopRequest(() => this.#handleThreadFoldersSettingsRequest(request));
      return;
    }
    if (
      request.method === PROJECT_SYNC_INSPECT_METHOD ||
      request.method === PROJECT_SYNC_INVITE_METHOD ||
      request.method === PROJECT_SYNC_PAIR_METHOD ||
      request.method === PROJECT_SYNC_ACCEPT_METHOD ||
      request.method === PROJECT_SYNC_REJECT_METHOD ||
      request.method === PROJECT_SYNC_GIT_CONFIGURE_METHOD ||
      request.method === PROJECT_SYNC_GIT_PULL_METHOD ||
      request.method === PROJECT_SYNC_GIT_PUSH_METHOD ||
      request.method === PROJECT_SYNC_SYNC_METHOD ||
      request.method === PROJECT_SYNC_REMOVE_PEER_METHOD ||
      request.method === PROJECT_SYNC_ADD_METHOD ||
      request.method === PROJECT_SYNC_BIND_METHOD ||
      request.method === PROJECT_SYNC_CLONE_METHOD
    ) {
      this.#dispatchDesktopRequest(() => this.#handleProjectSyncRequest(request));
      return;
    }
    if (
      request.method === "codexhost/account/usage/inspect" ||
      request.method === "codexhost/account/list" ||
      request.method === "codexhost/account/refresh"
    ) {
      this.#dispatchDesktopReply(request, () => this.#handleCodexAccountRequest(request));
      return;
    }
    if (request.method === CREDENTIAL_IMPORTS_METHOD) {
      this.#dispatchDesktopReply(request, async () => {
        if (!credentialImportsParamsSchema.safeParse(request.params).success) {
          await this.#writer.json(rpcError(request, -32602, "Invalid credential import request"));
          return;
        }
        await this.#waitForPlugins();
        try {
          const result = await handleCredentialImports(
            request.params,
            this.#externalAdapters.values(),
            this.#options.environment ?? process.env,
          );
          await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        } catch {
          // Credential/native SDK exceptions can include sensitive input. Never forward them.
          await this.#writer.json(
            rpcError(
              request,
              -32077,
              "Credential operation failed. Check the source login, choose an unused Provider name, and verify Pi configuration access.",
            ),
          );
        }
      });
      return;
    }
    if (request.method === "codexhost/harness/accounts/sources") {
      this.#dispatchDesktopReply(request, async () => {
        if (!harnessAccountSourceListParamsSchema.safeParse(request.params).success) {
          await this.#writer.json(
            rpcError(request, -32602, "Invalid Harness account source list params"),
          );
          return;
        }
        await this.#waitForPlugins();
        const result = listHarnessAccountSources(
          this.#externalAdapters.values(),
          this.#pluginDescriptors,
        );
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      });
      return;
    }
    if (request.method === "codexhost/harness/accounts/inspect") {
      this.#dispatchDesktopReply(request, async () => {
        const params = harnessAccountInspectParamsSchema.safeParse(request.params);
        if (!params.success) {
          await this.#writer.json(
            rpcError(request, -32602, "Invalid Harness account inspection params"),
          );
          return;
        }
        await this.#waitForPlugins();
        const adapter = this.#externalAdapters.get(params.data.harnessId);
        if (!adapter) {
          await this.#writer.json(
            rpcError(request, -32077, `Harness '${params.data.harnessId}' is unavailable`),
          );
          return;
        }
        const result = harnessAccountInspectResultSchema.parse(
          await this.#inspectHarnessAccount(adapter, params.data.refresh === true),
        );
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      });
      return;
    }
    if (request.method === "codexhost/harness/accounts/list") {
      this.#dispatchDesktopReply(request, async () => {
        const params = harnessAccountListParamsSchema.safeParse(request.params);
        if (!params.success) {
          await this.#writer.json(rpcError(request, -32602, "Invalid Harness account list params"));
          return;
        }
        await this.#waitForPlugins();
        const inspections = await Promise.all(
          [...this.#externalAdapters.values()].map((adapter) =>
            this.#inspectHarnessAccount(adapter, params.data.refresh === true),
          ),
        );
        const result = harnessAccountListResultSchema.parse({
          accounts: inspections.flatMap((inspection) => listedHarnessAccounts(inspection)),
        });
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      });
      return;
    }
    if (request.method === "codexhost/harness/inspect") {
      this.#dispatchDesktopReply(request, () => this.#inspectHarness(request));
      return;
    }
    if (
      request.method === HARNESS_INSTALLATION_METHOD ||
      request.method === HARNESS_INSTALLATION_START_METHOD ||
      request.method === HARNESS_INSTALLATION_STATUS_METHOD
    ) {
      this.#dispatchDesktopReply(request, async () => {
        try {
          if (request.method !== HARNESS_INSTALLATION_STATUS_METHOD) await this.#waitForPlugins();
          const result =
            request.method === HARNESS_INSTALLATION_START_METHOD
              ? this.#installationTasks.start(request.params, this.#externalAdapters)
              : request.method === HARNESS_INSTALLATION_STATUS_METHOD
                ? this.#installationTasks.status(request.params)
                : await handleHarnessInstallation(request.params, this.#externalAdapters);
          await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        } catch (error) {
          await this.#writer.json(
            rpcError(
              request,
              error instanceof HarnessInstallationError ? error.code : -32077,
              error instanceof HarnessInstallationError
                ? error.message
                : "Harness version management failed",
            ),
          );
        }
      });
      return;
    }
    if (request.method === "codexhost/harness/web-ui/open") {
      this.#dispatchDesktopReply(request, () => this.#openHarnessWebUi(request));
      return;
    }
    if (
      request.method === HARNESS_LAUNCH_SETTINGS_GET_METHOD ||
      request.method === HARNESS_LAUNCH_SETTINGS_SET_METHOD
    ) {
      this.#dispatchDesktopReply(request, async () => {
        const schema =
          request.method === HARNESS_LAUNCH_SETTINGS_SET_METHOD
            ? harnessLaunchSettingsSetSchema
            : harnessLaunchSettingsGetSchema;
        const params = schema.safeParse(request.params);
        if (!params.success) {
          await this.#writer.json(rpcError(request, -32602, "Invalid Harness launch settings"));
          return;
        }
        await this.#waitForPlugins();
        if (
          !this.#pluginDescriptors.some(
            (plugin) => plugin.id === params.data.harnessId && plugin.launchCommand,
          )
        ) {
          await this.#writer.json(
            rpcError(request, -32602, "Harness launch settings are unavailable"),
          );
          return;
        }
        try {
          const result =
            request.method === HARNESS_LAUNCH_SETTINGS_SET_METHOD
              ? await this.#launchSettings.set(
                  params.data.harnessId,
                  harnessLaunchSettingsSetSchema.parse(request.params).path,
                )
              : await this.#launchSettings.get(params.data.harnessId);
          await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        } catch {
          await this.#writer.json(
            rpcError(
              request,
              -32602,
              "Could not read or save launch settings. Use an existing absolute installation directory on this Host, without arguments, and check configuration permissions.",
            ),
          );
        }
      });
      return;
    }
    if (request.method === "codexhost/harness/plugins/list") {
      this.#dispatchDesktopReply(request, async () => {
        if (!harnessPluginListParamsSchema.safeParse(request.params).success) {
          await this.#writer.json(rpcError(request, -32602, "Invalid Harness plugin list params"));
          return;
        }
        await this.#waitForPlugins();
        const result = harnessPluginListResultSchema.parse({ plugins: this.#pluginDescriptors });
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      });
      return;
    }
    if (isSessionImportRequest(request.method)) {
      this.#dispatchDesktopReply(request, () => this.#handleSessionImport(request));
      return;
    }
    if (request.method === "codexhost/thread/fork") {
      await this.#forkExternalThreadFromRenderer(request);
      return;
    }
    if (request.method === "codexhost/thread/inspect") {
      await this.#inspectThread(request);
      return;
    }
    if (request.method === "codexhost/thread/usage/inspect") {
      await this.#inspectThreadUsage(request);
      return;
    }
    if (request.method === "codexhost/thread/ownership/list") {
      await this.#listThreadOwnership(request);
      return;
    }
    if (request.method === "codexhost/thread/steering/inspect") {
      await this.#inspectThreadSteering(request);
      return;
    }
    if (request.method === "codexhost/thread/model/select") {
      await this.#selectThreadModel(request);
      return;
    }
    if (request.method === "codexhost/thread/thinking/select") {
      await this.#selectThreadThinking(request);
      return;
    }
    if (request.method === "codexhost/thread/permission-mode/select") {
      await this.#selectThreadPermissionMode(request);
      return;
    }
    if (request.method === "codexhost/harness/commands/inspect") {
      const params = harnessCommandsInspectParamsSchema.safeParse(request.params);
      if (!params.success) {
        await this.#writer.json(
          rpcError(request, -32602, "Invalid Harness command inspection params"),
        );
      } else {
        await this.#writeHarnessCommandCatalog(request, params.data.harnessId, params.data.cwd);
      }
      return;
    }
    if (request.method === "codexhost/thread/commands/inspect") {
      await this.#inspectThreadCommands(request);
      return;
    }
    if (request.method === "codexhost/thread/command/execute") {
      await this.#executeThreadCommand(request);
      return;
    }
    if (request.method === "thread/list") {
      let listRequest: DecodedThreadListRequest;
      try {
        const decoded = decodeThreadListRequest(request);
        if (!decoded) throw new Error("Expected thread/list request");
        listRequest = decoded;
      } catch (error) {
        // Only a Host cursor makes the list Host-owned. Any other shape is native Codex's to judge.
        if (carriesHostThreadListCursor(request)) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
        } else {
          await this.#forwardOfficialRequest(request, frame);
        }
        return;
      }
      if (
        !listRequest.supportsExternal ||
        (listRequest.sortKey === "section_position" && typeof listRequest.sectionId !== "string")
      ) {
        await this.#forwardOfficialRequest(request, frame);
        return;
      }
      this.#dispatchDesktopReply(request, () =>
        listRequest.sortKey === "section_position"
          ? this.#listSectionThreads(request, frame, listRequest)
          : this.#listThreads(request, listRequest),
      );
      return;
    }
    if (request.method === "thread/section/move") {
      let move: DecodedThreadSectionMoveRequest;
      try {
        const decoded = decodeThreadSectionMoveRequest(request);
        if (!decoded) throw new Error("Expected thread/section/move request");
        move = decoded;
      } catch (error) {
        // Either Thread may be External: the moved one or the one it is placed before.
        const params = routingParams(request);
        let external = false;
        for (const threadId of [params.threadId, params.beforeThreadId]) {
          if (typeof threadId !== "string") continue;
          const location = await this.#locateExternalThread(threadId);
          if (await this.#writeResolutionError(request, location)) return;
          if (location.kind === "external") external = true;
        }
        if (external) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
        } else {
          await this.#forwardOfficialRequest(request, frame);
        }
        return;
      }
      // Moves read and rewrite one shared order, so they apply one at a time.
      const task = this.#sectionMoves.then(() => this.#moveThreadSection(request, frame, move));
      this.#sectionMoves = task.catch(() => undefined);
      this.#dispatchDesktopReply(request, () => task);
      return;
    }
    if (request.method === "thread/archive" || request.method === "thread/unarchive") {
      const threadId = routingParams(request).threadId;
      const location =
        typeof threadId === "string"
          ? await this.#locateExternalThread(threadId)
          : ({ kind: "official" } as const);
      if (await this.#writeResolutionError(request, location)) return;
      if (location.kind === "official") {
        await this.#forwardOfficialRequest(request, frame);
        return;
      }
      if (location.kind === "external") {
        try {
          if (!decodeThreadArchiveRequest(request)) {
            throw new Error(`Expected ${request.method} request`);
          }
        } catch (error) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
          return;
        }
        await this.#setExternalThreadArchived(
          request,
          location,
          request.method === "thread/archive",
        );
      }
      return;
    }
    if (request.method === "thread/metadata/update") {
      const threadId = routingParams(request).threadId;
      const location =
        typeof threadId === "string"
          ? await this.#locateExternalThread(threadId)
          : ({ kind: "official" } as const);
      if (await this.#writeResolutionError(request, location)) return;
      if (location.kind === "official") {
        await this.#forwardOfficialRequest(request, frame);
        return;
      }
      if (location.kind === "external") {
        let update: DecodedThreadMetadataUpdateRequest;
        try {
          const decoded = decodeThreadMetadataUpdateRequest(request);
          if (!decoded) throw new Error("Expected thread/metadata/update request");
          update = decoded;
        } catch (error) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
          return;
        }
        await this.#updateExternalThreadMetadata(request, location, update);
      }
      return;
    }
    let createRoute: CreateRequestRouteObservation | null;
    try {
      createRoute = classifyCreateRequestRoute(request);
    } catch (error) {
      await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
      return;
    }
    if (createRoute) {
      this.#options.onCreateRequestRoute?.(createRoute);
      this.#options.onRequestRoute?.(
        this.#routeObservationTracker.registerCreate(
          request.id,
          createRoute,
          classifyThreadPurpose(request),
        ),
      );
    }
    if (createRoute && createRoute.selectedHarness !== "codex") {
      await this.#startExternalThread(request, createRoute.selectedHarness);
      return;
    }
    if (request.method === "thread/fork") {
      const params = isRecord(request.params) ? request.params : {};
      const resolution =
        typeof params.threadId === "string"
          ? await this.#resolveExternalThread(params.threadId)
          : ({ kind: "official" } as const);
      if (resolution.kind === "error") {
        await this.#writer.json(rpcError(request, resolution.error.code, resolution.error.message));
        return;
      }
      if (resolution.kind === "external") {
        let fork: DecodedThreadForkRequest;
        try {
          const decoded = decodeThreadForkRequest(request);
          if (!decoded) throw new Error("Expected thread/fork request");
          fork = decoded;
        } catch (error) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
          return;
        }
        await this.#forkExternalThread(request, resolution.thread, fork);
        return;
      }
    }
    if (request.method === "thread/revert") {
      const params = isRecord(request.params) ? request.params : {};
      const resolution =
        typeof params.threadId === "string"
          ? await this.#resolveExternalThread(params.threadId)
          : ({ kind: "official" } as const);
      if (resolution.kind === "error") {
        await this.#writer.json(rpcError(request, resolution.error.code, resolution.error.message));
        return;
      }
      if (resolution.kind === "external") {
        let revert: DecodedThreadRevertRequest;
        try {
          const decoded = decodeThreadRevertRequest(request);
          if (!decoded) throw new Error("Expected thread/revert request");
          revert = decoded;
        } catch (error) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
          return;
        }
        await this.#revertExternalThread(request, resolution.thread, revert);
        return;
      }
    }
    if (request.method === "thread/rollback") {
      const params = isRecord(request.params) ? request.params : {};
      const resolution =
        typeof params.threadId === "string"
          ? await this.#resolveExternalThread(params.threadId)
          : ({ kind: "official" } as const);
      if (resolution.kind === "error") {
        await this.#writer.json(rpcError(request, resolution.error.code, resolution.error.message));
        return;
      }
      if (resolution.kind === "external") {
        let rollback: DecodedThreadRollbackRequest;
        try {
          const decoded = decodeThreadRollbackRequest(request);
          if (!decoded) throw new Error("Expected thread/rollback request");
          rollback = decoded;
        } catch (error) {
          await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
          return;
        }
        await this.#rollbackExternalThread(request, resolution.thread, rollback);
        return;
      }
    }
    if (request.method === "thread/turns/list" || request.method === "thread/items/list") {
      const params = routingParams(request);
      const resolution =
        typeof params.threadId === "string"
          ? await this.#resolveExternalThread(params.threadId)
          : ({ kind: "official" } as const);
      if (await this.#writeResolutionError(request, resolution)) return;
      if (resolution.kind === "external") {
        await this.#listExternalHistory(
          request,
          resolution.thread,
          params,
          resolution.historyFresh,
        );
        return;
      }
    }
    if (request.method === "turn/start") {
      const params = routingParams(request);
      const threadId = params.threadId;
      if (typeof threadId === "string") {
        this.#pendingOfficialTurnStarts.set(request.id, threadId);
        this.#gitWorkflow.forget(threadId);
      }
      const resolution =
        typeof threadId === "string"
          ? await this.#resolveExternalThread(threadId)
          : ({ kind: "official" } as const);
      if (typeof threadId === "string") {
        this.#options.onRequestRoute?.(
          this.#routeObservationTracker.observeTurn(
            threadId,
            resolution.kind === "external" ? resolution.thread.harnessId : "codex",
          ),
        );
      }
      if (await this.#writeResolutionError(request, resolution)) {
        this.#pendingOfficialTurnStarts.delete(request.id);
        return;
      }
      if (resolution.kind === "external") {
        this.#dispatchDesktopReply(
          request,
          async () => {
            try {
              await this.#startExternalTurn(request, resolution.thread);
            } finally {
              this.#pendingOfficialTurnStarts.delete(request.id);
              this.#signalActiveWorkChanged();
            }
          },
          resolution.thread.id,
        );
        return;
      }
      const buddy = this.#buddy;
      if (buddy) {
        this.#dispatchDesktopRequest(async () => {
          try {
            if (await buddy.route(request)) {
              if (typeof threadId === "string" && !buddy.activeThreadIds.includes(threadId)) {
                this.#pendingOfficialTurnStarts.delete(request.id);
              }
              return;
            }
            if (typeof threadId === "string") {
              this.#pendingOfficialTurnStarts.set(request.id, threadId);
            }
            await this.#forwardOfficialRequest(request, frame);
          } catch (error) {
            await this.#writer.json(rpcError(request, -32090, errorMessage(error)));
          } finally {
            this.#signalActiveWorkChanged();
          }
        });
        return;
      }
      if (typeof threadId === "string") {
        this.#pendingOfficialTurnStarts.set(request.id, threadId);
      }
    }
    if (request.method === "turn/steer") {
      const params = routingParams(request);
      const resolution =
        typeof params.threadId === "string"
          ? await this.#resolveExternalThread(params.threadId)
          : ({ kind: "official" } as const);
      if (await this.#writeResolutionError(request, resolution)) return;
      if (resolution.kind === "external") {
        this.#dispatchDesktopReply(
          request,
          () => this.#steerExternalTurn(request, resolution.thread),
          resolution.thread.id,
        );
        return;
      }
    }
    if (request.method === "turn/interrupt") {
      const params = routingParams(request);
      if (typeof params.threadId === "string") {
        this.#buddy?.cancel(params.threadId);
      }
      const resolution =
        typeof params.threadId === "string"
          ? await this.#resolveExternalThread(params.threadId)
          : ({ kind: "official" } as const);
      if (await this.#writeResolutionError(request, resolution)) return;
      if (resolution.kind === "external") {
        await this.#interruptExternalTurn(request, resolution.thread, params.turnId);
        return;
      }
    }
    if (request.method === "thread/read") {
      const params = routingParams(request);
      const location =
        typeof params.threadId === "string"
          ? await this.#locateExternalThread(params.threadId)
          : ({ kind: "official" } as const);
      if (location.kind === "error") {
        await this.#writer.json(rpcError(request, location.error.code, location.error.message));
        return;
      }
      if (location.kind === "official") {
        await this.#forwardOfficialRequest(request, frame);
        return;
      }
      if (params.includeTurns !== true) {
        await this.#readExternalThreadMetadata(request, location);
        return;
      }
      if (location.record.historyMode === "paginated") {
        await this.#writer.json(
          rpcError(request, -32602, "Paginated External Threads require thread/turns/list"),
        );
        return;
      }
    }
    if (request.method === "thread/read" || request.method === "thread/resume") {
      const params = routingParams(request);
      const resolution =
        typeof params.threadId === "string"
          ? await this.#resolveExternalThread(params.threadId)
          : ({ kind: "official" } as const);
      if (await this.#writeResolutionError(request, resolution)) return;
      if (resolution.kind === "external") {
        if (request.method === "thread/read") {
          await this.#readExternalThread(
            request,
            resolution.thread,
            params.includeTurns === true,
            resolution.historyFresh,
          );
        } else {
          await this.#resumeExternalThread(
            request,
            resolution.thread,
            params,
            resolution.historyFresh,
          );
        }
        return;
      }
    }
    if (request.method === "thread/unsubscribe") {
      const params = routingParams(request);
      if (typeof params.threadId === "string") {
        const location = await this.#locateExternalThread(params.threadId);
        if (await this.#writeResolutionError(request, location)) return;
        if (location.kind === "official") {
          await this.#forwardOfficialRequest(request, frame);
          return;
        }
        if (location.kind === "external") {
          await this.#writer.json(
            rpcEnvelope(request, {
              result: { status: location.thread ? "notSubscribed" : "notLoaded" },
            }),
          );
          return;
        }
      }
    }
    if (request.method === "thread/name/set" || request.method === "thread/delete") {
      const params = routingParams(request);
      const location =
        typeof params.threadId === "string"
          ? await this.#locateExternalThread(params.threadId)
          : ({ kind: "official" } as const);
      if (await this.#writeResolutionError(request, location)) return;
      if (location.kind === "external") {
        if (request.method === "thread/name/set") {
          await this.#setExternalThreadName(request, location, params.name);
        } else {
          await this.#deleteExternalThread(request, location);
        }
        return;
      }
    }
    if (
      request.method === "thread/backgroundTerminals/clean" &&
      isRecord(request.params) &&
      typeof request.params.threadId === "string"
    ) {
      const location = await this.#locateExternalThread(request.params.threadId);
      if (await this.#writeResolutionError(request, location)) return;
      if (location.kind === "external") {
        await this.#cleanExternalBackgroundTerminals(request, request.params.threadId);
        return;
      }
    }
    if (
      request.method.startsWith("thread/") &&
      !EXPLICIT_EXTERNAL_THREAD_METHODS.has(request.method) &&
      isRecord(request.params) &&
      typeof request.params.threadId === "string"
    ) {
      const location = await this.#locateExternalThread(request.params.threadId);
      if (await this.#writeResolutionError(request, location)) return;
      if (location.kind === "external") {
        const emptyResult = externalThreadEmptyOfficialResult(request.method);
        await this.#writer.json(
          emptyResult
            ? rpcEnvelope(request, { result: emptyResult })
            : rpcError(request, -32076, `External Thread does not support ${request.method}`),
        );
        return;
      }
    }
    await this.#forwardOfficialRequest(
      request,
      await this.#rewriteOfficialDelegationMentions(request, frame),
    );
  }

  /** Native Codex Turns: turn `#` delegation chips into an explicit Skill-backed request. */
  async #rewriteOfficialDelegationMentions(
    request: JsonRpcRequest,
    frame: Buffer<ArrayBufferLike>,
  ): Promise<Buffer<ArrayBufferLike>> {
    if (request.method !== "turn/start" && request.method !== "turn/steer") return frame;
    if (!isRecord(request.params) || !Array.isArray(request.params.input)) return frame;
    const input = request.params.input as JsonValue[];
    if (
      !input.some(
        (item) =>
          isRecord(item) &&
          typeof item.text === "string" &&
          item.text.includes(DELEGATION_MENTION_PATH_PREFIX),
      )
    ) {
      return frame;
    }
    const rewritten = rewriteDelegationMentionInput(input, await managedDelegationSkillReference());
    if (!rewritten) return frame;
    return encodeJsonFrame({
      ...(request as unknown as JsonObject),
      params: { ...(request.params as JsonObject), input: rewritten },
    });
  }

  async #forwardOfficialNonRequest(
    value: JsonValue,
    frame: Buffer<ArrayBufferLike>,
  ): Promise<void> {
    if (await this.#buddy?.privateMode()) {
      return;
    }
    if (this.#options.externalOnly) return;
    const response = isRecord(value) ? value : null;
    const request =
      response && (typeof response.id === "string" || typeof response.id === "number")
        ? this.#officialServerRequests.get(response.id)
        : null;
    if (request !== undefined && response) {
      this.#officialServerRequests.delete(response.id as JsonRpcId);
      await this.#officialRuntime.send({
        ...response,
        id: request,
      });
      return;
    }
    await this.#officialRuntime.sendFrame(frame);
  }

  #withoutPrivateTurnMarker(
    request: JsonRpcRequest,
    params: Record<string, unknown>,
  ): JsonRpcRequest {
    const sanitized = Object.fromEntries(
      Object.entries(params).filter(([key]) => key !== BUDDY_PRIVATE_TURN_MARKER),
    ) as JsonObject;
    const forwarded: JsonRpcRequest = {
      id: request.id,
      method: request.method,
      params: sanitized,
    };
    if (request.jsonrpc) {
      forwarded.jsonrpc = request.jsonrpc;
    }
    return forwarded;
  }

  async #forwardOfficialRequest(
    request: JsonRpcRequest,
    frame: Buffer<ArrayBufferLike>,
  ): Promise<void> {
    if (this.#options.externalOnly) {
      await this.#writer.json(
        rpcError(request, -32601, "Shared Thread service only handles external Harness Threads"),
      );
      return;
    }
    try {
      if (
        (await this.#buddy?.privateMode()) &&
        !privacySafeRequest(request.method, request.params)
      ) {
        throw new Error("隐私模式禁止普通发送。");
      }
      if (request.method === "config/value/write" || request.method === "config/batchWrite") {
        const params = isRecord(request.params) ? request.params : {};
        const edits = Array.isArray(params.edits) ? params.edits : [params];
        if (
          edits.some(
            (edit) =>
              isRecord(edit) &&
              typeof edit.keyPath === "string" &&
              /^(?:model_provider|model_providers|model_catalog_json|profile|profiles)(?:\.|$)/u.test(
                edit.keyPath,
              ),
          )
        ) {
          this.#liveCodexModels = undefined;
          this.#modelCatalogGeneration++;
        }
      }
      this.#buddy?.track(request);
      // Optional plugin-owned notification subscription options. Never wait for plugin startup
      // here: enhancement must not delay native commands or interrupt handling.
      const options = isRecord(request.params)
        ? this.#observedSessionUsage.requestOptions(request.method, request.params)
        : null;
      if (options) {
        const original = parseJsonFrame(frame);
        if (isRecord(original))
          frame = encodeJsonFrame({
            ...original,
            params: { ...(isRecord(original.params) ? original.params : {}), ...options },
          });
      }
      await this.#officialRuntime.sendFrame(frame);
      this.#markDesktopRequestAnswered(request.id);
    } catch {
      if (request.method === "turn/start") {
        this.#pendingOfficialTurnStarts.delete(request.id);
        this.#signalActiveWorkChanged();
      }
      await this.#writer.json(
        rpcError(request, -32001, "Official request failed; retry explicitly"),
      );
    }
  }

  async #handleOfficialOutput(input: {
    accountId: string;
    frame: Buffer<ArrayBufferLike>;
    value: JsonValue;
  }): Promise<void> {
    if (this.#options.externalOnly) {
      // Native children created through Delegation still have a native owner
      // and lifecycle. Their rendering stays on the GUI's native connection.
      await this.#observeOfficialTurnLifecycle(input.value);
      return;
    }
    const parsed = input.value;
    if (this.#buddy?.observe(parsed)) {
      this.#signalActiveWorkChanged();
      return;
    }
    const observedAtMs = Date.now();
    this.#observeOfficialTurnStartResponse(parsed);
    let forwarded: JsonValue = parsed;
    if (isRecord(parsed) && typeof parsed.method === "string" && "id" in parsed) {
      const originalId = parsed.id;
      if (typeof originalId === "string" || typeof originalId === "number") {
        const forwardedId = `codexhost:official:${++this.#nextOfficialServerRequestId}`;
        this.#officialServerRequests.set(forwardedId, originalId);
        forwarded = { ...parsed, id: forwardedId };
      }
    }
    const accountScopedNotification =
      isRecord(parsed) &&
      typeof parsed.method === "string" &&
      (parsed.method === "account/updated" || parsed.method.startsWith("account/rateLimits/"));
    if (accountScopedNotification) {
      if (parsed.method === "account/updated") {
        this.#officialRateLimits.reset(input.accountId);
        this.#liveCodexModels = undefined;
        this.#modelCatalogGeneration++;
      }
    }
    const rateLimits = observeCodexRateLimits(parsed);
    if (rateLimits) this.#officialRateLimits.observe(input.accountId, rateLimits);
    // Owner already rejects retired generations.
    try {
      await this.#observeOfficialTurnLifecycle(parsed);
    } catch (error) {
      this.#diagnose(error);
    }
    this.#routeObservationTracker.bindOfficialResponse(parsed);
    const privateTelemetry =
      isRecord(parsed) &&
      typeof parsed.method === "string" &&
      !("id" in parsed) &&
      !this.#observedSessionUsage.shouldForwardNotification(parsed);
    if (!privateTelemetry) {
      if (forwarded === parsed) await this.#writer.frame(input.frame);
      else await this.#writer.json(forwarded);
    }
    // Plugin startup and history I/O must never delay the official protocol. Promise
    // callbacks preserve observation order and the original receipt timestamps.
    void (this.#usagePluginsReady ?? Promise.resolve())
      .then(async () => {
        for (const threadId of this.#observedSessionUsage.observe(parsed, observedAtMs)) {
          await this.#writer.json({ method: THREAD_USAGE_UPDATED_METHOD, params: { threadId } });
        }
      })
      .catch((error: unknown) => this.#diagnose(error));
    this.#nativeAccountObserver?.observe(parsed);
    const deletedProjectId = observeDeletedProject(parsed);
    if (deletedProjectId) {
      await this.#clearDeletedProjectAssignments(deletedProjectId).catch((error: unknown) =>
        this.#diagnose(error),
      );
    }
  }

  async #syncLiveModelCatalog(): Promise<BuddyCatalogSync> {
    const generation = this.#modelCatalogGeneration;
    const synced = await syncCodexCatalog(this.#options.environment ?? process.env);
    const configuration = await this.#requestOfficial("config/read", { includeLayers: false });
    const configResult = isRecord(configuration.result) ? configuration.result : null;
    const config = configResult && isRecord(configResult.config) ? configResult.config : null;
    const provider = config?.model_provider ?? "openai";
    if (!config || provider === "openai" || provider !== synced.report.provider) {
      throw new Error("模型目录已同步，但与当前运行的自定义 Provider 不一致，未应用热更新。");
    }
    // 原生检查管理策略、Provider 和认证状态；热目录不能绕过这些检查。
    const native = await this.#officialRuntime.request("model/list", { limit: 1 });
    if (native.error !== undefined) {
      throw new Error("原生模型目录校验失败，未应用热更新；请检查 Provider 或认证状态。");
    }
    const catalog = new LiveModelCatalog(synced.catalog);
    const privateMode = await this.#buddy?.privateMode();
    if (generation !== this.#modelCatalogGeneration || privateMode) {
      throw new Error("刷新期间 Provider、认证或隐私设置已改变，请重新刷新模型。");
    }
    // 只在同步、Provider 校验和目录解析全部成功后替换；失败保留上一份可用目录。
    this.#liveCodexModels = catalog;
    return { ...synced.report, ids: catalog.visibleIds };
  }

  async #requestOfficial(method: string, params: JsonObject): Promise<JsonObject> {
    if ((await this.#buddy?.privateMode()) && !privacySafeRequest(method, params)) {
      throw new Error("隐私模式禁止后台模型任务。");
    }
    if (method === "model/list" && this.#liveCodexModels) {
      const catalog = this.#liveCodexModels;
      // 仅目录数据来自同步快照；每次查询仍保留原生的可用性和管理策略检查。
      const response = await this.#officialRuntime.request(method, { limit: 1 });
      if (response.error !== undefined) return response;
      if (catalog !== this.#liveCodexModels) {
        throw new Error("模型目录或 Provider 已变化，请重新读取模型列表。");
      }
      return { ...response, result: catalog.list(params) };
    }
    if (this.#options.externalOnly) {
      // Project and section metadata remain owned by native Codex. This
      // private client negotiates its own connection, never a GUI's session.
      await this.#officialRuntime.initializeProtocol({
        clientInfo: { name: "codexhost-shared-threads", version: "1" },
        capabilities: { experimentalApi: true },
      });
    }
    return this.#officialRuntime.request(method, params);
  }

  async #listAutoArchiveOfficial(
    cutoffSeconds: number,
  ): Promise<Array<{ threadId: string; recencyAt: number }>> {
    const candidates: Array<{ threadId: string; recencyAt: number }> = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const response = await this.#requestOfficial("thread/list", {
        limit: 100,
        archived: false,
        sortKey: "recency_at",
        sortDirection: "asc",
        ...(cursor ? { cursor } : {}),
      });
      if (isRecord(response.error)) {
        throw new Error(String(response.error.message ?? "Official Thread list failed"));
      }
      const page = isRecord(response.result) ? response.result : null;
      const data = page && Array.isArray(page.data) ? page.data : null;
      if (!page || !data) throw new Error("Official Thread list response is invalid");
      let exhausted = false;
      for (const entry of data) {
        if (!isRecord(entry) || typeof entry.id !== "string") continue;
        const recencyAt = entry.recencyAt ?? entry.updatedAt;
        if (typeof recencyAt !== "number" || !Number.isSafeInteger(recencyAt)) continue;
        if (recencyAt >= cutoffSeconds) {
          exhausted = true;
          break;
        }
        if (isRecord(entry.status) && entry.status.type === "active") continue;
        candidates.push({ threadId: entry.id, recencyAt });
      }
      if (exhausted) break;
      const next = typeof page.nextCursor === "string" ? page.nextCursor : null;
      if (next && seenCursors.has(next)) throw new Error("Official Thread list cursor repeated");
      if (next) seenCursors.add(next);
      cursor = next;
    } while (cursor);
    return candidates;
  }

  async #listAutoArchiveExternal(
    cutoffSeconds: number,
  ): Promise<Array<{ threadId: string; recencyAt: number }>> {
    return (await this.#repository.list()).flatMap((record) => {
      if (
        record.archived ||
        record.state !== "ready" ||
        !record.nativeSessionRef ||
        record.subagent ||
        record.ephemeral
      )
        return [];
      const parsed = Math.floor(Date.parse(record.updatedAt) / 1_000);
      const loaded = this.#externalRuntime.get(record.hostThreadId);
      const recencyAt = Math.max(
        parsed,
        loaded
          ? Math.floor((this.#externalRuntime.idleRelease.lastActivityAt(loaded) ?? 0) / 1_000)
          : 0,
      );
      return recencyAt < cutoffSeconds ? [{ threadId: record.hostThreadId, recencyAt }] : [];
    });
  }

  async #canAutoArchiveOfficial(threadId: string, cutoffSeconds: number): Promise<boolean> {
    if (
      this.#activeOfficialTurns.has(threadId) ||
      [...this.#pendingOfficialTurnStarts.values()].includes(threadId)
    ) {
      return false;
    }
    const response = await this.#requestOfficial("thread/read", {
      threadId,
      includeTurns: true,
    });
    if (isRecord(response.error)) return false;
    const result = isRecord(response.result) ? response.result : null;
    const thread = result && isRecord(result.thread) ? result.thread : null;
    if (
      !thread ||
      thread.id !== threadId ||
      (isRecord(thread.status) && thread.status.type === "active")
    ) {
      return false;
    }
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    if (turns.some((turn) => isRecord(turn) && turn.status === "inProgress")) return false;
    const recencyAt = thread.recencyAt ?? thread.updatedAt;
    return (
      typeof recencyAt === "number" && Number.isSafeInteger(recencyAt) && recencyAt < cutoffSeconds
    );
  }

  async #canAutoArchiveExternal(threadId: string, cutoffSeconds: number): Promise<boolean> {
    const record = await this.#repository.find(threadId);
    if (
      !record ||
      record.archived ||
      record.state !== "ready" ||
      !record.nativeSessionRef ||
      record.subagent ||
      record.ephemeral
    )
      return false;
    const loaded = this.#externalRuntime.get(threadId);
    if (loaded) {
      if (
        loaded.running ||
        loaded.activeTurnId ||
        loaded.persistenceError ||
        this.#pendingExternalCommandRequests.has(threadId) ||
        this.#externalSteering.hasPending(threadId) ||
        this.#hasRunningSubagents(threadId)
      )
        return false;
    }
    const recencyAt = Math.max(
      Math.floor(Date.parse(record.updatedAt) / 1_000),
      loaded
        ? Math.floor((this.#externalRuntime.idleRelease.lastActivityAt(loaded) ?? 0) / 1_000)
        : 0,
    );
    return recencyAt < cutoffSeconds;
  }

  async #handleSessionRoute(request: JsonRpcRequest): Promise<void> {
    try {
      sessionRouteParamsSchema.parse(request.params);
      const sessions = await recentCompletedSessions((method, params) =>
        this.#requestOfficial(method, params),
      );
      const result = sessionRouteResultSchema.parse(sessions);
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32090, errorMessage(error).slice(0, 20_000)));
    }
  }

  #inspectHarnessAccount(
    adapter: HarnessAdapter,
    refresh = false,
  ): Promise<HarnessAccountInspectResult> {
    return this.#accountInspections.inspect(adapter, this.#pluginDescriptors, refresh);
  }

  async #currentCodexAccountId(): Promise<string | null> {
    return this.#accountControl.currentAccountId();
  }

  async #codexAccountSnapshot() {
    return this.#accountControl.refresh?.() ?? this.#accountControl.snapshot();
  }

  async #handleCodexAccountRequest(request: JsonRpcRequest): Promise<void> {
    try {
      if (request.method === "codexhost/account/usage/inspect") {
        const { accountId, refresh } = codexAccountUsageParamsSchema.parse(requestObject(request));
        if (accountId !== (await this.#currentCodexAccountId()))
          throw new Error("Unknown Codex Account");
        const observation = await this.#refreshOfficialRateLimits(accountId, refresh === true);
        const usage = this.#officialRateLimits.get(accountId);
        const accountCredits = this.#officialAccountCredits(accountId);
        const result = codexAccountUsageResultSchema.parse({
          accountId,
          usage,
          ...(accountCredits ? { accountCredits } : {}),
          freshness: observation.status === "live" ? ("live" as const) : ("cached" as const),
          observedAt: observation.observedAt,
        });
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }
      await this.#writer.json(
        rpcEnvelope(request, {
          result: jsonValueSchema.parse(await this.#codexAccountSnapshot()),
        }),
      );
    } catch (error) {
      const failure = codexAccountRpcError(error);
      await this.#writer.json(rpcError(request, failure.code, failure.message));
    }
  }

  async #observeOfficialTurnLifecycle(value: JsonValue): Promise<void> {
    if (!isRecord(value) || !isRecord(value.params)) return;
    const params = value.params;
    if (value.method === "turn/started" && typeof params.threadId === "string") {
      const turn = isRecord(params.turn) ? params.turn : null;
      if (turn && typeof turn.id === "string") {
        this.#forgetPendingOfficialTurnStarts(params.threadId);
        this.#activeOfficialTurns.set(params.threadId, turn.id);
      }
    }
    if (value.method === "turn/completed" && typeof params.threadId === "string") {
      this.#forgetPendingOfficialTurnStarts(params.threadId);
      this.#activeOfficialTurns.delete(params.threadId);
      const turn = isRecord(params.turn) ? params.turn : null;
      const status =
        turn?.status === "failed"
          ? "failed"
          : turn?.status === "interrupted" || turn?.status === "cancelled"
            ? "interrupted"
            : "completed";
      if (turn && typeof turn.id === "string") {
        const threadId = params.threadId;
        const turnId = turn.id;
        void this.#turnActions
          .completed(threadId, turnId, status)
          .then((suppressAutoPush) =>
            suppressAutoPush ? undefined : this.#gitWorkflow.completed(threadId, turnId, status),
          )
          .catch((error) => this.#diagnose(error));
      }
      this.#signalActiveWorkChanged();
      const delegation = await this.#repository.getDelegationByChild(
        hostThreadIdSchema.parse(params.threadId),
      );
      if (this.#pendingOfficialDelegationThreads.has(params.threadId)) {
        this.#pendingOfficialTerminalStatuses.set(params.threadId, status);
      }
      if (delegation) {
        await this.#repository.setDelegationStatus(delegation.delegationId, status);
      }
    }
  }

  async #canHandleDelegationStart(input: DelegationStartInput): Promise<boolean> {
    if (input.parentThreadId) return this.#ownsDelegationThread(input.parentThreadId);
    const externalActive = this.#externalRuntime.values().some((thread) => thread.running);
    return externalActive || this.#activeOfficialTurns.size > 0;
  }

  async #ownsDelegationThread(threadId: string): Promise<boolean> {
    if (await this.#options.sharedDelegation?.ownsThread(threadId)) return false;
    if (
      this.#options.sharedThreads?.options.delegateCreates &&
      (await this.#options.sharedThreads.ownership([threadId])).has(threadId)
    )
      return false;
    if (
      this.#externalRuntime.get(threadId) !== undefined ||
      this.#activeOfficialTurns.has(threadId)
    ) {
      return true;
    }
    const parsed = hostThreadIdSchema.safeParse(threadId);
    if (!parsed.success) return false;
    const [thread, childDelegation, delegation] = await Promise.all([
      this.#repository.find(parsed.data),
      this.#repository.getDelegationByChild(parsed.data),
      this.#repository.getDelegation(parsed.data),
    ]);
    return thread !== null || childDelegation !== null || delegation !== null;
  }

  async #readOfficialThreadMetadata(threadId: string): Promise<{ cwd?: string; title?: string }> {
    const response = await this.#requestOfficial("thread/read", { threadId, includeTurns: false });
    if (isRecord(response.error)) return {};
    const result = isRecord(response.result) ? response.result : null;
    const thread = result && isRecord(result.thread) ? result.thread : null;
    if (!thread) return {};
    const title =
      typeof thread.name === "string" && thread.name.trim() ? thread.name : thread.preview;
    return {
      ...(typeof thread.cwd === "string" && thread.cwd.trim() ? { cwd: thread.cwd } : {}),
      ...(typeof title === "string" && title.trim() ? { title } : {}),
    };
  }

  async #inspectOfficialDelegationTarget(
    input: HarnessInspectInput,
  ): Promise<HarnessInspectResult> {
    const response = await this.#requestOfficial("model/list", {});
    if (isRecord(response.error)) {
      throw new DelegationControlError(
        "DELEGATION_FAILED",
        typeof response.error.message === "string"
          ? response.error.message
          : "Official Model catalog could not be read",
      );
    }
    const result = isRecord(response.result) ? response.result : null;
    const data = result && Array.isArray(result.data) ? result.data : [];
    const thinkingById = new Map<ReturnType<typeof harnessThinkingOptionIdSchema.parse>, string>();
    const models = data.flatMap((candidate) => {
      if (!isRecord(candidate) || typeof candidate.model !== "string" || !candidate.model.trim()) {
        return [];
      }
      const supportedThinkingOptionIds = Array.isArray(candidate.supportedReasoningEfforts)
        ? candidate.supportedReasoningEfforts.flatMap((option) => {
            if (
              !isRecord(option) ||
              typeof option.reasoningEffort !== "string" ||
              !option.reasoningEffort.trim()
            ) {
              return [];
            }
            const id = harnessThinkingOptionIdSchema.safeParse(option.reasoningEffort);
            if (!id.success) return [];
            thinkingById.set(
              id.data,
              typeof option.description === "string" && option.description.trim()
                ? option.description
                : option.reasoningEffort,
            );
            return [id.data];
          })
        : [];
      return [
        {
          ref: encodeOfficialCodexModelRef(candidate.model),
          label:
            typeof candidate.displayName === "string" && candidate.displayName.trim()
              ? candidate.displayName
              : candidate.model,
          ...(supportedThinkingOptionIds.length > 0 ? { supportedThinkingOptionIds } : {}),
        },
      ];
    });
    const defaultEntry = data.find(
      (candidate) => isRecord(candidate) && candidate.isDefault === true,
    );
    const defaultModel =
      isRecord(defaultEntry) && typeof defaultEntry.model === "string"
        ? encodeOfficialCodexModelRef(defaultEntry.model)
        : undefined;
    return {
      harnessId: input.harnessId,
      inspection: {
        status: "ready",
        catalog: {
          models,
          ...(defaultModel ? { defaultModel } : {}),
          thinkingOptions: [...thinkingById].map(([id, label]) => ({ id, label })),
        },
        capabilities: {
          configuration: {
            selectModel: models.length > 0,
            selectThinkingOption: thinkingById.size > 0,
            selectPermissionMode: false,
            permissionModeScope: "live",
          },
          history: { fork: true, forkAcrossCwd: true, rollbackLastTurn: true },
        },
      },
    };
  }

  async #startOfficialDelegation(
    input: DelegationStartInput & { parentThreadId: string; cwd: string; title: string },
  ): Promise<DelegationStartResult> {
    let requestedModel: HarnessModelRef | undefined;
    try {
      requestedModel = input.model ? canonicalizeOfficialCodexModelRef(input.model) : undefined;
    } catch {
      throw new DelegationControlError("INVALID_ARGUMENT", "Official Model Ref is invalid");
    }
    const nativeModelId = requestedModel ? decodeOfficialCodexModelRef(requestedModel) : undefined;
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          task: input.task,
          cwd: input.cwd,
          modelId: requestedModel?.id ?? null,
          thinkingOptionId: input.thinkingOptionId ?? null,
        }),
      )
      .digest("hex");
    const existing = input.requestId
      ? await this.#repository.findDelegationByRequest(input.requestId)
      : await this.#repository.findRecentDelegation({
          parentHostThreadId: hostThreadIdSchema.parse(input.parentThreadId),
          targetHarnessId: harnessIdSchema.parse("codex"),
          taskDigest: digest,
          since: new Date(Date.now() - 30_000),
        });
    if (
      existing &&
      input.requestId &&
      (existing.targetHarnessId !== "codex" || existing.taskDigest !== digest)
    ) {
      throw new DelegationControlError(
        "INVALID_ARGUMENT",
        "Request ID is already associated with another Delegation configuration",
      );
    }
    if (existing) {
      const turnId = this.#activeOfficialTurns.get(existing.childHostThreadId) ?? "pending";
      return {
        delegationId: existing.delegationId,
        threadId: existing.childHostThreadId,
        turnId,
        harnessId: "codex",
        deepLink: `codex://threads/${existing.childHostThreadId}`,
        status: existing.status,
        next: {
          read: `codexhost thread read ${existing.childHostThreadId}`,
          wait: `codexhost thread wait ${existing.childHostThreadId} --timeout-ms 30000`,
        },
      };
    }
    if (requestedModel || input.thinkingOptionId) {
      const inspected = await this.#inspectOfficialDelegationTarget({
        harnessId: "codex",
        cwd: input.cwd,
      });
      if (inspected.inspection.status !== "ready") {
        throw new DelegationControlError(
          "DELEGATION_FAILED",
          "Official Model catalog is unavailable",
        );
      }
      if (
        requestedModel &&
        !inspected.inspection.catalog.models.some(
          (candidate) => candidate.ref.id === requestedModel.id,
        )
      ) {
        throw new DelegationControlError("INVALID_ARGUMENT", "Official Model is unavailable", {
          validModelIds: inspected.inspection.catalog.models.map((candidate) => candidate.ref.id),
        });
      }
      if (input.thinkingOptionId) {
        const selectedModel = requestedModel ?? inspected.inspection.catalog.defaultModel;
        const selectedEntry = selectedModel
          ? inspected.inspection.catalog.models.find(
              (candidate) => candidate.ref.id === selectedModel.id,
            )
          : undefined;
        const validThinkingOptionIds = selectedEntry?.supportedThinkingOptionIds ?? [];
        if (!validThinkingOptionIds.includes(input.thinkingOptionId)) {
          throw new DelegationControlError(
            "INVALID_ARGUMENT",
            "Official Thinking option is unavailable for the selected Model",
            { validThinkingOptionIds },
          );
        }
      }
    }
    const started = await this.#officialRuntime.request("thread/start", {
      cwd: input.cwd,
      ...(nativeModelId ? { model: nativeModelId } : {}),
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ephemeral: false,
      historyMode: "paginated",
    });
    const startedResult = isRecord(started.result) ? started.result : null;
    const thread = startedResult && isRecord(startedResult.thread) ? startedResult.thread : null;
    const threadId = thread && typeof thread.id === "string" ? thread.id : null;
    if (!threadId) throw new Error("Official thread/start returned no Thread identity");
    this.#pendingOfficialDelegationThreads.add(threadId);
    let turnId: string;
    try {
      // The title is presentation only: a failure keeps the default title and still delivers the task.
      await this.#requestOfficial("thread/name/set", { threadId, name: input.title }).catch(
        () => undefined,
      );
      const turn = await this.#requestOfficial("turn/start", {
        threadId,
        input: [{ type: "text", text: input.task }],
        ...(nativeModelId ? { model: nativeModelId } : {}),
        ...(input.thinkingOptionId ? { effort: input.thinkingOptionId } : {}),
      });
      const turnResult = isRecord(turn.result) ? turn.result : null;
      const turnValue = turnResult && isRecord(turnResult.turn) ? turnResult.turn : null;
      const parsedTurnId = turnValue && typeof turnValue.id === "string" ? turnValue.id : null;
      if (!parsedTurnId) throw new Error("Official turn/start returned no Turn identity");
      turnId = parsedTurnId;
    } catch (error) {
      this.#pendingOfficialDelegationThreads.delete(threadId);
      this.#pendingOfficialTerminalStatuses.delete(threadId);
      await this.#requestOfficial("thread/delete", { threadId }).catch(() => undefined);
      throw error;
    }
    this.#activeOfficialTurns.set(threadId, turnId);
    const delegationId = hostThreadIdSchema.parse(randomUUID());
    try {
      const source = await this.#repository.find(input.parentThreadId);
      const pendingTerminal = this.#pendingOfficialTerminalStatuses.get(threadId);
      await this.#repository.createDelegation({
        delegationId,
        parentHostThreadId: hostThreadIdSchema.parse(input.parentThreadId),
        childHostThreadId: hostThreadIdSchema.parse(threadId),
        sourceHarnessId: source?.harnessId ?? harnessIdSchema.parse("codex"),
        targetHarnessId: harnessIdSchema.parse("codex"),
        status: pendingTerminal ?? "running",
        ...(input.requestId ? { requestId: input.requestId } : {}),
        taskDigest: digest,
      });
      return {
        delegationId,
        threadId,
        turnId,
        harnessId: "codex",
        deepLink: `codex://threads/${threadId}`,
        status: pendingTerminal ?? "running",
        cwd: thread && typeof thread.cwd === "string" ? thread.cwd : input.cwd,
        ...(requestedModel || input.thinkingOptionId
          ? {
              configuration: {
                requested: {
                  ...(requestedModel ? { model: requestedModel } : {}),
                  ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}),
                },
                effective: {
                  ...(startedResult && typeof startedResult.model === "string"
                    ? { effectiveModel: encodeOfficialCodexModelRef(startedResult.model) }
                    : {}),
                },
              },
            }
          : {}),
        next: {
          read: `codexhost thread read ${threadId}`,
          wait: `codexhost thread wait ${threadId} --timeout-ms 30000`,
        },
      };
    } catch (error) {
      this.#activeOfficialTurns.delete(threadId);
      this.#signalActiveWorkChanged();
      await this.#requestOfficial("thread/delete", { threadId }).catch(() => undefined);
      throw error;
    } finally {
      this.#pendingOfficialDelegationThreads.delete(threadId);
      this.#pendingOfficialTerminalStatuses.delete(threadId);
    }
  }

  async #sendOfficialDelegationThread(input: ThreadSendInput): Promise<ThreadSendResult> {
    if (!input.message?.trim()) {
      throw new DelegationControlError("INVALID_ARGUMENT", "Message must not be empty");
    }
    if (this.#activeOfficialTurns.has(input.threadId)) {
      throw new DelegationControlError("THREAD_BUSY", "Thread already has an active Turn");
    }
    const current = await this.#requestOfficial("thread/read", {
      threadId: input.threadId,
      includeTurns: true,
    });
    if (isRecord(current.error)) throw officialThreadReadError(current.error);
    if (!isRecord(current.result)) {
      throw new DelegationControlError("INTERNAL_ERROR", "Official Thread read returned no result");
    }
    const currentThread = isRecord(current.result.thread) ? current.result.thread : null;
    if (officialThreadBusy(currentThread)) {
      throw new DelegationControlError("THREAD_BUSY", "Thread already has an active Turn");
    }
    // Read stays idle after unsubscribe and does not resubscribe. Resume does, and
    // excludeTurns keeps paginated history out of the response without replacing config.
    const resumed = await this.#requestOfficial("thread/resume", {
      threadId: input.threadId,
      excludeTurns: true,
    });
    if (isRecord(resumed.error) || !isRecord(resumed.result)) {
      throw new DelegationControlError(
        "DELEGATION_FAILED",
        isRecord(resumed.error) && typeof resumed.error.message === "string"
          ? resumed.error.message
          : "Official Thread resume failed",
        { notStarted: true },
      );
    }
    const resumedThread = isRecord(resumed.result.thread) ? resumed.result.thread : null;
    if (!resumedThread || resumedThread.id !== input.threadId) {
      throw new DelegationControlError(
        "DELEGATION_FAILED",
        "Official Thread resume did not return the requested Thread",
        { notStarted: true },
      );
    }
    if (officialThreadBusy(resumedThread)) {
      throw new DelegationControlError("THREAD_BUSY", "Thread already has an active Turn");
    }
    if (!isRecord(resumedThread.status) || resumedThread.status.type !== "idle") {
      throw new DelegationControlError(
        "DELEGATION_FAILED",
        "Official Thread is not idle after resume",
        { notStarted: true },
      );
    }
    const response = await this.#requestOfficial("turn/start", {
      threadId: input.threadId,
      input: [{ type: "text", text: input.message }],
    });
    if (isRecord(response.error)) {
      // app-server answered turn/start with an error, so no Turn was started.
      throw new DelegationControlError(
        "DELEGATION_FAILED",
        typeof response.error.message === "string" ? response.error.message : "Turn start failed",
        { notStarted: true },
      );
    }
    const result = isRecord(response.result) ? response.result : null;
    const turn = result && isRecord(result.turn) ? result.turn : null;
    const turnId = turn && typeof turn.id === "string" ? turn.id : null;
    if (!turnId) throw new Error("Official turn/start returned no Turn identity");
    this.#activeOfficialTurns.set(input.threadId, turnId);
    return {
      threadId: input.threadId,
      turnId,
      harnessId: "codex",
      status: "running",
      next: {
        read: `codexhost thread read ${input.threadId}`,
        wait: `codexhost thread wait ${input.threadId} --timeout-ms 30000`,
      },
    };
  }

  async #cancelOfficialDelegationThread(input: ThreadCancelInput): Promise<ThreadCancelResult> {
    let turnId = this.#activeOfficialTurns.get(input.threadId);
    if (!turnId) {
      const current = await this.#requestOfficial("thread/read", {
        threadId: input.threadId,
        includeTurns: true,
      });
      if (isRecord(current.error) || !isRecord(current.result)) {
        throw new DelegationControlError("THREAD_NOT_FOUND", "Official Thread was not found");
      }
      const currentThread = isRecord(current.result.thread) ? current.result.thread : null;
      const currentTurns =
        currentThread && Array.isArray(currentThread.turns) ? currentThread.turns : [];
      const latestTurn = currentTurns.at(-1);
      if (
        isRecord(latestTurn) &&
        typeof latestTurn.id === "string" &&
        (latestTurn.status === "inProgress" || latestTurn.status === "running")
      ) {
        turnId = latestTurn.id;
        this.#activeOfficialTurns.set(input.threadId, turnId);
      } else {
        return { threadId: input.threadId, turnId: null, harnessId: "codex", cancelled: false };
      }
    }
    const response = await this.#requestOfficial("turn/interrupt", {
      threadId: input.threadId,
      turnId,
    });
    if (isRecord(response.error)) {
      throw new DelegationControlError(
        "DELEGATION_FAILED",
        typeof response.error.message === "string" ? response.error.message : "Turn cancel failed",
      );
    }
    return { threadId: input.threadId, turnId, harnessId: "codex", cancelled: true };
  }

  async #readOfficialDelegationThread(input: ThreadReadInput): Promise<DelegationThreadSnapshot> {
    const response = await this.#requestOfficial("thread/read", {
      threadId: input.threadId,
      includeTurns: true,
    });
    if (isRecord(response.error)) throw officialThreadReadError(response.error);
    const result = isRecord(response.result) ? response.result : null;
    const thread = result && isRecord(result.thread) ? result.thread : null;
    if (!thread)
      throw new DelegationControlError("INTERNAL_ERROR", "Official Thread read returned no Thread");
    const turns = Array.isArray(thread.turns)
      ? thread.turns.filter((turn): turn is JsonObject => isRecord(turn))
      : [];
    const running =
      this.#activeOfficialTurns.has(input.threadId) ||
      (isRecord(thread.status) && thread.status.type === "active");
    const snapshot = projectDelegationThreadSnapshot({
      threadId: input.threadId,
      harnessId: "codex",
      thread,
      turns,
      running,
      view: input.view,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    });
    const delegation = await this.#repository.getDelegationByChild(
      hostThreadIdSchema.parse(input.threadId),
    );
    if (delegation && delegation.status !== snapshot.status) {
      await this.#repository.setDelegationStatus(delegation.delegationId, snapshot.status);
    }
    return snapshot;
  }

  async #listDelegationThreads(input: ThreadListInput): Promise<DelegationThreadListResult> {
    const [sortKey, sortDirection] = input.sort.split("-") as [string, "asc" | "desc"];
    const request: JsonRpcRequest = {
      id: `codexhost:delegation-list:${randomUUID()}`,
      method: "thread/list",
      params: {
        cwd: input.cwd ? [input.cwd] : null,
        limit: input.limit,
        cursor: input.cursor ?? null,
        sortKey: `${sortKey}_at`,
        sortDirection,
      },
    };
    const decoded = decodeThreadListRequest(request);
    if (!decoded) throw new Error("Delegation thread/list request could not be decoded");
    const records = await this.#repository.list();
    const result = await aggregateThreadList({
      query: decoded,
      records,
      runtimeFor: (threadId) => {
        const thread = this.#externalRuntime.get(threadId);
        return thread ? { running: thread.running } : null;
      },
      requestOfficialPage: async (params) =>
        officialThreadListPageFromResponse(await this.#requestOfficial("thread/list", params)),
    });
    return {
      threads: result.data.flatMap((entry) => {
        if (typeof entry.id !== "string") return [];
        const record = records.find((candidate) => candidate.hostThreadId === entry.id);
        const status =
          isRecord(entry.status) && entry.status.type === "active" ? "running" : "completed";
        return [
          {
            threadId: entry.id,
            harnessId: record ? (record.harnessId as ExternalHarnessId) : "codex",
            deepLink: `codex://threads/${entry.id}`,
            status,
            ...(typeof entry.cwd === "string" ? { cwd: entry.cwd } : {}),
            ...(typeof entry.name === "string"
              ? { title: entry.name }
              : typeof entry.preview === "string"
                ? { title: entry.preview }
                : {}),
          },
        ];
      }),
      nextCursor: result.nextCursor,
    };
  }

  async #listThreads(
    request: JsonRpcRequest,
    listRequest: DecodedThreadListRequest,
  ): Promise<void> {
    try {
      const [records, placements] = await Promise.all([
        this.#repository.list(),
        this.#repository.listSectionPlacements(),
      ]);
      const placementById = new Map(
        placements.map((entry) => [entry.hostThreadId as string, entry]),
      );
      const result = await aggregateThreadList({
        query: listRequest,
        records,
        ...(this.#options.sharedThreads
          ? {
              sharedThreads: await this.#options.sharedThreads.list(listRequest.params),
            }
          : {}),
        runtimeFor: (threadId) => this.#listRuntimeState(threadId),
        placementOf: (threadId) => placementById.get(threadId),
        requestOfficialPage: async (params) =>
          this.#options.externalOnly
            ? { data: [], nextCursor: null, backwardsCursor: null }
            : officialThreadListPageFromResponse(
                await this.#officialRuntime.request("thread/list", params),
              ),
      });
      await this.#writer.json(rpcEnvelope(request, { result }));
    } catch (error) {
      if (error instanceof OfficialThreadListError) {
        await this.#writer.json(rpcEnvelope(request, { error: error.rpcError }));
        return;
      }
      await this.#writer.json(rpcError(request, -32082, "Thread list aggregation failed"));
      this.#diagnose(error);
    }
  }

  #listRuntimeState(threadId: string): { running: boolean } | null {
    const subagentStatus = this.#subagentThreadStatuses.get(threadId);
    if (subagentStatus) return { running: subagentStatus === "active" };
    const thread = this.#externalRuntime.get(threadId);
    return thread ? { running: thread.running } : null;
  }

  /** `section_position` lists merge External section placements into the official order. */
  async #listSectionThreads(
    request: JsonRpcRequest,
    frame: Buffer<ArrayBufferLike>,
    query: DecodedThreadListRequest,
  ): Promise<void> {
    try {
      const [records, localPlacements, sharedPlacements, sharedThreads] = await Promise.all([
        this.#repository.list(),
        this.#repository.listSectionPlacements(),
        this.#options.sharedThreads?.placements() ?? [],
        this.#options.sharedThreads?.list(query.params) ?? [],
      ]);
      const sharedIds = new Set(sharedPlacements.map((p) => p.hostThreadId));
      const placements = [
        ...localPlacements.filter((p) => !sharedIds.has(p.hostThreadId)),
        ...sharedPlacements,
      ];
      const placementById = new Map(
        placements.map((entry) => [entry.hostThreadId as string, entry]),
      );
      const externalRows = new Map(
        externalThreadListEntries({
          records,
          query,
          runtimeFor: (threadId) => this.#listRuntimeState(threadId),
          placementOf: (threadId) => placementById.get(threadId),
        }).map((entry) => [String(entry.thread.id), entry.thread]),
      );
      const page = await listSectionThreads({
        query,
        placements,
        externalRows: new Map([
          ...externalRows,
          ...sharedThreads.map((thread) => [String(thread.id), thread] as const),
        ]),
        requestOfficial: (method, params) => this.#requestOfficial(method, params),
      });
      if (!page) {
        await this.#forwardOfficialRequest(request, frame);
        return;
      }
      await this.#writer.json(rpcEnvelope(request, { result: page }));
    } catch (error) {
      if (error instanceof OfficialThreadListError) {
        await this.#writer.json(rpcEnvelope(request, { error: error.rpcError }));
        return;
      }
      await this.#writer.json(rpcError(request, -32082, "Thread list aggregation failed"));
      this.#diagnose(error);
    }
  }

  async #moveThreadSection(
    request: JsonRpcRequest,
    frame: Buffer<ArrayBufferLike>,
    move: DecodedThreadSectionMoveRequest,
  ): Promise<void> {
    try {
      const location = await this.#locateExternalThread(move.threadId);
      if (await this.#writeResolutionError(request, location)) return;
      const [records, placements] = await Promise.all([
        this.#repository.list(),
        this.#repository.listSectionPlacements(),
      ]);
      const outcome = await moveThreadSection({
        move,
        movingExternal: location.kind === "external",
        externalThreadIds: new Set(records.map((record) => record.hostThreadId)),
        placements,
        requestOfficial: (method, params) => this.#requestOfficial(method, params),
        savePlacements: (next) => this.#repository.replaceSectionPlacements(next),
        now: new Date(),
      });
      if (outcome.kind === "moved" && outcome.persistError !== undefined)
        this.#diagnose(outcome.persistError);
      if (outcome.kind === "forward") await this.#forwardOfficialRequest(request, frame);
      else if (outcome.kind === "error")
        await this.#writer.json(rpcEnvelope(request, { error: outcome.error }));
      else await this.#writer.json(rpcEnvelope(request, { result: {} }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32081, "Thread section could not be moved"));
      this.#diagnose(error);
    }
  }

  async #externalSectionFields(threadId: string) {
    const placements = await this.#repository.listSectionPlacements();
    return threadSectionFields(placements.find((entry) => entry.hostThreadId === threadId));
  }

  /** Cached External Thread projections predate section moves; responses read the placement. */
  async #withExternalSection(thread: JsonObject): Promise<JsonObject> {
    return typeof thread.id === "string"
      ? { ...thread, ...(await this.#externalSectionFields(thread.id)) }
      : thread;
  }

  async #setExternalThreadArchived(
    request: JsonRpcRequest,
    location: Extract<ExternalThreadLocation, { kind: "external" }>,
    archived: boolean,
  ): Promise<void> {
    const updated = await this.#persistExternalThreadRecord(
      request,
      location,
      (hostThreadId) => this.#repository.setArchived(hostThreadId, archived),
      "External Thread archive state could not be persisted",
    );
    if (!updated) return;
    await this.#writer.json(
      rpcEnvelope(request, { result: archived ? {} : { thread: updated.thread } }),
    );
    await this.#writer.json({
      method: archived ? "thread/archived" : "thread/unarchived",
      params: { threadId: updated.record.hostThreadId },
    });
  }

  async #updateExternalThreadMetadata(
    request: JsonRpcRequest,
    location: Extract<ExternalThreadLocation, { kind: "external" }>,
    update: DecodedThreadMetadataUpdateRequest,
  ): Promise<void> {
    if (update.unsupportedFields.length > 0) {
      await this.#writer.json(
        rpcError(
          request,
          -32078,
          `External Thread metadata fields are unsupported: ${update.unsupportedFields.join(", ")}`,
        ),
      );
      return;
    }
    if (typeof update.projectId === "string") {
      // Projects belong to official Codex; only assign one it can still read.
      const exists = await this.#requestOfficial("project/read", {
        projectId: update.projectId,
      }).then(
        (response) =>
          !isRecord(response.error) &&
          isRecord(response.result) &&
          isRecord(response.result.project) &&
          response.result.project.id === update.projectId,
        () => false,
      );
      if (!exists) {
        await this.#writer.json(rpcError(request, -32602, "Project is unavailable"));
        return;
      }
    }
    const patch = {
      ...(update.projectId !== undefined ? { projectId: update.projectId } : {}),
      ...(update.daybreakEnabled !== undefined ? { daybreakEnabled: update.daybreakEnabled } : {}),
      ...(update.gitInfo !== undefined ? { gitInfo: update.gitInfo } : {}),
    };
    const previousProjectId = location.record.projectId ?? null;
    const updated = await this.#persistExternalThreadRecord(
      request,
      location,
      (hostThreadId) => this.#repository.updateMetadata(hostThreadId, patch),
      "External Thread metadata could not be persisted",
      true,
    );
    if (!updated) return;
    await this.#writer.json(rpcEnvelope(request, { result: { thread: updated.thread } }));
    const projectId = updated.record.projectId ?? null;
    if (projectId !== previousProjectId) {
      await this.#writer.json({
        method: "thread/project/updated",
        params: { threadId: updated.record.hostThreadId, projectId },
      });
    }
  }

  /** Clear External assignments to a project official Codex reported as deleted. */
  async #clearDeletedProjectAssignments(projectId: string): Promise<void> {
    const records = await this.#repository.list();
    for (const record of records) {
      if (record.projectId !== projectId) continue;
      // A concurrent Desktop update may have reassigned the Thread since the listing.
      const updated = await this.#repository.updateMetadata(
        record.hostThreadId,
        { projectId: null },
        { ifProjectId: projectId },
      );
      if (updated.projectId !== undefined) continue;
      const loaded = this.#externalRuntime.get(updated.hostThreadId);
      if (loaded) this.#syncLoadedExternalThread(loaded, updated);
      await this.#writer.json({
        method: "thread/project/updated",
        params: { threadId: updated.hostThreadId, projectId: null },
      });
    }
  }

  #syncLoadedExternalThread(thread: ExternalThread, record: StoredThreadRecordV1): JsonObject {
    const projected = externalThreadValue({
      record,
      turns: [],
      sessionId: thread.sessionId,
      running: thread.running,
    });
    thread.record = record;
    thread.thread = { ...thread.thread, ...projected, turns: thread.thread.turns ?? [] };
    return projected;
  }

  async #persistExternalThreadRecord(
    request: JsonRpcRequest,
    location: Extract<ExternalThreadLocation, { kind: "external" }>,
    write: (hostThreadId: StoredThreadRecordV1["hostThreadId"]) => Promise<StoredThreadRecordV1>,
    failureMessage: string,
    allowProvisional = false,
  ): Promise<{ record: StoredThreadRecordV1; thread: JsonObject } | null> {
    const hasNativeSession =
      location.record.state === "ready" && location.record.nativeSessionRef !== undefined;
    // Host metadata may precede a Harness's deferred native Session, but only
    // while the loaded Thread still owns the provisional record.
    if (!hasNativeSession && !(allowProvisional && location.thread)) {
      await this.#writer.json(rpcError(request, -32079, "External Native Session is unavailable"));
      return null;
    }
    const sessionId =
      location.thread?.sessionId ??
      (await this.#repository.sessionTreeId(location.record).catch(() => null));
    if (!sessionId) {
      await this.#writer.json(
        rpcError(request, -32081, "External Thread metadata could not be projected"),
      );
      return null;
    }
    let record: StoredThreadRecordV1;
    try {
      record = await write(location.record.hostThreadId);
    } catch {
      await this.#writer.json(rpcError(request, -32081, failureMessage));
      return null;
    }
    const projected = location.thread
      ? this.#syncLoadedExternalThread(location.thread, record)
      : externalThreadValue({ record, turns: [], sessionId, loaded: false });
    return { record, thread: await this.#withExternalSection(projected) };
  }

  async #handleConsoleOpen(request: JsonRpcRequest): Promise<void> {
    if (!consoleOpenParamsSchema.safeParse(request.params ?? {}).success) {
      await this.#writer.json(rpcError(request, -32602, "Console params must be empty"));
      return;
    }
    const opener = this.#options.consoleOpener;
    if (!opener) {
      await this.#writer.json(
        rpcError(request, -32090, "The codexhost console is available on the local Host only"),
      );
      return;
    }
    try {
      const result = consoleOpenResultSchema.parse(await opener.open());
      await this.#writer.json(rpcEnvelope(request, { result }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32092, errorMessage(error).slice(0, 500)));
    }
  }

  async #handleUpdateRequest(request: JsonRpcRequest): Promise<void> {
    const params = updateEmptyParamsSchema.safeParse(
      request.params === undefined ? {} : request.params,
    );
    if (!params.success) {
      await this.#writer.json(rpcError(request, -32602, "Update params must be empty"));
      return;
    }
    const coordinator = this.#options.updateCoordinator;
    if (!coordinator) {
      await this.#writer.json(
        request.method === "codexhost/update/check"
          ? rpcEnvelope(request, { result: null })
          : rpcError(request, -32090, "Application updates are unavailable"),
      );
      return;
    }
    try {
      if (request.method === "codexhost/update/check") {
        const result = updateCheckResultSchema.parse(await coordinator.check());
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }
      if (request.method === "codexhost/update/status") {
        const result = updateStatusResultSchema.parse(await coordinator.status());
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }
      const result = updateStartResultSchema.parse(
        request.method === "codexhost/update/restart"
          ? await coordinator.restart()
          : await coordinator.start(),
      );
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32091, errorMessage(error).slice(0, 500)));
    }
  }

  // 原生任务列表读取失败时只保留 Host 已观测到的运行状态，不让一个过期的
  // active 记录或列表接口故障永久挡住项目推送。
  async #projectActiveThreads(): Promise<string[]> {
    const current = (): string[] => [
      ...this.#activeOfficialTurns.keys(),
      ...this.#pendingOfficialTurnStarts.values(),
      ...(this.#buddy?.activeThreadIds ?? []),
      ...this.#runningSubagentsByParent.keys(),
      ...this.#pendingExternalCommandRequests,
      ...this.#externalRuntime
        .values()
        .filter(
          (thread) =>
            thread.running || thread.activeTurnId || this.#externalSteering.hasPending(thread.id),
        )
        .map((thread) => thread.id),
    ];
    const active = new Set(current());
    try {
      // 包含连接 Host 前已经运行的原生任务；分页读完，不能只判断侧栏可见任务。
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const response = await this.#requestOfficial("thread/list", {
          limit: 100,
          archived: false,
          ...(cursor ? { cursor } : {}),
        });
        if (isRecord(response.error))
          throw new Error(String(response.error.message ?? "无法读取项目任务状态"));
        const page = isRecord(response.result) ? response.result : null;
        if (!page || !Array.isArray(page.data)) throw new Error("项目任务状态响应无效");
        for (const entry of page.data) {
          if (
            isRecord(entry) &&
            typeof entry.id === "string" &&
            isRecord(entry.status) &&
            entry.status.type === "active"
          )
            active.add(entry.id);
        }
        cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
        if (cursor && seen.has(cursor)) throw new Error("项目任务列表分页未前进");
        if (cursor) seen.add(cursor);
      } while (cursor);
    } catch (error) {
      this.#diagnose(error);
    }
    for (const id of current()) active.add(id);
    return [...active];
  }

  async #turnActionContext(threadId: string): Promise<TurnActionContext> {
    const location = await this.#locateExternalThread(threadId);
    if (location.kind === "error") throw new Error(location.error.message);
    const privateMode = (await this.#buddy?.privateMode()) ?? false;
    let context: TurnActionContext;
    let cwd: string;
    if (location.kind === "external") {
      await this.#waitForPlugins();
      const loaded = this.#externalRuntime.get(threadId);
      const adapter = this.#externalAdapters.get(location.record.harnessId);
      if (!adapter) throw new Error("当前 Harness 插件不可用");
      cwd = loaded?.cwd ?? location.record.cwd;
      const live = loaded ? await this.#inspectLoadedCommands(loaded) : null;
      context = {
        threadId,
        harnessId: location.record.harnessId,
        turns: loaded ? actionThreadTurns({ turns: this.#externalHistoryTurns(loaded) }) : [],
        busy: Boolean(loaded?.running || this.#pendingExternalCommandRequests.has(threadId)),
        private: privateMode,
        planMode: this.#turnActionPlanModes.get(threadId) ?? false,
        git: false,
        features: actionGitFeatures([]),
        commands: loaded?.session.commands
          ? (live ?? adapter.commandCatalog ?? { commands: [] })
          : { commands: [] },
        ...(adapter.actionCatalog ? { contributions: adapter.actionCatalog } : {}),
      };
    } else {
      const response = await this.#requestOfficial("thread/read", { threadId, includeTurns: true });
      const thread =
        isRecord(response.result) && isRecord(response.result.thread)
          ? response.result.thread
          : null;
      if (!thread || thread.id !== threadId || typeof thread.cwd !== "string")
        throw new Error("无法确认动作所属聊天");
      cwd = thread.cwd;
      const turns = actionThreadTurns(thread);
      context = {
        threadId,
        harnessId: "codex",
        turns,
        ...(typeof thread.modelProvider === "string" ? { provider: thread.modelProvider } : {}),
        busy:
          this.#activeOfficialTurns.has(threadId) ||
          this.#pendingOfficialDelegationThreads.has(threadId) ||
          (isRecord(thread.status) && thread.status.type === "active") ||
          turns.at(-1)?.status === "inProgress",
        private: privateMode,
        planMode:
          this.#turnActionPlanModes.get(threadId) ??
          (isRecord(thread.collaborationMode) && thread.collaborationMode.mode === "plan"),
        git: false,
        features: actionGitFeatures([]),
        commands: { commands: [] },
      };
    }
    if (!privateMode && (await this.#projectGitRoot(cwd))) {
      const repositories = await readProjectGitRepositories(
        cwd,
        this.#gitRepositoryLinks,
        this.#gitWorkspace,
      );
      context.git = repositories.length > 0;
      context.features = actionGitFeatures(repositories.map(({ status }) => status));
    }
    return context;
  }

  async #startTurnAction(
    threadId: string,
    action: RegisteredTurnAction,
    argumentText?: string,
  ): Promise<string | null> {
    const { target } = action;
    if (target.kind === "workflow") {
      const result = await this.#gitWorkflow.run(threadId, { waitForIdle: false });
      if (result.phase === "skipped") return null;
      if (!result.turnId || result.phase === "failed") throw new Error(result.message);
      return result.turnId;
    }
    const resolution = await this.#resolveExternalThread(threadId);
    if (resolution.kind === "error") throw new Error(resolution.error.message);
    if (target.kind === "command") {
      if (resolution.kind !== "external" || resolution.thread.running)
        throw new Error("原生命令不可用或聊天忙碌");
      const commands = resolution.thread.session.commands;
      const catalog = commands && (await commands.list());
      const command = catalog?.ok
        ? catalog.value.commands.find(({ id }) => id === target.commandId)
        : null;
      if (!command) throw new Error("原生命令已变化");
      const started = await this.#beginExternalCommand(
        resolution.thread,
        command,
        argumentText ? { text: argumentText } : undefined,
      );
      started.gate.resolve();
      return started.turnId;
    }
    let prompt = argumentText ? `${target.prompt}\n用户参数：\n${argumentText}` : target.prompt;
    if (action.descriptor.actionId === "git.commit") {
      await this.#gitWorkflow.skipAutomatic(threadId);
      const cwd = await this.#gitWorkspaceForThread(threadId);
      const repositories = await readProjectGitRepositories(
        cwd,
        this.#gitRepositoryLinks,
        this.#gitWorkspace,
      );
      prompt += `\n本回合仓库清单（路径仅作为数据）：\n${JSON.stringify(repositories.map(({ kind, status }) => ({ kind, path: status.workspace, branch: status.branch })))}`;
    }
    if (resolution.kind === "external") {
      const turnId = randomUUID();
      await this.#startDelegatedExternalTurn(resolution.thread, prompt, turnId);
      return turnId;
    }
    return (await this.#sendOfficialDelegationThread({ threadId, message: prompt })).turnId;
  }

  async #startProjectGitWorkflow(
    threadId: string,
    cwd: string,
    beforeStart: () => Promise<void>,
    repositories: readonly ProjectGitRepository[],
  ): Promise<string> {
    const prompt = projectGitWorkflowInput(repositories);
    if (await this.#buddy?.privateMode()) throw new Error("隐私模式下不自动推送代码。");
    const resolution = await this.#resolveExternalThread(threadId);
    if (resolution.kind === "error") throw new Error(resolution.error.message);
    if (resolution.kind === "external") {
      await beforeStart();
      const turnId = randomUUID();
      await this.#startDelegatedExternalTurn(resolution.thread, prompt, turnId);
      return turnId;
    }
    if (this.#buddy) return this.#buddy.startGitWorkflow(threadId, cwd, prompt, beforeStart);
    await beforeStart();
    const result = await this.#sendOfficialDelegationThread({
      threadId,
      message: prompt,
    });
    return result.turnId;
  }

  async #gitProjectWorkspace(input: GitWorkspaceTarget): Promise<string> {
    if (input.threadId) return this.#gitWorkspaceForThread(input.threadId);
    if (!input.cwd || !path.isAbsolute(input.cwd)) {
      throw new GitWorkspaceError("请输入当前 Host 上项目的绝对路径。");
    }
    return input.cwd;
  }

  async #remoteGitProjectWorkspace(input: GitWorkspaceTarget): Promise<string> {
    if (!input.cwd || !path.posix.isAbsolute(input.cwd)) {
      throw new GitWorkspaceError("SSH 项目必须使用远端绝对路径。");
    }
    return input.cwd;
  }

  async #resolveGitWorkspace(
    input: GitWorkspaceTarget & {
      repository?: string | undefined;
    },
  ): Promise<string> {
    return this.#gitRepositoryLinks.resolve(
      await this.#gitProjectWorkspace(input),
      input.repository,
    );
  }

  async #gitWorkspaceForThread(threadId: string): Promise<string> {
    const loaded = this.#externalRuntime.get(threadId);
    if (loaded) return loaded.cwd;
    const record = await this.#repository.find(threadId);
    if (record) return record.cwd;

    const response = await this.#requestOfficial("thread/read", {
      threadId,
      includeTurns: false,
    });
    const result = isRecord(response.result) ? response.result : null;
    const thread = result && isRecord(result.thread) ? result.thread : null;
    const cwd = thread && typeof thread.cwd === "string" ? thread.cwd.trim() : "";
    if (!cwd) throw new GitWorkspaceError("当前任务没有可用的工作区路径。");
    return cwd;
  }

  // 会话项目目录本身可能不是 Git 仓库：仓库可能在子目录里（由关联记录提供）。
  // 主目录不是仓库时，只有存在已关联仓库才把该目录当作项目范围，避免把任意目录当成项目。
  async #projectGitRoot(cwd: string): Promise<string | null> {
    const root = await this.#gitWorkspace.root(cwd);
    if (root) return root;
    const linked = await this.#gitRepositoryLinks.list(cwd);
    return linked.repositories.length > 1 ? this.#gitWorkspace.realpath(cwd) : null;
  }

  async #handleWorkspaceFilesRequest(request: JsonRpcRequest): Promise<void> {
    try {
      if (request.method === WORKSPACE_FILES_LIST_METHOD) {
        const params = workspaceFilesListParamsSchema.safeParse(request.params);
        if (!params.success) throw new WorkspaceFilesError("文件列表参数无效。");
        const cwd = await this.#gitWorkspaceForThread(params.data.threadId);
        const result = await listWorkspaceFiles(cwd, params.data.path);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }
      if (request.method === WORKSPACE_FILES_READ_METHOD) {
        const params = workspaceFileReadParamsSchema.safeParse(request.params);
        if (!params.success) throw new WorkspaceFilesError("文件读取参数无效。");
        const cwd = await this.#gitWorkspaceForThread(params.data.threadId);
        const result = await readWorkspaceFile(cwd, params.data.path);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }
      if (request.method === WORKSPACE_FILES_WRITE_METHOD) {
        const params = workspaceFileWriteParamsSchema.safeParse(request.params);
        if (!params.success) throw new WorkspaceFilesError("文件写入参数无效。");
        const cwd = params.data.repository
          ? await this.#resolveGitWorkspace(params.data)
          : await this.#gitWorkspaceForThread(params.data.threadId);
        const result = await writeWorkspaceFile(
          cwd,
          params.data.path,
          params.data.content,
          params.data.expectedRevision,
        );
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }
      throw new WorkspaceFilesError("不支持的文件请求。");
    } catch (error) {
      await this.#writer.json(rpcError(request, -32094, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleThreadTerminalListRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const params = threadTerminalListParamsSchema.safeParse(request.params);
      if (!params.success) throw new Error("终端列表参数无效。");
      const result = await listThreadTerminals();
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32096, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleThreadTerminalSettingsRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const result =
        request.method === THREAD_TERMINAL_SETTINGS_GET_METHOD
          ? await this.#threadTerminalSettings.load()
          : await this.#threadTerminalSettings.set(
              threadTerminalSettingsSchema.parse(request.params),
            );
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32097, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleProjectTabsSettingsRequest(request: JsonRpcRequest): Promise<void> {
    try {
      let result: ProjectTabsState;
      if (request.method === PROJECT_TABS_GET_METHOD) {
        projectTabsGetParamsSchema.parse(request.params);
        result = await this.#projectTabsSettings.load();
      } else {
        result = await this.#projectTabsSettings.set(projectTabsConfigSchema.parse(request.params));
      }
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32100, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleProjectToolsSettingsRequest(request: JsonRpcRequest): Promise<void> {
    try {
      let result: ProjectToolsState;
      if (request.method === PROJECT_TOOLS_GET_METHOD) {
        projectToolsGetParamsSchema.parse(request.params);
        result = await this.#projectToolsSettings.load();
      } else {
        result = await this.#projectToolsSettings.set(
          projectToolsConfigSchema.parse(request.params),
        );
      }
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32102, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleProjectToolsRunScriptRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const params = projectScriptRunParamsSchema.parse(request.params);
      const config = (await this.#projectToolsSettings.load()).config;
      const targetKey = projectToolTargetKey(params.target);
      const binding = config?.bindings.find(
        (candidate) => projectToolTargetKey(candidate.target) === targetKey,
      );
      if (!binding) throw new Error("项目快捷操作尚未绑定。");
      const result = await this.#projectScriptRunner.run(binding, params.action);
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32103, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleThreadFoldersSettingsRequest(request: JsonRpcRequest): Promise<void> {
    try {
      let result: ThreadFoldersState;
      if (request.method === THREAD_FOLDERS_GET_METHOD) {
        threadFoldersGetParamsSchema.parse(request.params);
        result = await this.#threadFoldersSettings.load();
      } else {
        result = await this.#threadFoldersSettings.set(
          threadFoldersConfigSchema.parse(request.params),
        );
      }
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32101, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleThreadOpenTargetRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const { threadId } = threadOpenTargetParamsSchema.parse(request.params);
      const resolution = await this.#locateExternalThread(threadId);
      if (resolution.kind !== "official") throw new Error("只有官方 Codex 线程可以从终端续接。");
      const environment = this.#options.environment ?? process.env;
      const workspace = await this.#gitWorkspaceForThread(threadId);
      const result = threadOpenTargetSchema.parse({
        workspace,
        codexPath: this.#options.stockCodexPath,
        codexHome: path.resolve(environment.CODEX_HOME ?? path.join(os.homedir(), ".codex")),
      });
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32095, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleThreadTerminalRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const params = threadTerminalOpenParamsSchema.safeParse(request.params);
      if (!params.success) throw new Error("打开终端参数无效。");
      const remote = params.data.remote;
      const environment = this.#options.environment ?? process.env;
      const ssh = remote ? await desktopSshConnection(remote.hostId, environment) : null;
      if (!remote) {
        const resolution = await this.#locateExternalThread(params.data.threadId);
        if (resolution.kind !== "official") throw new Error("只有官方 Codex 线程可以从终端续接。");
      }
      const cwd = remote?.workspace ?? (await this.#gitWorkspaceForThread(params.data.threadId));
      const settings = await this.#threadTerminalSettings.load();
      const result = await openThreadTerminal(
        cwd,
        params.data.threadId,
        remote?.codexPath ?? this.#options.stockCodexPath,
        params.data.terminalId ?? settings.terminalId ?? "system-default",
        {
          environment,
          ...(remote && ssh
            ? {
                ssh: {
                  arguments: ssh.arguments,
                  codexHome: remote.codexHome,
                  workspace: remote.workspace,
                },
              }
            : {}),
        },
      );
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32095, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleThreadWorkspaceOpenRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const params = threadWorkspaceOpenParamsSchema.safeParse(request.params);
      if (!params.success) throw new Error("打开工作区参数无效。");
      const remote = params.data.remote;
      const environment = this.#options.environment ?? process.env;
      const ssh = remote ? await desktopSshConnection(remote.hostId, environment) : null;
      if (ssh && !ssh.authority) {
        throw new Error("VS Code 的此 SSH 连接需要使用配置了密钥文件的 SSH 别名。");
      }
      if (!remote) {
        const resolution = await this.#locateExternalThread(params.data.threadId);
        if (resolution.kind !== "official") throw new Error("只有官方 Codex 线程可以打开工作区。");
      }
      const cwd = remote?.workspace ?? (await this.#gitWorkspaceForThread(params.data.threadId));
      const result = await openThreadWorkspace(cwd, {
        environment,
        ...(ssh?.authority ? { sshAuthority: ssh.authority } : {}),
      });
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32098, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleDoubaoOpenRequest(request: JsonRpcRequest): Promise<void> {
    try {
      doubaoOpenParamsSchema.parse(request.params);
      const open = createLauncherDoubaoOpener(this.#options.environment ?? process.env);
      if (!open) throw new Error("Doubao 只能从本机 CodexBuddy 打开。");
      await open();
      await this.#writer.json(rpcEnvelope(request, { result: { application: "doubao" } }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32098, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleProjectTerminalOpenRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const params = projectTerminalOpenParamsSchema.parse(request.params);
      const environment = this.#options.environment ?? process.env;
      const settings = await this.#threadTerminalSettings.load();
      const result = await openProjectTerminal(
        params.path,
        params.terminalId ?? settings.terminalId ?? "system-default",
        { environment },
      );
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32101, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleProjectWorkspaceOpenRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const params = projectWorkspaceOpenParamsSchema.parse(request.params);
      const result = await openProjectWorkspace(params.path, {
        environment: this.#options.environment ?? process.env,
      });
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32102, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleProjectSyncRequest(request: JsonRpcRequest): Promise<void> {
    const method = request.method;
    const schema =
      method === PROJECT_SYNC_PAIR_METHOD
        ? projectSyncPairParamsSchema
        : method === PROJECT_SYNC_ACCEPT_METHOD || method === PROJECT_SYNC_REJECT_METHOD
          ? projectSyncRequestParamsSchema
          : method === PROJECT_SYNC_GIT_CONFIGURE_METHOD
            ? projectSyncGitConfigureParamsSchema
            : method === PROJECT_SYNC_SYNC_METHOD || method === PROJECT_SYNC_REMOVE_PEER_METHOD
              ? projectSyncPeerParamsSchema
              : method === PROJECT_SYNC_ADD_METHOD
                ? projectSyncAddParamsSchema
                : method === PROJECT_SYNC_BIND_METHOD
                  ? projectSyncBindParamsSchema
                  : method === PROJECT_SYNC_CLONE_METHOD
                    ? projectSyncCloneParamsSchema
                    : projectSyncEmptyParamsSchema;
    const parsed = schema.safeParse(request.params);
    if (!parsed.success) {
      await this.#writer.json(rpcError(request, -32602, "Invalid project sync params"));
      return;
    }
    try {
      let result;
      if (method === PROJECT_SYNC_INVITE_METHOD) {
        result = await this.#projectSync.invite();
      } else if (method === PROJECT_SYNC_PAIR_METHOD) {
        result = await this.#projectSync.pair(
          projectSyncPairParamsSchema.parse(request.params).code,
        );
      } else if (method === PROJECT_SYNC_ACCEPT_METHOD) {
        result = await this.#projectSync.accept(
          projectSyncRequestParamsSchema.parse(request.params).requestId,
        );
      } else if (method === PROJECT_SYNC_REJECT_METHOD) {
        result = await this.#projectSync.reject(
          projectSyncRequestParamsSchema.parse(request.params).requestId,
        );
      } else if (method === PROJECT_SYNC_GIT_CONFIGURE_METHOD) {
        result = await this.#projectSync.configureGit(
          projectSyncGitConfigureParamsSchema.parse(request.params).remote,
        );
      } else if (method === PROJECT_SYNC_GIT_PULL_METHOD) {
        result = await this.#projectSync.pullGit();
      } else if (method === PROJECT_SYNC_GIT_PUSH_METHOD) {
        result = await this.#projectSync.pushGit();
      } else if (method === PROJECT_SYNC_ADD_METHOD) {
        result = await this.#projectSync.add(projectSyncAddParamsSchema.parse(request.params).path);
      } else if (method === PROJECT_SYNC_BIND_METHOD) {
        const { remote, path } = projectSyncBindParamsSchema.parse(request.params);
        result = await this.#projectSync.bind(remote, path);
      } else if (method === PROJECT_SYNC_CLONE_METHOD) {
        const { remote, parent } = projectSyncCloneParamsSchema.parse(request.params);
        result = await this.#projectSync.clone(remote, parent);
      } else if (method === PROJECT_SYNC_SYNC_METHOD) {
        result = await this.#projectSync.sync(
          projectSyncPeerParamsSchema.parse(request.params).peerId,
        );
      } else if (method === PROJECT_SYNC_REMOVE_PEER_METHOD) {
        result = await this.#projectSync.removePeer(
          projectSyncPeerParamsSchema.parse(request.params).peerId,
        );
      } else {
        result = await this.#projectSync.inspect();
      }
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      await this.#writer.json(rpcError(request, -32094, errorMessage(error).slice(0, 2000)));
    }
  }

  async #handleSshGitRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const input = sshGitParamsSchema.parse(request.params);
      if (!path.posix.isAbsolute(input.params.cwd))
        throw new GitWorkspaceError("SSH 项目必须使用远端绝对路径。");
      const services = await this.#sshGit.forHost(input.hostId);
      const resolveWorkspace = async (
        params: GitWorkspaceTarget & { repository?: string | undefined },
      ) => services.links.resolve(await this.#remoteGitProjectWorkspace(params), params.repository);
      if (input.method === GIT_MESSAGE_MODEL_METHOD) {
        const params = gitWorkspaceParamsSchema.safeParse(input.params);
        if (!params.success) throw new GitWorkspaceError("Git 工作区参数无效。");
        await resolveWorkspace(params.data);
        await this.#writer.json(rpcEnvelope(request, { result: await services.messageModels() }));
        return;
      }
      if (input.method === GIT_MESSAGE_GENERATE_METHOD) {
        const params = gitMessageGenerateParamsSchema.safeParse(input.params);
        if (!params.success) throw new GitWorkspaceError("生成提交消息参数无效。");
        const cwd = await resolveWorkspace(params.data);
        await this.#writer.json(
          rpcEnvelope(request, {
            result: jsonValueSchema.parse(
              await services.generateMessage({
                cwd,
                model: params.data.model,
                paths: params.data.paths,
              }),
            ),
          }),
        );
        return;
      }
      await this.#handleGitRequest(
        { id: request.id, method: input.method, params: jsonValueSchema.parse(input.params) },
        services,
        true,
      );
    } catch (error) {
      await this.#writer.json(rpcError(request, -32094, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #handleGitRequest(
    request: JsonRpcRequest,
    services: GitWorkspaceServices = { git: this.#gitWorkspace, links: this.#gitRepositoryLinks },
    remote = false,
  ): Promise<void> {
    const { git, links } = services;
    const projectWorkspace = (input: GitWorkspaceTarget) =>
      remote ? this.#remoteGitProjectWorkspace(input) : this.#gitProjectWorkspace(input);
    const resolveWorkspace = async (
      input: GitWorkspaceTarget & { repository?: string | undefined },
    ) => links.resolve(await projectWorkspace(input), input.repository);
    try {
      if (
        [
          GIT_REPOSITORIES_METHOD,
          GIT_REPOSITORY_LINK_METHOD,
          GIT_REPOSITORY_UNLINK_METHOD,
          GIT_REPOSITORY_DIRECTORIES_METHOD,
          GIT_REPOSITORY_CLONE_METHOD,
        ].includes(request.method)
      ) {
        let result;
        if (request.method === GIT_REPOSITORIES_METHOD) {
          const params = gitRepositoriesParamsSchema.parse(request.params);
          const cwd = await projectWorkspace(params);
          // 展示用清单额外识别项目目录内的一级子仓库；工作流仍只使用显式关联记录。
          result = await links.list(cwd, { discover: true });
        } else if (request.method === GIT_REPOSITORY_DIRECTORIES_METHOD) {
          const params = gitRepositoryDirectoriesParamsSchema.parse(request.params);
          const cwd = await projectWorkspace(params);
          result = await listGitRepositoryDirectories(
            { ...params, cwd },
            { git, links, cwd, paths: git.paths },
          );
        } else if (request.method === GIT_REPOSITORY_CLONE_METHOD) {
          const params = gitRepositoryCloneParamsSchema.parse(request.params);
          const cwd = await projectWorkspace(params);
          result = await cloneGitRepository(
            { ...params, cwd },
            { git, links, cwd, paths: git.paths },
          );
        } else {
          const params = gitRepositoryLinkParamsSchema.parse(request.params);
          const cwd = await projectWorkspace(params);
          result =
            request.method === GIT_REPOSITORY_LINK_METHOD
              ? await links.link(cwd, params.repository)
              : await links.unlink(cwd, params.repository);
        }
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }
      if (request.method === GIT_MESSAGE_MODEL_METHOD) {
        const params = gitWorkspaceParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 工作区参数无效。");
        await resolveWorkspace(params.data);
        const result = await git.messageModels(this.#options.environment ?? process.env);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_SUBMODULES_METHOD) {
        const params = gitWorkspaceParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 工作区参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result = await git.submodules(cwd);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_SUBMODULE_UPDATE_METHOD) {
        const params = gitSubmoduleUpdateParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 子模块参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result = await git.updateSubmodule(cwd, params.data);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_LOG_METHOD) {
        const params = gitLogParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 日志参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result = await git.log(cwd, params.data.limit);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_COMMIT_DETAIL_METHOD) {
        const params = gitCommitDetailParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 提交详情参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result = await git.commitDetail(cwd, params.data.commit);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_COMMIT_DIFF_METHOD) {
        const params = gitCommitDiffParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 提交 diff 参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result = await git.commitDiff(cwd, params.data.commit, params.data.path);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_STATUS_METHOD || request.method === GIT_PUSH_METHOD) {
        const params = gitWorkspaceParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 工作区参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result =
          request.method === GIT_STATUS_METHOD ? await git.status(cwd) : await git.push(cwd);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (
        request.method === GIT_FETCH_METHOD ||
        request.method === GIT_SYNC_METHOD ||
        request.method === GIT_MERGE_CONTINUE_METHOD ||
        request.method === GIT_MERGE_ABORT_METHOD
      ) {
        const params = gitWorkspaceParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 工作区参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result =
          request.method === GIT_FETCH_METHOD
            ? await git.fetch(cwd)
            : request.method === GIT_SYNC_METHOD
              ? await git.sync(cwd)
              : request.method === GIT_MERGE_CONTINUE_METHOD
                ? await git.mergeContinue(cwd)
                : await git.mergeAbort(cwd);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_DIFF_METHOD) {
        const params = gitDiffParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git diff 参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result = await git.diff(cwd, params.data.path);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_CONTENT_METHOD) {
        const params = gitContentParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 内容参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result = await git.content(cwd, params.data.path);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_STAGE_METHOD) {
        const params = gitStageParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 暂存参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result = await git.stage(cwd, params.data.paths);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_UNSTAGE_METHOD) {
        const params = gitStageParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 取消暂存参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result = await git.unstage(cwd, params.data.paths);
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      if (request.method === GIT_COMMIT_METHOD) {
        const params = gitCommitParamsSchema.safeParse(request.params);
        if (!params.success) throw new GitWorkspaceError("Git 提交参数无效。");
        const cwd = await resolveWorkspace(params.data);
        const result = await git.commit(
          cwd,
          params.data.message,
          params.data.push,
          params.data.paths,
        );
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        return;
      }

      const params = gitMessageGenerateParamsSchema.safeParse(request.params);
      if (!params.success) throw new GitWorkspaceError("生成提交消息参数无效。");
      const cwd = await resolveWorkspace(params.data);
      const result = await git.generateMessage({
        cwd,
        model: params.data.model,
        paths: params.data.paths,
        environment: this.#options.environment ?? process.env,
      });
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch (error) {
      // 真正的文件冲突回带工作区状态；认证、权限和网络故障仍按普通错误报告。
      if (error instanceof GitSyncConflictError) {
        await this.#writer.json(
          rpcEnvelope(request, {
            error: {
              code: -32094,
              message: error.message,
              data: jsonValueSchema.parse({ kind: "sync-conflict", status: error.status }),
            },
          }),
        );
        return;
      }
      if (error instanceof GitPushRejectedError) {
        await this.#writer.json(
          rpcEnvelope(request, {
            error: {
              code: -32094,
              message: error.message,
              data: jsonValueSchema.parse({ kind: "push-rejected", behind: error.behind }),
            },
          }),
        );
        return;
      }
      await this.#writer.json(rpcError(request, -32093, errorMessage(error).slice(0, 20_000)));
    }
  }

  async #inspectHarness(request: JsonRpcRequest): Promise<void> {
    const params = harnessInspectParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(rpcError(request, -32602, "Invalid Harness inspection params"));
      return;
    }
    await this.#waitForPlugins();
    const registered = [...this.#externalAdapters].find(
      ([harnessId]) => harnessId === params.data.harnessId,
    );
    const adapter = registered?.[1];
    if (!adapter) {
      await this.#writer.json(
        rpcError(request, -32077, `Harness '${params.data.harnessId}' is unavailable`),
      );
      return;
    }
    let inspection: unknown;
    try {
      inspection = await adapter.inspect({
        ...(params.data.cwd ? { cwd: params.data.cwd } : {}),
        ...(params.data.refresh !== undefined ? { refresh: params.data.refresh } : {}),
        ...(params.data.purpose ? { purpose: params.data.purpose } : {}),
      });
    } catch (error) {
      await this.#writer.json(
        rpcError(request, -32077, `Harness inspection failed: ${errorMessage(error)}`),
      );
      return;
    }
    const validated = harnessInspectionSchema.safeParse(inspection);
    if (!validated.success) {
      await this.#writer.json(
        rpcError(request, -32077, "Harness inspection returned an invalid result"),
      );
      return;
    }
    await this.#writer.json(
      rpcEnvelope(request, { result: jsonValueSchema.parse(validated.data) }),
    );
  }

  async #openHarnessWebUi(request: JsonRpcRequest): Promise<void> {
    const params = harnessWebUiOpenParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(rpcError(request, -32602, "Invalid Harness Web UI params"));
      return;
    }
    await this.#waitForPlugins();
    const adapter = [...this.#externalAdapters].find(
      ([harnessId]) => harnessId === params.data.harnessId,
    )?.[1];
    const webUi = adapter?.webUi;
    if (!webUi) {
      await this.#writer.json(rpcError(request, -32092, "Harness Web UI is unavailable"));
      return;
    }
    try {
      const result = await webUi.open();
      if (!result.ok) {
        await this.#writer.json(rpcError(request, -32092, "Harness Web UI could not be opened"));
        return;
      }
      await this.#writer.json(
        rpcEnvelope(request, { result: harnessWebUiOpenResultSchema.parse({}) }),
      );
    } catch {
      await this.#writer.json(rpcError(request, -32092, "Harness Web UI could not be opened"));
    }
  }

  async #handleSessionImport(request: JsonRpcRequest): Promise<void> {
    await this.#waitForPlugins();
    this.#sessionImportRequests ??= new SessionImportRequests({
      adapters: this.#externalAdapters,
      descriptors: () => this.#pluginDescriptors,
      repository: this.#repository,
      diagnose: (error) => this.#diagnose(error),
    });
    const response = await this.#sessionImportRequests.handle(request);
    await this.#writer.json(rpcEnvelope(request, response.body));
    if (response.importedThread) await this.#notifyExternalThreadStarted(response.importedThread);
  }

  async #inspectThread(request: JsonRpcRequest): Promise<void> {
    const params = threadInspectionParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(rpcError(request, -32602, "Invalid Thread inspection params"));
      return;
    }
    const resolution = await this.#resolveExternalThread(params.data.threadId);
    if (resolution.kind === "error") {
      await this.#writer.json(rpcError(request, resolution.error.code, resolution.error.message));
      return;
    }
    const supportsThreadReferences =
      resolution.kind === "official" &&
      params.data.includeReferenceCapability === true &&
      (await nativeThreadSupportsReferences({
        codexHome: this.#officialRuntimeScope.permanentHome,
        threadId: params.data.threadId,
        readThread: () =>
          this.#officialRuntime.request("thread/read", {
            threadId: params.data.threadId,
            includeTurns: false,
          }),
      }));
    const threadUsage =
      resolution.kind === "official" ? null : await this.#threadUsage(resolution.thread);
    const inspection = threadInspectionSchema.parse(
      resolution.kind === "official"
        ? {
            owner: "codex",
            locked: true,
            ...(supportsThreadReferences ? { supportsThreadReferences: true } : {}),
          }
        : {
            owner: "external",
            harnessId: resolution.thread.harnessId,
            transportModelId: resolution.thread.transportModelId,
            ...(resolution.thread.stateObserver.state.effectiveModel
              ? { effectiveModel: resolution.thread.stateObserver.state.effectiveModel }
              : {}),
            ...(resolution.thread.stateObserver.state.resolvedModelLabel
              ? { resolvedModelLabel: resolution.thread.stateObserver.state.resolvedModelLabel }
              : {}),
            ...(resolution.thread.stateObserver.state.effectiveThinkingOptionId
              ? {
                  effectiveThinkingOptionId:
                    resolution.thread.stateObserver.state.effectiveThinkingOptionId,
                }
              : {}),
            ...(resolution.thread.stateObserver.state.availableThinkingOptions
              ? {
                  availableThinkingOptions:
                    resolution.thread.stateObserver.state.availableThinkingOptions,
                }
              : {}),
            ...(resolution.thread.stateObserver.state.effectivePermissionModeId
              ? {
                  effectivePermissionModeId:
                    resolution.thread.stateObserver.state.effectivePermissionModeId,
                }
              : {}),
            history: resolution.thread.session.capabilities.history,
            ...(threadUsage ? { usage: threadUsage } : {}),
            locked: true,
          },
    );
    await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(inspection) }));
  }

  async #inspectThreadUsage(request: JsonRpcRequest): Promise<void> {
    const params = threadUsageInspectionParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(rpcError(request, -32602, "Invalid Thread Usage inspection params"));
      return;
    }
    const resolution = await this.#resolveExternalThread(params.data.threadId);
    if (resolution.kind === "error") {
      await this.#writer.json(rpcError(request, resolution.error.code, resolution.error.message));
      return;
    }
    if (resolution.kind === "official") {
      if (params.data.refresh !== undefined) {
        await this.#writer.json(
          rpcError(request, -32602, "Exact Usage refresh is only available for External Threads"),
        );
        return;
      }
      await this.#waitForPlugins();
      const accountId = await this.#currentCodexAccountId();
      if (accountId) await this.#refreshOfficialRateLimits(accountId);
      const accountCredits = this.#officialAccountCredits(accountId ?? undefined);
      const result = threadUsageInspectionSchema.parse({
        threadId: params.data.threadId,
        usage: await this.#observedSessionUsage.read(params.data.threadId),
        accountCreditsSupported: true,
        ...(accountCredits ? { accountCredits } : {}),
      });
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
      return;
    }
    if (params.data.refresh === "exact") void resolution.thread.session.refreshUsage?.();
    const adapter = this.#externalAdapters.get(resolution.thread.harnessId);
    if (adapter?.credits && adapter.refreshCredits)
      void Promise.resolve()
        .then(() => adapter.refreshCredits?.())
        .catch(() => undefined);
    let credits: AccountCreditsSnapshot | null = null;
    try {
      credits = parseHarnessAccountCredits(adapter?.credits?.());
    } catch {
      // Optional account telemetry cannot fail the Thread's usage inspection.
    }
    const result = threadUsageInspectionSchema.parse({
      threadId: params.data.threadId,
      usage: await this.#threadUsage(resolution.thread),
      accountCreditsSupported: typeof adapter?.credits === "function",
      ...(credits ? { accountCredits: credits } : {}),
    });
    await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
  }

  #refreshOfficialRateLimits(accountId: string, force = false) {
    return this.#officialRateLimits.refresh(
      accountId,
      async () => this.#officialRuntime.request("account/rateLimits/read", {}),
      force,
    );
  }

  #officialAccountCredits(accountId: string | undefined): AccountCreditsSnapshot | null {
    if (!accountId) return null;
    return projectCodexRateLimitsToCredits(
      this.#officialRateLimits.get(accountId),
      this.#officialRateLimits.getResetCredits(accountId),
    );
  }

  async #listThreadOwnership(request: JsonRpcRequest): Promise<void> {
    const params = threadOwnershipListParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(rpcError(request, -32602, "Invalid Thread ownership-list params"));
      return;
    }
    try {
      const shared = await this.#options.sharedThreads?.ownership(params.data.threadIds);
      const threads = await Promise.all(
        params.data.threadIds.map(async (threadId) => {
          const sharedHarness = shared?.get(threadId);
          if (sharedHarness)
            return { threadId, owner: "external" as const, harnessId: sharedHarness };
          const record = await this.#repository.find(threadId);
          return record
            ? { threadId, owner: "external" as const, harnessId: record.harnessId }
            : { threadId, owner: "codex" as const };
        }),
      );
      const result = threadOwnershipListResultSchema.parse({ threads });
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
    } catch {
      await this.#writer.json(
        rpcError(request, -32081, "Thread ownership metadata could not be read"),
      );
    }
  }

  /** Read the same delivery decision that Desktop `turn/steer` will follow. */
  async #inspectThreadSteering(request: JsonRpcRequest): Promise<void> {
    const params = threadSteeringInspectParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(rpcError(request, -32602, "Invalid Thread steering params"));
      return;
    }
    let delivery: "official" | "activeTurn" | "newTurn";
    try {
      const location = await this.#locateExternalThread(params.data.threadId);
      if (await this.#writeResolutionError(request, location)) return;
      const thread =
        location.kind === "external" ? this.#externalRuntime.get(params.data.threadId) : undefined;
      delivery =
        location.kind !== "external"
          ? "official"
          : thread
            ? await externalSteeringDelivery(thread, params.data.text)
            : "newTurn";
    } catch {
      await this.#writer.json(
        rpcError(request, -32081, "Thread steering metadata could not be read"),
      );
      return;
    }
    const result = threadSteeringInspectResultSchema.parse({ delivery });
    await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
  }

  async #inspectThreadCommands(request: JsonRpcRequest): Promise<void> {
    const params = threadCommandsInspectParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(
        rpcError(request, -32602, "Invalid Thread command inspection params"),
      );
      return;
    }
    const location = await this.#locateExternalThread(params.data.threadId);
    if (await this.#writeResolutionError(request, location)) return;
    if (location.kind !== "external") {
      await this.#writer.json(rpcEnvelope(request, { result: { commands: [] } }));
      return;
    }
    // A loaded Session reports its live catalog (custom commands, skills). Never
    // open a Session only to read commands; unloaded Threads fall back to the
    // workspace cache, then the static catalog.
    const loaded = this.#externalRuntime.get(params.data.threadId);
    if (loaded) {
      const catalog = await this.#inspectLoadedCommands(loaded);
      if (catalog) {
        await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(catalog) }));
        return;
      }
    }
    await this.#writeHarnessCommandCatalog(
      request,
      location.record.harnessId,
      loaded?.cwd ?? location.record.cwd,
      params.data.threadId,
    );
  }

  /**
   * Catalog of a loaded Session, marked live or static. A live catalog is
   * remembered for its Harness and workspace so later drafts there can show it.
   */
  async #inspectLoadedCommands(thread: ExternalThread): Promise<HarnessCommandCatalog | null> {
    if (!thread.session.commands) return null;
    const catalog = await inspectLiveCommandCatalog(thread.session.commands);
    if (!catalog) return null;
    const staticCatalog = this.#externalAdapters.get(thread.harnessId)?.commandCatalog;
    if (staticCatalog && !isLiveCommandCatalog(catalog, staticCatalog)) return null;
    const live = { ...catalog, source: "live" as const };
    this.#liveCommandCache.remember(thread.harnessId, thread.cwd, live);
    return live;
  }

  async #writeHarnessCommandCatalog(
    request: JsonRpcRequest,
    harnessId: HarnessId,
    cwd?: string,
    inspectedThreadId?: string,
  ): Promise<void> {
    await this.#waitForPlugins();
    const adapter = this.#externalAdapters.get(harnessId);
    if (!adapter) {
      await this.#writer.json(rpcError(request, -32077, `Harness '${harnessId}' is unavailable`));
      return;
    }
    let catalog: HarnessCommandCatalog;
    try {
      // `static` tells the Composer live commands exist but are not loaded
      // yet; Harnesses without live catalogs leave the source unset.
      catalog = harnessCommandCatalogSchema.parse({
        ...(adapter.commandCatalog ?? { commands: [] }),
        ...(adapter.liveCommandCatalog ? { source: "static" } : {}),
      });
    } catch {
      await this.#writer.json(rpcError(request, -32078, "Harness command catalog is invalid"));
      return;
    }
    if (cwd && adapter.liveCommandCatalog) {
      // Draft of a known workspace: a loaded Session there (a prewarmed draft
      // or an open Thread) or the last catalog seen for it. Never start one.
      for (const thread of this.#externalRuntime.values()) {
        if (thread.id === inspectedThreadId) continue;
        if (thread.harnessId !== harnessId || !sameWorkspace(thread.cwd, cwd)) continue;
        const live = await this.#inspectLoadedCommands(thread);
        if (live) {
          catalog = live;
          break;
        }
      }
      if (catalog.source === "static") {
        catalog = this.#liveCommandCache.lookup(harnessId, cwd) ?? catalog;
      }
    }
    await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(catalog) }));
  }

  async #executeThreadCommand(request: JsonRpcRequest): Promise<void> {
    const params = threadCommandExecuteParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(rpcError(request, -32602, "Invalid Thread command parameters"));
      return;
    }
    const resolution = await this.#resolveExternalThread(params.data.threadId);
    if (await this.#writeResolutionError(request, resolution)) return;
    if (resolution.kind !== "external") {
      await this.#writer.json(rpcError(request, -32078, "Thread is not externally owned"));
      return;
    }
    this.#dispatchDesktopReply(
      request,
      () => this.#executeResolvedThreadCommand(request, resolution.thread, params.data),
      resolution.thread.id,
    );
  }

  async #executeResolvedThreadCommand(
    request: JsonRpcRequest,
    thread: ExternalThread,
    params: ReturnType<typeof threadCommandExecuteParamsSchema.parse>,
  ): Promise<void> {
    if (this.#externalThreadBusy(thread) || this.#pendingExternalCommandRequests.has(thread.id)) {
      await this.#writer.json(
        rpcError(request, -32072, "External Thread already has an active operation"),
      );
      return;
    }
    this.#pendingExternalCommandRequests.add(thread.id);
    try {
      const commands = thread.session.commands;
      if (!commands) {
        await this.#writer.json(
          rpcError(request, -32078, "External Harness does not expose commands"),
        );
        return;
      }
      const catalog = await commands.list();
      if (!catalog.ok) {
        await this.#writer.json(rpcError(request, -32078, catalog.error.message));
        return;
      }
      const descriptor = catalog.value.commands.find(({ id }) => id === params.commandId);
      if (!descriptor) {
        await this.#writer.json(
          rpcError(
            request,
            -32078,
            `External Harness does not expose command '${params.commandId}'`,
          ),
        );
        return;
      }
      try {
        const started = await this.#beginExternalCommand(
          thread,
          descriptor,
          params.arguments,
          params.turnId,
        );
        try {
          const result = threadCommandExecuteResultSchema.parse({
            accepted: true,
            turnId: started.turnId,
          });
          await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(result) }));
        } finally {
          started.gate.resolve();
        }
      } catch (error) {
        this.#diagnose(error);
        await this.#writer.json(
          error instanceof ExternalCommandError
            ? rpcError(request, error.code, error.message)
            : rpcError(request, -32073, `External Harness command failed: ${errorMessage(error)}`),
        );
      }
    } finally {
      this.#pendingExternalCommandRequests.delete(thread.id);
    }
  }

  async #beginExternalCommand(
    thread: ExternalThread,
    descriptor: HarnessCommandDescriptor,
    arguments_: JsonObject | undefined,
    requestedTurnId?: HostTurnId,
    sourceHostId?: unknown,
  ): Promise<{ turnId: HostTurnId; turn: JsonObject; gate: TurnProjectionGate }> {
    const commands = thread.session.commands;
    if (!commands) {
      throw new ExternalCommandError(-32078, "External Harness does not expose commands");
    }
    if (this.#closeRequested || this.#externalRuntime.get(thread.id) !== thread) {
      throw new ExternalCommandError(-32073, "External Thread is no longer available");
    }
    // Admission belongs to the caller. A steering replacement retains its
    // reservation until this command starts, after the old Turn has stopped.
    if (thread.running || thread.activeTurnId) {
      throw new ExternalCommandError(-32072, "External Thread already has an active operation");
    }
    const turnId = requestedTurnId ?? hostTurnIdSchema.parse(randomUUID());
    const projection: ProjectedTurn = {
      projector: new CodexTurnProjector({
        threadId: thread.id,
        turnId,
        cwd: thread.cwd,
        startedAtMs: Date.now(),
      }),
    };
    const gate = turnProjectionGate();
    thread.running = true;
    thread.activeTurnId = turnId;
    thread.projectedTerminalTurnId = null;
    thread.projectedTurns.set(turnId, projection);
    thread.responseGates.set(turnId, gate);
    thread.ephemeralTurnIds.add(turnId);
    if (descriptor.invocation === "/compact") this.#manualCompactionTurns.set(thread, turnId);
    else this.#manualCompactionTurns.delete(thread);

    const restoreExecutionHost = this.#setExecutionHost(thread, sourceHostId);
    try {
      if (thread.unsubmittedPrewarm && (await this.#externalRuntime.submitPrewarm(thread))) {
        await this.#notifyExternalThreadStarted(thread.thread);
      }
      const result = await commands.execute({
        turnId,
        commandId: descriptor.id,
        ...(arguments_ ? { arguments: arguments_ } : {}),
      });
      if (!result.ok) throw new ExternalCommandError(-32073, result.error.message);
      return { turnId: result.value.turnId, turn: projection.projector.pendingTurn(), gate };
    } catch (error) {
      restoreExecutionHost();
      thread.running = false;
      thread.activeTurnId = null;
      thread.projectedTurns.delete(turnId);
      thread.responseGates.delete(turnId);
      thread.ephemeralTurnIds.delete(turnId);
      this.#manualCompactionTurns.delete(thread);
      gate.resolve();
      this.#signalActiveWorkChanged();
      throw error;
    }
  }

  async #selectExternalThreadModel(
    thread: ExternalThread,
    model: HarnessModelRef,
  ): Promise<HarnessModelSelectionState> {
    if (!thread.session.capabilities.configuration.selectModel) {
      throw new Error("External Harness does not support Model selection");
    }
    const beforeRevision = thread.stateObserver.revision;
    const result = await thread.session.execute({ type: "model.select", model });
    if (!result.ok) throw new Error(result.error.message);
    const state = await thread.stateObserver.waitForChange(beforeRevision);
    const projected = harnessModelSelectionStateSchema.parse({
      ...(state.effectiveModel ? { effectiveModel: state.effectiveModel } : {}),
      ...(state.resolvedModelLabel ? { resolvedModelLabel: state.resolvedModelLabel } : {}),
      ...(state.effectiveThinkingOptionId
        ? { effectiveThinkingOptionId: state.effectiveThinkingOptionId }
        : {}),
      ...(state.availableThinkingOptions
        ? { availableThinkingOptions: state.availableThinkingOptions }
        : {}),
      ...(state.effectivePermissionModeId
        ? { effectivePermissionModeId: state.effectivePermissionModeId }
        : {}),
    });
    if (!projected.effectiveModel)
      throw new Error("Harness Session did not report an effective Model");
    thread.requestedModel = projected.effectiveModel;
    const previousSelection = decodeExternalTransportSelection(
      thread.harnessId,
      thread.transportModelId,
    );
    const transportModelId = encodeExternalTransportSelection(thread.harnessId, {
      ...(previousSelection ?? {}),
      model: projected.effectiveModel,
      ...(projected.effectiveThinkingOptionId
        ? { thinkingOptionId: projected.effectiveThinkingOptionId }
        : {}),
      ...(projected.effectivePermissionModeId
        ? { permissionModeId: projected.effectivePermissionModeId }
        : {}),
    });
    thread.transportModelId = transportModelId;
    try {
      thread.record = await this.#repository.setTransportModelId(
        thread.record.hostThreadId,
        transportModelId,
      );
    } catch (error) {
      this.#diagnose(error);
    }
    thread.thread = externalThreadValue({
      record: { ...thread.record, transportModelId },
      turns: thread.turns,
      sessionId: thread.sessionId,
      running: thread.running,
    });
    return projected;
  }

  async #selectThreadModel(request: JsonRpcRequest): Promise<void> {
    const params = threadModelSelectParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(rpcError(request, -32602, "Invalid Thread Model selection params"));
      return;
    }
    const resolution = await this.#resolveExternalThread(params.data.threadId);
    if (resolution.kind === "error") {
      await this.#writer.json(rpcError(request, resolution.error.code, resolution.error.message));
      return;
    }
    const thread = resolution.kind === "external" ? resolution.thread : undefined;
    if (!thread) {
      await this.#writer.json(
        rpcError(request, -32078, "Model selection requires a current-process external Thread"),
      );
      return;
    }
    try {
      const projected = await this.#selectExternalThreadModel(thread, params.data.model);
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(projected) }));
    } catch (error) {
      await this.#writer.json(
        rpcError(request, -32078, "Model state was not confirmed: " + errorMessage(error)),
      );
    }
  }

  async #selectThreadThinking(request: JsonRpcRequest): Promise<void> {
    const params = threadThinkingSelectParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(
        rpcError(request, -32602, "Invalid Thread Thinking selection params"),
      );
      return;
    }
    const resolution = await this.#resolveExternalThread(params.data.threadId);
    if (resolution.kind === "error") {
      await this.#writer.json(rpcError(request, resolution.error.code, resolution.error.message));
      return;
    }
    const thread = resolution.kind === "external" ? resolution.thread : undefined;
    if (!thread) {
      await this.#writer.json(
        rpcError(request, -32078, "Thinking selection requires a current-process external Thread"),
      );
      return;
    }
    if (!thread.session.capabilities.configuration.selectThinkingOption) {
      await this.#writer.json(
        rpcError(request, -32078, "External Harness does not support Thinking selection"),
      );
      return;
    }
    const beforeRevision = thread.stateObserver.revision;
    const result = await thread.session.execute({
      type: "thinking.select",
      thinkingOptionId: params.data.thinkingOptionId,
    });
    if (!result.ok) {
      await this.#writer.json(rpcError(request, -32078, result.error.message));
      return;
    }
    try {
      const state = await thread.stateObserver.waitForChange(beforeRevision);
      const projected = harnessModelSelectionStateSchema.parse({
        ...(state.effectiveModel ? { effectiveModel: state.effectiveModel } : {}),
        ...(state.resolvedModelLabel ? { resolvedModelLabel: state.resolvedModelLabel } : {}),
        ...(state.effectiveThinkingOptionId
          ? { effectiveThinkingOptionId: state.effectiveThinkingOptionId }
          : {}),
        ...(state.availableThinkingOptions
          ? { availableThinkingOptions: state.availableThinkingOptions }
          : {}),
        ...(state.effectivePermissionModeId
          ? { effectivePermissionModeId: state.effectivePermissionModeId }
          : {}),
      });
      if (!projected.effectiveThinkingOptionId) {
        throw new Error("Harness Session did not report effective Thinking");
      }
      thread.requestedThinkingOptionId = projected.effectiveThinkingOptionId;
      const previousSelection = decodeExternalTransportSelection(
        thread.harnessId,
        thread.transportModelId,
      );
      const effectiveModel =
        projected.effectiveModel ?? thread.requestedModel ?? previousSelection?.model;
      if (effectiveModel) {
        const transportModelId = encodeExternalTransportSelection(thread.harnessId, {
          ...(previousSelection ?? {}),
          model: effectiveModel,
          thinkingOptionId: projected.effectiveThinkingOptionId,
        });
        thread.transportModelId = transportModelId;
        thread.requestedModel = effectiveModel;
        try {
          thread.record = await this.#repository.setTransportModelId(
            thread.record.hostThreadId,
            transportModelId,
          );
        } catch (error) {
          this.#diagnose(error);
        }
        thread.thread = externalThreadValue({
          record: { ...thread.record, transportModelId },
          turns: thread.turns,
          sessionId: thread.sessionId,
          running: thread.running,
        });
      }
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(projected) }));
    } catch (error) {
      await this.#writer.json(
        rpcError(request, -32078, `Thinking state was not confirmed: ${errorMessage(error)}`),
      );
    }
  }

  async #selectThreadPermissionMode(request: JsonRpcRequest): Promise<void> {
    const params = threadPermissionModeSelectParamsSchema.safeParse(request.params);
    if (!params.success) {
      await this.#writer.json(
        rpcError(request, -32602, "Invalid Thread Permission Mode selection params"),
      );
      return;
    }
    const resolution = await this.#resolveExternalThread(params.data.threadId);
    if (resolution.kind === "error") {
      await this.#writer.json(rpcError(request, resolution.error.code, resolution.error.message));
      return;
    }
    const thread = resolution.kind === "external" ? resolution.thread : undefined;
    if (!thread) {
      await this.#writer.json(
        rpcError(
          request,
          -32078,
          "Permission Mode selection requires a current-process external Thread",
        ),
      );
      return;
    }
    if (!thread.session.capabilities.configuration.selectPermissionMode) {
      await this.#writer.json(
        rpcError(request, -32078, "External Harness does not support Permission Mode selection"),
      );
      return;
    }
    if (permissionModeFixedAtCreate(thread.session.capabilities.configuration)) {
      await this.#writer.json(
        rpcError(request, -32078, "Permission Mode is fixed at Session creation"),
      );
      return;
    }
    const beforeRevision = thread.stateObserver.revision;
    const result = await thread.session.execute({
      type: "permissionMode.select",
      permissionModeId: params.data.permissionModeId,
    });
    if (!result.ok) {
      await this.#writer.json(rpcError(request, -32078, result.error.message));
      return;
    }
    try {
      const state = await thread.stateObserver.waitForChange(beforeRevision);
      const projected = harnessConfigurationStateSchema.parse({
        ...(state.effectiveModel ? { effectiveModel: state.effectiveModel } : {}),
        ...(state.resolvedModelLabel ? { resolvedModelLabel: state.resolvedModelLabel } : {}),
        ...(state.effectiveThinkingOptionId
          ? { effectiveThinkingOptionId: state.effectiveThinkingOptionId }
          : {}),
        ...(state.availableThinkingOptions
          ? { availableThinkingOptions: state.availableThinkingOptions }
          : {}),
        ...(state.effectivePermissionModeId
          ? { effectivePermissionModeId: state.effectivePermissionModeId }
          : {}),
      });
      if (!projected.effectivePermissionModeId) {
        throw new Error("Harness Session did not report its current Permission Mode");
      }
      thread.requestedPermissionModeId = projected.effectivePermissionModeId;
      const previousSelection = decodeExternalTransportSelection(
        thread.harnessId,
        thread.transportModelId,
      );
      const effectiveModel =
        projected.effectiveModel ?? thread.requestedModel ?? previousSelection?.model;
      if (effectiveModel) {
        const transportModelId = encodeExternalTransportSelection(thread.harnessId, {
          ...(previousSelection ?? {}),
          model: effectiveModel,
          permissionModeId: projected.effectivePermissionModeId,
        });
        thread.transportModelId = transportModelId;
        thread.requestedModel = effectiveModel;
        thread.thread = externalThreadValue({
          record: { ...thread.record, transportModelId },
          turns: thread.turns,
          sessionId: thread.sessionId,
          running: thread.running,
        });
        // Resume restores the saved selection, so an unsaved change must not
        // be reported as a completed selection.
        try {
          thread.record = await this.#repository.setTransportModelId(
            thread.record.hostThreadId,
            transportModelId,
          );
        } catch (error) {
          this.#diagnose(error);
          await this.#writer.json(
            rpcError(
              request,
              -32078,
              `Permission Mode was applied but could not be saved: ${errorMessage(error)}`,
            ),
          );
          return;
        }
      }
      await this.#writer.json(rpcEnvelope(request, { result: jsonValueSchema.parse(projected) }));
    } catch (error) {
      await this.#writer.json(
        rpcError(
          request,
          -32078,
          `Permission Mode state was not confirmed: ${errorMessage(error)}`,
        ),
      );
    }
  }

  async #startExternalThread(request: JsonRpcRequest, harnessId: ExternalHarnessId): Promise<void> {
    await this.#waitForPlugins();
    const adapter = this.#externalAdapters.get(harnessId);
    if (!adapter) {
      this.#routeObservationTracker.rejectCreate(request.id);
      await this.#writer.json(
        rpcError(request, -32070, `External Harness '${harnessId}' is unavailable`),
      );
      return;
    }
    const params = requestObject(request);
    const route = decodeCreateRoute(request);
    const requestedModel = route && route.harnessId !== "codex" ? route.model : undefined;
    const requestedThinkingOptionId =
      route && route.harnessId !== "codex" ? route.thinkingOptionId : undefined;
    const requestedPermissionModeId =
      route && route.harnessId !== "codex" ? route.permissionModeId : undefined;
    const transportModelId =
      route && route.harnessId === harnessId
        ? route.transportModelId
        : transportModelIdForHarness(harnessId);
    const cwd = params.cwd;
    if (typeof cwd !== "string" || cwd.length === 0) {
      this.#routeObservationTracker.rejectCreate(request.id);
      await this.#writer.json(
        rpcError(request, -32602, `External Harness '${harnessId}' thread/start requires cwd`),
      );
      return;
    }

    const recordInput = createExternalThreadRecordInput({
      harnessId: adapter.harnessId,
      cwd,
      transportModelId,
      ephemeral: params.ephemeral === true,
      historyMode: params.historyMode === "paginated" ? "paginated" : "legacy",
    });
    let record: StoredThreadRecordV1;
    try {
      record = await this.#repository.createProvisional(recordInput);
    } catch {
      this.#routeObservationTracker.rejectCreate(request.id);
      await this.#writer.json(rpcError(request, -32081, "External Thread could not be persisted"));
      return;
    }

    const sessionResult = await adapter.open({
      kind: "create",
      cwd,
      environment: {
        ...(this.#options.environment ?? process.env),
        [DELEGATION_THREAD_ID_ENV]: record.hostThreadId,
      },
      ...(requestedModel ? { model: requestedModel } : {}),
      ...(requestedThinkingOptionId ? { thinkingOptionId: requestedThinkingOptionId } : {}),
      ...(requestedPermissionModeId ? { permissionModeId: requestedPermissionModeId } : {}),
    });
    if (!sessionResult.ok) {
      this.#routeObservationTracker.rejectCreate(request.id);
      await this.#repository.removeProvisional(record.hostThreadId).catch(() => undefined);
      const mapped = mapExternalThreadHarnessError(sessionResult.error, "create");
      await this.#writer.json(rpcError(request, mapped.code, mapped.message));
      return;
    }
    const session = sessionResult.value;
    await this.#externalRuntime.idleRelease.runOperation(record.hostThreadId, async () => {
      try {
        if (session.initialState.nativeRef && params[EXTERNAL_THREAD_PREWARM_PARAM] !== true) {
          record = await this.#repository.commitNative(
            record.hostThreadId,
            session.initialState.nativeRef,
          );
        }
        const thread = externalThreadValue({
          record,
          turns: [],
          sessionId: record.hostThreadId,
        });
        const externalThread = this.#registerExternalThread({
          record,
          session,
          unsubmittedPrewarm: params[EXTERNAL_THREAD_PREWARM_PARAM] === true,
          sessionId: record.hostThreadId,
          thread,
          turns: [],
          ...(requestedModel ? { requestedModel } : {}),
          ...(requestedThinkingOptionId ? { requestedThinkingOptionId } : {}),
          ...(requestedPermissionModeId ? { requestedPermissionModeId } : {}),
        });
        if (params[EXTERNAL_THREAD_PREWARM_PARAM] === true) {
          this.#externalPrewarms.register(externalThread);
        }
        this.#routeObservationTracker.bindCreatedThread(request.id, externalThread.id);
        await this.#writer.json(
          rpcEnvelope(request, {
            result: {
              thread,
              model: transportModelId,
              modelProvider: "codexhost",
              cwd,
              approvalPolicy:
                typeof params.approvalPolicy === "string" ? params.approvalPolicy : "never",
              approvalsReviewer: "user",
              sandbox: sandboxResult(params),
              reasoningEffort: "medium",
              serviceTier: "flex",
              multiAgentMode: "explicitRequestOnly",
              activePermissionProfile: null,
              runtimeWorkspaceRoots: Array.isArray(params.runtimeWorkspaceRoots)
                ? params.runtimeWorkspaceRoots
                : [],
              instructionSources: [],
            },
          }),
        );
        // Draft prewarms remain provisional even when the Harness already has
        // an identity. Only user submission may publish them to Desktop history.
        if (record.state === "ready") await this.#notifyExternalThreadStarted(thread);
      } catch {
        this.#externalRuntime.remove(record.hostThreadId);
        this.#routeObservationTracker.forgetThread(record.hostThreadId);
        await session.close().catch(() => undefined);
        await this.#repository.removeProvisional(record.hostThreadId).catch(() => undefined);
        await this.#writer.json(
          rpcError(request, -32081, "External Thread could not be persisted"),
        );
      }
    });
  }

  #registerExternalThread(input: {
    record: StoredThreadRecordV1;
    session: HarnessSession;
    sessionId: string;
    thread: JsonObject;
    turns: JsonObject[];
    requestedModel?: HarnessModelRef;
    requestedThinkingOptionId?: HarnessThinkingOptionId;
    requestedPermissionModeId?: HarnessPermissionModeId;
    unsubmittedPrewarm?: boolean;
  }): ExternalThread {
    return this.#externalRuntime.register(input);
  }

  #locateExternalThread(threadId: string): Promise<ExternalThreadLocation> {
    return this.#externalRuntime.locate(threadId);
  }

  async #resolveExternalThread(threadId: string): Promise<ExternalThreadResolution> {
    const location = await this.#locateExternalThread(threadId);
    if (location.kind !== "external") return location;
    await this.#waitForPlugins();
    return this.#externalRuntime.resolve(threadId);
  }

  async #writeResolutionError(
    request: JsonRpcRequest,
    resolution: ExternalThreadLocation | ExternalThreadResolution,
  ): Promise<boolean> {
    if (resolution.kind !== "error") return false;
    await this.#writer.json(rpcError(request, resolution.error.code, resolution.error.message));
    return true;
  }

  /** Refresh history before Desktop acts on native Turn boundaries. */
  #refreshExternalThread(thread: ExternalThread): Promise<ExternalThreadRpcError | null> {
    return this.#externalRuntime.refresh(thread);
  }

  #markExternalHistoryRead(thread: ExternalThread, turns: JsonObject[]): void {
    // Live projections have not yet been realigned to the native Turn boundaries.
    if (!thread.historyHydrated) return;
    for (const turnId of thread.steeredTurnIds) {
      if (
        turnId !== thread.activeTurnId &&
        turns.some(
          (turn) =>
            turn.id === turnId &&
            (turn.status === "completed" ||
              turn.status === "failed" ||
              turn.status === "interrupted"),
        )
      ) {
        thread.steeredTurnIds.delete(turnId);
      }
    }
  }

  #persistTerminalIdentity(
    thread: ExternalThread,
    event: Parameters<ExternalThreadRuntime["persistTerminalIdentity"]>[1],
  ): Promise<Error | null> {
    return this.#externalRuntime.persistTerminalIdentity(thread, event);
  }

  async #forkExternalThreadFromRenderer(request: JsonRpcRequest): Promise<void> {
    const parsed = externalThreadForkParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      await this.#writer.json(rpcError(request, -32602, "External Fork request is invalid"));
      return;
    }
    const resolution = await this.#resolveExternalThread(parsed.data.threadId);
    if (await this.#writeResolutionError(request, resolution)) return;
    if (resolution.kind !== "external") {
      await this.#writer.json(rpcError(request, -32078, "Thread is not externally owned"));
      return;
    }
    const result = await executeExternalThreadFork({
      source: resolution.thread,
      fork: {
        threadId: parsed.data.threadId,
        lastTurnId: parsed.data.lastTurnId,
        excludeTurns: true,
      },
      adapters: this.#externalAdapters,
      repository: this.#repository,
      runtime: this.#externalRuntime,
      environment: this.#options.environment ?? process.env,
    });
    if (!result.ok) {
      await this.#writer.json(rpcError(request, result.error.code, result.error.message));
      return;
    }
    await this.#writer.json(
      rpcEnvelope(request, {
        result: externalThreadForkResultSchema.parse({ threadId: result.derived.id }),
      }),
    );
    await this.#notifyExternalThreadStarted(result.thread);
  }

  async #forkExternalThread(
    request: JsonRpcRequest,
    source: ExternalThread,
    fork: DecodedThreadForkRequest,
  ): Promise<void> {
    const result = await executeExternalThreadFork({
      source,
      fork,
      adapters: this.#externalAdapters,
      repository: this.#repository,
      runtime: this.#externalRuntime,
      environment: this.#options.environment ?? process.env,
    });
    if (!result.ok) {
      await this.#writer.json(rpcError(request, result.error.code, result.error.message));
      return;
    }
    const params: JsonObject = {
      ...(fork.sandbox ? { sandbox: fork.sandbox } : {}),
    };
    await this.#writer.json(
      rpcEnvelope(request, {
        result: threadForkResult(result.responseThread, {
          model: result.derived.transportModelId,
          cwd: result.derived.cwd,
          ...(fork.runtimeWorkspaceRoots
            ? { runtimeWorkspaceRoots: fork.runtimeWorkspaceRoots }
            : {}),
          ...(fork.approvalPolicy ? { approvalPolicy: fork.approvalPolicy } : {}),
          sandbox: sandboxResult(params),
          ...(fork.serviceTier ? { serviceTier: fork.serviceTier } : {}),
        }),
      }),
    );
    await this.#notifyExternalThreadStarted(result.thread);
  }

  async #notifyExternalThreadStarted(thread: JsonObject): Promise<void> {
    await this.#writer.json({
      method: "thread/started",
      emittedAtMs: Date.now(),
      params: { thread: { ...thread, turns: [] } },
    });
  }

  async #revertExternalThread(
    request: JsonRpcRequest,
    thread: ExternalThread,
    revert: DecodedThreadRevertRequest,
  ): Promise<void> {
    if (thread.record.historyMode !== "paginated") {
      await this.#writer.json(
        rpcError(request, -32602, "External thread/revert requires paginated history"),
      );
      return;
    }
    const result = await executeExternalThreadRollback({
      derived: thread,
      rollback: { threadId: revert.threadId, numTurns: 1 },
      expectedLastTurnId: revert.beforeTurnId,
      adapters: this.#externalAdapters,
      repository: this.#repository,
      runtime: this.#externalRuntime,
      environment: this.#options.environment ?? process.env,
    });
    if (!result.ok) {
      await this.#writer.json(rpcError(request, result.error.code, result.error.message));
      return;
    }
    await this.#writer.json(rpcEnvelope(request, { result: threadRevertResult(result.thread) }));
    await this.#writer.json({ method: "thread/reverted", params: { threadId: thread.id } });
  }

  async #rollbackExternalThread(
    request: JsonRpcRequest,
    derived: ExternalThread,
    rollback: DecodedThreadRollbackRequest,
  ): Promise<void> {
    const result = await executeExternalThreadRollback({
      derived,
      rollback,
      adapters: this.#externalAdapters,
      repository: this.#repository,
      runtime: this.#externalRuntime,
      environment: this.#options.environment ?? process.env,
    });
    if (!result.ok) {
      await this.#writer.json(rpcError(request, result.error.code, result.error.message));
      return;
    }
    await this.#writer.json(
      rpcEnvelope(request, {
        result: threadRollbackResult(await this.#withExternalSection(result.thread)),
      }),
    );
  }

  async #setExternalThreadName(
    request: JsonRpcRequest,
    location: Extract<ExternalThreadLocation, { kind: "external" }>,
    name: JsonValue | undefined,
  ): Promise<void> {
    if (typeof name !== "string" || name.length === 0) {
      await this.#writer.json(
        rpcError(request, -32602, "External Thread name must be a non-empty string"),
      );
      return;
    }
    let record: StoredThreadRecordV1;
    try {
      record = await this.#repository.setTitle(location.record.hostThreadId, name);
    } catch {
      await this.#writer.json(
        rpcError(request, -32081, "External Thread title could not be persisted"),
      );
      return;
    }
    if (location.thread) {
      location.thread.record = record;
      location.thread.thread.name = name;
      location.thread.thread.updatedAt = unixSeconds();
    }
    await this.#writer.json(rpcEnvelope(request, { result: {} }));
    await this.#writer.json({
      method: "thread/name/updated",
      params: { threadId: location.record.hostThreadId, threadName: name },
    });
  }

  async #deleteExternalThread(
    request: JsonRpcRequest,
    location: Extract<ExternalThreadLocation, { kind: "external" }>,
  ): Promise<void> {
    const thread = location.thread;
    try {
      await this.#repository.removeThread(location.record.hostThreadId);
    } catch {
      await this.#writer.json(rpcError(request, -32081, "External Thread could not be removed"));
      return;
    }
    this.#externalRuntime.remove(location.record.hostThreadId);
    this.#routeObservationTracker.forgetThread(location.record.hostThreadId);
    if (!thread) {
      await this.#writer.json(rpcEnvelope(request, { result: {} }));
      return;
    }
    thread.stateObserver.fault(new Error("External Thread was deleted"));
    try {
      await thread.session.close();
      await thread.outputTask;
      await this.#writer.json(rpcEnvelope(request, { result: {} }));
    } catch (error) {
      await this.#writer.json(
        rpcError(request, -32075, `External Thread could not close: ${errorMessage(error)}`),
      );
    }
  }

  async #readExternalThreadMetadata(
    request: JsonRpcRequest,
    location: Extract<ExternalThreadLocation, { kind: "external" }>,
  ): Promise<void> {
    try {
      const thread = {
        ...(location.thread
          ? { ...location.thread.thread, turns: [] }
          : externalThreadValue({
              record: location.record,
              turns: [],
              sessionId: await this.#repository.sessionTreeId(location.record),
            })),
        ...(await this.#externalSectionFields(location.record.hostThreadId)),
      };
      await this.#writer.json(rpcEnvelope(request, { result: { thread } }));
      if (location.thread) await this.#replayExternalUsage(location.thread);
    } catch {
      await this.#writer.json(
        rpcError(request, -32081, "External Thread metadata could not be read"),
      );
    }
  }

  async #readExternalThread(
    request: JsonRpcRequest,
    thread: ExternalThread,
    includeTurns: boolean,
    historyFresh: boolean,
  ): Promise<void> {
    if (includeTurns && thread.record.historyMode === "paginated") {
      await this.#writer.json(
        rpcError(request, -32602, "Paginated External Threads require thread/turns/list"),
      );
      return;
    }
    if (includeTurns && !thread.running && !historyFresh) {
      const refreshed = await this.#refreshExternalThread(thread);
      if (refreshed) {
        await this.#writer.json(rpcError(request, refreshed.code, refreshed.message));
        return;
      }
    }
    const readTurns = includeTurns ? [...this.#externalHistoryTurns(thread)] : [];
    await this.#writer.json(
      rpcEnvelope(request, {
        result: {
          thread: {
            ...thread.thread,
            ...(await this.#externalSectionFields(thread.record.hostThreadId)),
            turns: readTurns,
          },
        },
      }),
    );
    if (includeTurns) this.#markExternalHistoryRead(thread, readTurns);
    await this.#replayExternalUsage(thread);
  }

  async #listExternalHistory(
    request: JsonRpcRequest,
    thread: ExternalThread,
    params: JsonObject,
    historyFresh: boolean,
  ): Promise<void> {
    const headPage = params.cursor === null || params.cursor === undefined;
    const requiresRefresh =
      request.method === "thread/turns/list" ||
      (request.method === "thread/items/list" && !thread.historyHydrated);
    if (!thread.running && !historyFresh && headPage && requiresRefresh) {
      const refreshed = await this.#refreshExternalThread(thread);
      if (refreshed) {
        await this.#writer.json(rpcError(request, refreshed.code, refreshed.message));
        return;
      }
    }
    try {
      const turns = this.#externalHistoryTurns(thread);
      const result =
        request.method === "thread/turns/list"
          ? listExternalTurns(turns, params)
          : listExternalItems(turns, params);
      await this.#writer.json(rpcEnvelope(request, { result }));
      if (request.method === "thread/turns/list") {
        this.#markExternalHistoryRead(thread, result.data);
      }
    } catch (error) {
      await this.#writer.json(
        rpcError(
          request,
          error instanceof ExternalHistoryRequestError ? -32602 : -32076,
          error instanceof ExternalHistoryRequestError
            ? error.message
            : "External Thread history projection failed",
        ),
      );
    }
  }

  async #resumeExternalThread(
    request: JsonRpcRequest,
    thread: ExternalThread,
    params: JsonObject,
    historyFresh: boolean,
  ): Promise<void> {
    if (!thread.running && !historyFresh) {
      const refreshed = await this.#refreshExternalThread(thread);
      if (refreshed) {
        await this.#writer.json(rpcError(request, refreshed.code, refreshed.message));
        return;
      }
    }
    const turns = [...this.#externalHistoryTurns(thread)];
    const responseThread = {
      ...(await this.#withExternalSection(thread.thread)),
      turns: params.excludeTurns === true ? [] : turns,
    };
    const result = threadForkResult(responseThread, {
      model: thread.transportModelId,
      cwd: thread.cwd,
      runtimeWorkspaceRoots: Array.isArray(params.runtimeWorkspaceRoots)
        ? params.runtimeWorkspaceRoots.filter((value): value is string => typeof value === "string")
        : [],
      approvalPolicy: typeof params.approvalPolicy === "string" ? params.approvalPolicy : "never",
      sandbox: sandboxResult(params),
      ...(typeof params.serviceTier === "string" ? { serviceTier: params.serviceTier } : {}),
    });
    try {
      if (
        params.initialTurnsPage !== undefined &&
        params.initialTurnsPage !== null &&
        !isRecord(params.initialTurnsPage)
      ) {
        throw new ExternalHistoryRequestError("initialTurnsPage must be an object");
      }
      const initialPageParams = isRecord(params.initialTurnsPage)
        ? (params.initialTurnsPage as JsonObject)
        : null;
      const initialTurnsPage = initialPageParams
        ? listExternalTurns(turns, initialPageParams)
        : null;
      const paginated = thread.record.historyMode === "paginated";
      const turnsBackwardsCursor = paginated
        ? listExternalTurns(turns, { limit: 1, itemsView: "notLoaded" }).backwardsCursor
        : null;
      const itemsBackwardsCursor = paginated
        ? listExternalItems(turns, { limit: 1, sortDirection: "desc" }).backwardsCursor
        : null;
      await this.#writer.json(
        rpcEnvelope(request, {
          result: {
            ...result,
            initialTurnsPage,
            turnsBackwardsCursor,
            itemsBackwardsCursor,
          },
        }),
      );
      if (params.excludeTurns !== true) this.#markExternalHistoryRead(thread, turns);
      else if (initialTurnsPage) this.#markExternalHistoryRead(thread, initialTurnsPage.data);
    } catch (error) {
      await this.#writer.json(
        rpcError(
          request,
          error instanceof ExternalHistoryRequestError ? -32602 : -32076,
          error instanceof ExternalHistoryRequestError
            ? error.message
            : "External Thread history projection failed",
        ),
      );
    }
  }

  #externalHistoryTurns(thread: ExternalThread): JsonObject[] {
    const turns = this.#withOpenBackgroundCommands(thread, thread.turns);
    if (!thread.activeTurnId) return turns;
    const active = thread.projectedTurns.get(thread.activeTurnId);
    return active ? [...turns, active.projector.pendingTurn()] : turns;
  }

  /**
   * Background commands whose native task has not settled overlay their live
   * wire state (`inProgress`, accumulated output) onto the served history Turn
   * they detached from, replacing the historical Item or appending to the Turn.
   */
  #withOpenBackgroundCommands(thread: ExternalThread, turns: JsonObject[]): JsonObject[] {
    return turns.map((turn) => {
      const open = thread.projectedTurns
        .get((turn as { id: HostTurnId }).id)
        ?.projector.openDetachedWireItems();
      if (!open || open.size === 0) return turn;
      const remaining = new Map(open);
      const items = (turn as { items: JsonObject[] }).items.map((item) => {
        const id = (item as { id: HostItemId }).id;
        const live = remaining.get(id);
        if (!live) return item;
        remaining.delete(id);
        return live;
      });
      return {
        ...turn,
        items: [...items, ...remaining.values()],
      };
    });
  }

  #externalThreadBusy(thread: ExternalThread): boolean {
    return thread.running || this.#externalSteering.hasPending(thread.id);
  }

  async #startDelegatedExternalTurn(
    thread: ExternalThread,
    text: string,
    requestedTurnId: string,
  ): Promise<void> {
    if (this.#externalThreadBusy(thread)) {
      throw new Error("External Thread already has an active Turn");
    }
    const turnId = hostTurnIdSchema.parse(requestedTurnId);
    const projection: ProjectedTurn = {
      projector: new CodexTurnProjector({
        threadId: thread.id,
        turnId,
        cwd: thread.cwd,
        startedAtMs: Date.now(),
        initialInput: [{ type: "text", text }],
      }),
    };
    thread.running = true;
    thread.activeTurnId = turnId;
    thread.projectedTerminalTurnId = null;
    thread.projectedTurns.set(turnId, projection);
    thread.responseGates.set(turnId, {
      promise: Promise.resolve(),
      resolve: () => undefined,
    });
    const result = await thread.session.execute({
      type: "turn.start",
      turnId,
      input: [{ type: "text", text }],
    });
    if (!result.ok) {
      thread.running = false;
      thread.activeTurnId = null;
      thread.projectedTurns.delete(turnId);
      thread.responseGates.delete(turnId);
      this.#signalActiveWorkChanged();
      throw new Error(result.error.message);
    }
  }

  async #startExternalTurn(request: JsonRpcRequest, thread: ExternalThread): Promise<void> {
    if (this.#externalThreadBusy(thread) || this.#pendingExternalCommandRequests.has(thread.id)) {
      await this.#writer.json(
        rpcError(request, -32072, "External Thread already has an active Turn"),
      );
      return;
    }
    const params = requestObject(request);
    if (typeof params.model === "string") {
      let selection: ReturnType<typeof decodeExternalTransportSelection>;
      try {
        selection = decodeExternalTransportSelection(thread.harnessId, params.model);
      } catch (error) {
        await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
        return;
      }
      if (selection === null) {
        const model = harnessModelRefSchema.safeParse({ id: params.model });
        if (!model.success) {
          await this.#writer.json(
            rpcError(request, -32602, "Turn Model does not belong to the Thread Harness"),
          );
          return;
        }
        try {
          await this.#selectExternalThreadModel(thread, model.data);
        } catch (error) {
          await this.#writer.json(
            rpcError(request, -32078, "Turn Model could not be selected: " + errorMessage(error)),
          );
          return;
        }
      }
    }
    let text: string;
    try {
      text = requestText(params);
    } catch (error) {
      await this.#writer.json(rpcError(request, -32602, errorMessage(error)));
      return;
    }
    try {
      const started = await this.#beginExternalInputTurn(
        thread,
        text,
        undefined,
        typeof params.clientUserMessageId === "string" ? params.clientUserMessageId : undefined,
        params[THREAD_REFERENCE_SOURCE_HOST_PARAM],
      );
      try {
        await this.#writer.json(rpcEnvelope(request, { result: { turn: started.turn } }));
      } finally {
        started.gate.resolve();
      }
    } catch (error) {
      await this.#writer.json(
        rpcError(
          request,
          error instanceof ExternalSteerError || error instanceof ExternalCommandError
            ? error.code
            : -32073,
          errorMessage(error),
        ),
      );
    }
  }

  async #steerExternalTurn(request: JsonRpcRequest, thread: ExternalThread): Promise<void> {
    try {
      const started = await this.#externalSteering.run(
        thread,
        requestObject(request),
        (text, assertActive) =>
          this.#beginExternalInputTurn(
            thread,
            text,
            assertActive,
            typeof requestObject(request).clientUserMessageId === "string"
              ? (requestObject(request).clientUserMessageId as string)
              : undefined,
            requestObject(request)[THREAD_REFERENCE_SOURCE_HOST_PARAM],
          ),
        (input) => this.#insertExternalInput(thread, input),
      );
      try {
        await this.#writer.json(
          rpcEnvelope(request, {
            result: { turnId: started.turnId, delivery: started.delivery },
          }),
        );
      } finally {
        started.gate.resolve();
      }
    } catch (error) {
      await this.#writer.json(
        rpcError(
          request,
          error instanceof ExternalSteerError || error instanceof ExternalCommandError
            ? error.code
            : -32074,
          errorMessage(error),
        ),
      );
    } finally {
      this.#signalActiveWorkChanged();
    }
  }

  /** Native same-Turn input; `insertNativeSteer` owns the delivery and its fallback signal. */
  async #insertExternalInput(
    thread: ExternalThread,
    input: { turnId: HostTurnId; text: string; clientUserMessageId?: string },
  ): Promise<{ turnId: HostTurnId; gate: TurnProjectionGate }> {
    await insertNativeSteer(thread, input, {
      project: async (turnId, item, clientUserMessageId) => {
        const projection = this.#projectedTurn(thread, turnId);
        if (clientUserMessageId) {
          projection.projector.bindUserMessageClientId(item.itemId, clientUserMessageId);
        }
        await this.#projectHarnessOutput(thread, {
          kind: "event",
          event: { type: "item.started", turnId, item },
        });
        await this.#projectHarnessOutput(thread, {
          kind: "event",
          event: {
            type: "item.completed",
            turnId,
            snapshot: { item, outcome: { status: "succeeded" } },
          },
        });
      },
      diagnose: (error) => this.#diagnose(error),
    });
    return {
      turnId: input.turnId,
      gate: { promise: Promise.resolve(), resolve: () => undefined },
    };
  }

  /** Keep command restoration and dispatch identical for start and steer submissions. */
  async #beginExternalInputTurn(
    thread: ExternalThread,
    inputText: string,
    assertActive?: () => void,
    clientUserMessageId?: string,
    sourceHostId?: unknown,
  ): Promise<{ turnId: HostTurnId; turn: JsonObject; gate: TurnProjectionGate }> {
    const text = restoreHarnessCommandMentions(inputText);
    const commands = thread.session.commands;
    if (!commands || !isExternalCommandCandidate(text)) {
      assertActive?.();
      return this.#beginExternalTurn(thread, text, clientUserMessageId, sourceHostId);
    }
    this.#pendingExternalCommandRequests.add(thread.id);
    try {
      const adapter = this.#externalAdapters.get(thread.harnessId);
      const command = await resolveExternalCommand(commands, text, {
        liveCatalogPending: (catalog) =>
          adapter?.liveCommandCatalog === true &&
          !isLiveCommandCatalog(catalog, adapter.commandCatalog ?? { commands: [] }),
      });
      assertActive?.();
      if (!command) {
        this.#pendingExternalCommandRequests.delete(thread.id);
        return await this.#beginExternalTurn(thread, text, clientUserMessageId, sourceHostId);
      }
      return await this.#beginExternalCommand(
        thread,
        command.descriptor,
        command.arguments,
        undefined,
        sourceHostId,
      );
    } catch (error) {
      if (error instanceof ExternalCommandError || error instanceof ExternalSteerError) throw error;
      this.#diagnose(error);
      throw new ExternalCommandError(
        -32073,
        `External Harness command failed: ${errorMessage(error)}`,
      );
    } finally {
      this.#pendingExternalCommandRequests.delete(thread.id);
    }
  }

  /** Apply context before native execution; a rejected start restores the prior identity. */
  #setExecutionHost(thread: ExternalThread, sourceHostId: unknown): () => void {
    const previousHostId = this.#executionHosts.get(thread);
    if (
      typeof sourceHostId === "string" &&
      sourceHostId.length > 0 &&
      sourceHostId.length <= 1024 &&
      !/[\u0000-\u0020\u007f]/u.test(sourceHostId)
    ) {
      this.#executionHosts.set(thread, sourceHostId);
    } else {
      this.#executionHosts.delete(thread);
    }
    return () => {
      if (previousHostId === undefined) this.#executionHosts.delete(thread);
      else this.#executionHosts.set(thread, previousHostId);
    };
  }

  async #beginExternalTurn(
    thread: ExternalThread,
    text: string,
    clientUserMessageId?: string,
    sourceHostId?: unknown,
  ): Promise<{
    turnId: HostTurnId;
    turn: JsonObject;
    gate: TurnProjectionGate;
  }> {
    if (this.#closeRequested || this.#externalRuntime.get(thread.id) !== thread) {
      throw new ExternalSteerError(-32073, "External Thread is no longer available");
    }
    if (
      thread.running ||
      thread.activeTurnId ||
      this.#pendingExternalCommandRequests.has(thread.id)
    ) {
      throw new ExternalSteerError(-32072, "External Thread already has an active Turn");
    }
    const turnId = hostTurnIdSchema.parse(randomUUID());
    const startedAtMs = Date.now();
    const projection: ProjectedTurn = {
      projector: new CodexTurnProjector({
        threadId: thread.id,
        turnId,
        cwd: thread.cwd,
        startedAtMs,
        ...(this.#options.externalOnly
          ? {
              initialInput: [{ type: "text" as const, text }],
              ...(clientUserMessageId ? { clientUserMessageId } : {}),
            }
          : {}),
      }),
    };
    const gate = turnProjectionGate();
    thread.running = true;
    thread.activeTurnId = turnId;
    thread.projectedTerminalTurnId = null;
    thread.projectedTurns.set(turnId, projection);
    thread.responseGates.set(turnId, gate);

    const restoreExecutionHost = this.#setExecutionHost(thread, sourceHostId);
    try {
      if (thread.unsubmittedPrewarm && (await this.#externalRuntime.submitPrewarm(thread))) {
        await this.#notifyExternalThreadStarted(thread.thread);
      }
      const result = await thread.session.execute({
        type: "turn.start",
        turnId,
        input: [{ type: "text", text: rewriteDelegationMentionText(text) }],
      });
      if (!result.ok) throw new ExternalSteerError(-32073, result.error.message);
      return { turnId, turn: projection.projector.pendingTurn(), gate };
    } catch (error) {
      restoreExecutionHost();
      thread.running = false;
      thread.activeTurnId = null;
      thread.projectedTurns.delete(turnId);
      thread.responseGates.delete(turnId);
      gate.resolve();
      this.#signalActiveWorkChanged();
      throw error;
    }
  }

  /**
   * Desktop's "stop all background terminals". An unloaded Thread has no
   * Session and therefore no background terminals; a loaded Harness that
   * cannot stop them, or a failed stop, is an error rather than success.
   */
  async #cleanExternalBackgroundTerminals(
    request: JsonRpcRequest,
    threadId: string,
  ): Promise<void> {
    const thread = this.#externalRuntime.get(threadId);
    if (!thread) {
      await this.#writer.json(rpcEnvelope(request, { result: {} }));
      return;
    }
    if (!thread.session.stopBackgroundWork) {
      await this.#writer.json(
        rpcError(
          request,
          -32076,
          "External Harness does not support stopping background terminals",
        ),
      );
      return;
    }
    const result = await thread.session.stopBackgroundWork();
    if (!result.ok) {
      await this.#writer.json(rpcError(request, -32083, result.error.message));
      return;
    }
    await this.#writer.json(rpcEnvelope(request, { result: {} }));
  }

  async #interruptExternalTurn(
    request: JsonRpcRequest,
    thread: ExternalThread,
    requestedTurnId: JsonValue | undefined,
  ): Promise<void> {
    if (typeof requestedTurnId === "string")
      this.#externalSteering.interrupt(thread.id, requestedTurnId);
    if (
      typeof requestedTurnId !== "string" ||
      !thread.running ||
      thread.activeTurnId !== requestedTurnId
    ) {
      await this.#writer.json(
        rpcError(request, -32074, "External turn/interrupt must reference the active Turn"),
      );
      return;
    }
    const turnId = thread.activeTurnId;
    const cancellationGate = turnProjectionGate();
    const gate: TurnProjectionGate = {
      promise: Promise.all([
        thread.responseGates.get(turnId)?.promise ?? Promise.resolve(),
        cancellationGate.promise,
      ]).then(() => undefined),
      resolve: cancellationGate.resolve,
    };
    thread.responseGates.set(turnId, gate);
    const result = await thread.session.execute({ type: "turn.cancel", turnId });
    if (!result.ok) {
      try {
        await this.#writer.json(rpcError(request, -32074, result.error.message));
      } finally {
        gate.resolve();
      }
      return;
    }
    try {
      await this.#writer.json(rpcEnvelope(request, { result: {} }));
    } finally {
      gate.resolve();
    }
  }

  async #consumeHarnessOutputs(thread: ExternalThread): Promise<void> {
    try {
      for await (const output of thread.session.outputs) {
        await this.#externalRuntime.idleRelease.consumeOutput(thread, () =>
          this.#projectHarnessOutput(thread, output),
        );
      }
    } catch (error) {
      this.#externalRuntime.idleRelease.outputFailed(thread);
      this.#diagnose(error);
      this.#externalSteering.fault(thread.id, new Error(errorMessage(error)));
      await settleExternalOutputFailure(
        thread,
        error,
        (output) => this.#projectHarnessOutput(thread, output),
        (failure) => this.#diagnose(failure),
      );
    } finally {
      this.#externalSteering.fault(
        thread.id,
        new Error("External Harness output ended before replacement"),
      );
    }
  }

  async #projectHarnessOutput(thread: ExternalThread, output: HarnessOutput): Promise<void> {
    if (output.kind === "interaction") {
      if (output.interaction.type === "approval") {
        await this.#projectApproval(thread, output.interaction);
      } else {
        await this.#projectQuestion(thread, output.interaction);
      }
      return;
    }
    let event = output.event;
    if (this.#meterTurnTiming(thread, event)) await this.#notifyThreadUsage(thread);
    if (event.type === "item.started" && event.item.type === "subagentDelegation") {
      event = {
        ...event,
        item: {
          ...event.item,
          subagents: await Promise.all(
            event.item.subagents.map((subagent) =>
              this.#materializeSubagent(thread, subagent).catch(() => subagent),
            ),
          ),
        },
      };
    }
    if (event.type === "item.updated" && event.update.type === "subagents.replace") {
      event = {
        ...event,
        update: {
          ...event.update,
          subagents: await Promise.all(
            event.update.subagents.map((subagent) =>
              this.#materializeSubagent(thread, subagent).catch(() => subagent),
            ),
          ),
        },
      };
    }
    if (event.type === "item.completed" && event.snapshot.item.type === "subagentDelegation") {
      event = {
        ...event,
        snapshot: {
          ...event.snapshot,
          item: {
            ...event.snapshot.item,
            subagents: await Promise.all(
              event.snapshot.item.subagents.map((subagent) =>
                this.#materializeSubagent(thread, subagent).catch(() => subagent),
              ),
            ),
          },
        },
      };
    }
    if (event.type === "session.state.changed") {
      try {
        if (event.state.nativeRef) {
          const nativeRef = thread.record.nativeSessionRef ?? thread.stateObserver.state.nativeRef;
          if (
            nativeRef &&
            (nativeRef.harnessId !== event.state.nativeRef.harnessId ||
              nativeRef.nativeSessionId !== event.state.nativeRef.nativeSessionId)
          ) {
            throw new Error("External Session changed Native identity");
          }
          if (!thread.record.nativeSessionRef && !thread.unsubmittedPrewarm) {
            thread.record = await this.#repository.commitNative(thread.id, event.state.nativeRef);
            await this.#notifyExternalThreadStarted(thread.thread);
          }
        }
        thread.stateObserver.update(event.state);
      } catch (error) {
        thread.persistenceError = error instanceof Error ? error : new Error(errorMessage(error));
        thread.stateObserver.fault(thread.persistenceError);
        this.#diagnose("External Session state could not be persisted");
      }
      return;
    }
    if (event.type === "session.usage.changed") {
      if (this.#externalRuntime.get(thread.id) !== thread) return;
      thread.latestUsage = event.usage;
      if (event.usage === null) {
        thread.usageTurnId = null;
        await this.#writer.json({
          method: THREAD_USAGE_UPDATED_METHOD,
          params: { threadId: thread.id },
        });
        return;
      }
      const turnId = event.observedForTurnId
        ? this.#isKnownExternalTurn(thread, event.observedForTurnId)
          ? event.observedForTurnId
          : null
        : (thread.activeTurnId ?? this.#latestCompletedTurnId(thread));
      thread.usageTurnId = turnId;
      if (turnId) {
        await this.#waitForTurnResponse(thread, turnId);
        await this.#writeExternalUsage(thread, turnId);
      }
      await this.#writer.json({
        method: THREAD_USAGE_UPDATED_METHOD,
        params: { threadId: thread.id },
      });
      return;
    }
    if (event.type === "usage.request" || event.type === "usage.history") {
      if (this.#externalRuntime.get(thread.id) !== thread) return;
      if (event.type === "usage.request") {
        const changed = thread.usageMeter.recordRequest(event.request, thread.activeTurnId);
        // Replayed history is announced once by the following usage.history.
        if (!changed || event.request.historical === true) return;
      } else {
        thread.usageMeter.recordHistory(event.complete);
      }
      await this.#notifyThreadUsage(thread);
      return;
    }
    if (event.type === "subagent.transcript.changed") {
      const nativeSubagentId = event.nativeSubagentId;
      const record = (await this.#repository.list()).find(
        (candidate) =>
          candidate.subagent?.parentHostThreadId === thread.id &&
          candidate.subagent.nativeSubagentId === nativeSubagentId &&
          candidate.nativeSessionRef?.nativeSessionId ===
            thread.record.nativeSessionRef?.nativeSessionId,
      );
      if (record) await this.#refreshOpenSubagentThread(record.hostThreadId, false);
      return;
    }
    if (event.type === "subagent.state.changed") {
      const nativeSubagentId = event.nativeSubagentId;
      const record = (await this.#repository.list()).find(
        (candidate) =>
          candidate.subagent?.parentHostThreadId === thread.id &&
          candidate.subagent.nativeSubagentId === nativeSubagentId &&
          candidate.nativeSessionRef?.nativeSessionId ===
            thread.record.nativeSessionRef?.nativeSessionId,
      );
      if (!record) return;
      const status = event.status === "pending" || event.status === "running" ? "active" : "idle";
      this.#trackRunningSubagent(thread.id, record.hostThreadId, status);
      await this.#setSubagentThreadStatus(record.hostThreadId, status);
      if (!thread.running && !thread.activeTurnId && !this.#hasRunningSubagents(thread.id)) {
        await this.#setThreadStatus(thread, { type: "idle" });
      }
      return;
    }
    if (event.type === "session.faulted") {
      this.#externalSteering.fault(thread.id, new Error(event.error.message));
      thread.stateObserver.fault(new Error(event.error.message));
      this.#externalRuntime.markSessionUnavailable(thread);
      this.#diagnose(`${thread.harnessId} Harness Session faulted: ${event.error.message}`);
      // Idle Threads must not keep a dead Session; the next open restores from disk.
      if (
        !thread.running &&
        !thread.activeTurnId &&
        !this.#hasRunningSubagents(thread.id) &&
        !thread.session.hasBackgroundWork?.()
      ) {
        // Do not await: discard drains this outputTask. Runtime synchronously admits the
        // cleanup to its Thread lifecycle barrier so resolve/refresh cannot bypass it.
        void this.#externalRuntime.discardUnavailableIdle(thread);
      }
      return;
    }

    if (event.type === "turn.autonomous.started") {
      if (thread.running || thread.activeTurnId) {
        throw new Error("External autonomous Turn started while another Turn is active");
      }
      const projection: ProjectedTurn = {
        projector: new CodexTurnProjector({
          threadId: thread.id,
          turnId: event.turnId,
          cwd: thread.cwd,
          startedAtMs: Date.now(),
          initialInput: event.input,
        }),
      };
      thread.running = true;
      thread.activeTurnId = event.turnId;
      thread.projectedTerminalTurnId = null;
      thread.projectedTurns.set(event.turnId, projection);
      thread.responseGates.set(event.turnId, {
        promise: Promise.resolve(),
        resolve: () => undefined,
      });
      // Real native work is no longer a disposable draft, even when it was
      // initiated by the Harness rather than a Desktop submission.
      if (thread.unsubmittedPrewarm && (await this.#externalRuntime.submitPrewarm(thread))) {
        await this.#notifyExternalThreadStarted(thread.thread);
      }
      return;
    }

    if (event.type === "turn.completed" && thread.pendingSteerProjections.size > 0) {
      await Promise.allSettled([...thread.pendingSteerProjections]);
    }
    const projection = this.#projectedTurn(thread, event.turnId);
    await this.#waitForTurnResponse(thread, event.turnId);
    if (
      event.type === "interaction.closed" &&
      thread.ignoredInteractionIds.delete(event.interactionId)
    ) {
      return;
    }
    if (event.type === "interaction.closed") {
      await this.#resolveDesktopApproval(event.interactionId);
      await this.#resolveDesktopQuestion(event.interactionId);
    }
    const ephemeralTurn =
      event.type === "turn.completed" &&
      (event.ephemeral === true || thread.ephemeralTurnIds.has(event.turnId));
    if (event.type === "turn.completed" && !ephemeralTurn) {
      const persistenceError = await this.#persistTerminalIdentity(thread, event);
      if (persistenceError) {
        this.#externalRuntime.idleRelease.outputFailed(thread);
        event = {
          type: "turn.completed",
          turnId: event.turnId,
          outcome: {
            status: "failed",
            error: {
              code: "internalError",
              message: "External Turn identity could not be persisted",
              retryable: false,
            },
          },
        };
      }
    }
    const result = projection.projector.project(event as ProjectableHostEvent);
    if (event.type === "turn.started") {
      await this.#setThreadStatus(thread, { type: "active", activeFlags: [] });
    }
    if (event.type === "turn.completed") {
      if (!result.completedTurn) throw new Error("Turn projector returned no completed Turn");
      const completedAt = Math.floor(Date.now() / 1000);
      if (ephemeralTurn) {
        thread.ephemeralTurnIds.delete(event.turnId);
        this.#manualCompactionTurns.delete(thread);
      } else {
        thread.turns.push(result.completedTurn);
        thread.projectedTerminalTurnId = event.turnId;
        thread.thread.updatedAt = completedAt;
        thread.thread.recencyAt = completedAt;
      }
      thread.historyHydrated = false;
      thread.running = false;
      thread.activeTurnId = null;
      // Detached Items (native background commands) settle on this Turn later.
      if (!projection.projector.hasOpenDetachedItems) thread.projectedTurns.delete(event.turnId);
      thread.responseGates.delete(event.turnId);
      const actionStatus = String(result.completedTurn.status);
      void this.#turnActions
        .completed(thread.id, event.turnId, actionStatus)
        .then((suppressAutoPush) =>
          ephemeralTurn || suppressAutoPush
            ? undefined
            : this.#gitWorkflow.completed(thread.id, event.turnId, actionStatus),
        )
        .catch((error) => this.#diagnose(error));
      thread.pendingSteerProjections.clear();
      this.#signalActiveWorkChanged();
      const delegation = await this.#repository.getDelegationByChild(thread.record.hostThreadId);
      if (delegation) {
        const status =
          result.completedTurn.status === "failed"
            ? "failed"
            : result.completedTurn.status === "interrupted"
              ? "interrupted"
              : "completed";
        await this.#repository.setDelegationStatus(delegation.delegationId, status);
      }
    }
    if (
      event.type === "item.started" &&
      event.item.type === "contextCompaction" &&
      this.#manualCompactionTurns.get(thread) === event.turnId
    ) {
      // Only explicit /compact commands are manual; other commands can auto-compact.
      // Desktop labels a compaction manual only
      // through its own client registration, which must precede item/started.
      await this.#writer.json({
        method: THREAD_MANUAL_COMPACTION_STARTED_METHOD,
        params: { threadId: thread.id, turnId: event.turnId },
      });
    }
    if (
      event.type === "item.completed" &&
      projection.projector.completed &&
      !projection.projector.hasOpenDetachedItems
    ) {
      thread.projectedTurns.delete(event.turnId);
    }
    for (const message of result.messages) await this.#writer.json(message);
    if (event.type === "turn.completed") {
      await this.#setThreadStatus(
        thread,
        this.#hasRunningSubagents(thread.id)
          ? { type: "active", activeFlags: [] }
          : { type: "idle" },
      );
      this.#externalSteering.terminal(thread.id, event.turnId, event.outcome);
    }
  }

  async #materializeSubagent(
    parent: ExternalThread,
    subagent: HostSubagentState,
  ): Promise<HostSubagentState> {
    if (!subagent.nativeSubagentId || !parent.record.nativeSessionRef) return subagent;
    const status =
      subagent.status === "pending" || subagent.status === "running" ? "active" : "idle";
    const record = await this.#repository.materializeSubagent(parent.record, subagent);
    if (!record) return subagent;
    if (this.#subagentThreadStatuses.has(record.hostThreadId)) {
      this.#trackRunningSubagent(parent.id, record.hostThreadId, status);
      await this.#setSubagentThreadStatus(record.hostThreadId, status);
      return { ...subagent, subagentId: record.hostThreadId };
    }
    const thread = externalThreadValue({
      record,
      turns: [],
      sessionId: parent.sessionId,
      running: status === "active",
    });
    this.#subagentThreadStatuses.set(record.hostThreadId, status);
    this.#trackRunningSubagent(parent.id, record.hostThreadId, status);
    await this.#writer.json({
      method: "thread/started",
      emittedAtMs: Date.now(),
      params: { thread },
    });
    return { ...subagent, subagentId: record.hostThreadId };
  }

  async #refreshOpenSubagentThread(threadId: string, terminal = true): Promise<void> {
    await this.#desktopRequests.run(threadId, async () => {
      await this.#refreshOpenSubagentThreadBody(threadId, terminal);
    });
  }

  async #refreshOpenSubagentThreadBody(threadId: string, terminal: boolean): Promise<void> {
    const child = this.#externalRuntime.get(threadId);
    if (!child) return;
    const previousItems = new Map(
      child.turns.flatMap((turn) =>
        Array.isArray(turn.items)
          ? turn.items.flatMap((item) =>
              isRecord(item) && typeof item.id === "string"
                ? ([[item.id, JSON.stringify(item)]] as const)
                : [],
            )
          : [],
      ),
    );
    const refreshed = await this.#refreshExternalThread(child);
    if (refreshed) {
      this.#diagnose(refreshed.message);
      return;
    }
    const emittedAtMs = Date.now();
    for (const turn of child.turns) {
      if (typeof turn.id !== "string" || !Array.isArray(turn.items)) continue;
      const changedItems = turn.items.filter(
        (item): item is JsonObject =>
          isRecord(item) &&
          typeof item.id === "string" &&
          previousItems.get(item.id) !== JSON.stringify(item),
      );
      if (changedItems.length > 0) {
        await this.#writer.json({
          method: "turn/started",
          emittedAtMs,
          params: {
            threadId,
            turn: {
              ...turn,
              status: "inProgress",
              completedAt: null,
              durationMs: null,
            },
          },
        });
      }
      for (const item of changedItems) {
        await this.#writer.json({
          method: "item/started",
          emittedAtMs,
          params: {
            threadId,
            turnId: turn.id,
            startedAtMs: emittedAtMs,
            item,
          },
        });
        await this.#writer.json({
          method: "item/completed",
          emittedAtMs,
          params: {
            threadId,
            turnId: turn.id,
            completedAtMs: emittedAtMs,
            item,
          },
        });
      }
      if (terminal) {
        await this.#writer.json({
          method: "turn/completed",
          emittedAtMs,
          params: { threadId, turn },
        });
      }
    }
  }

  #trackRunningSubagent(
    parentThreadId: string,
    childThreadId: string,
    status: "active" | "idle",
  ): void {
    let running = this.#runningSubagentsByParent.get(parentThreadId);
    if (status === "active") {
      if (!running) {
        running = new Set();
        this.#runningSubagentsByParent.set(parentThreadId, running);
      }
      running.add(childThreadId);
      return;
    }
    if (!running) return;
    running.delete(childThreadId);
    if (running.size === 0) this.#runningSubagentsByParent.delete(parentThreadId);
    this.#signalActiveWorkChanged();
  }

  #hasRunningSubagents(parentThreadId: string): boolean {
    return (this.#runningSubagentsByParent.get(parentThreadId)?.size ?? 0) > 0;
  }

  async #setSubagentThreadStatus(threadId: string, status: "active" | "idle"): Promise<void> {
    const previousStatus = this.#subagentThreadStatuses.get(threadId);
    const child = this.#externalRuntime.get(threadId);
    if (child) {
      child.running = status === "active";
      if (status === "idle") child.historyHydrated = false;
      child.thread = externalThreadValue({
        record: child.record,
        turns: child.turns,
        sessionId: child.sessionId,
        running: child.running,
      });
    }
    if (status === "idle" && previousStatus === "active") {
      for (const [index, waitMs] of SUBAGENT_TERMINAL_REFRESH_DELAYS_MS.entries()) {
        if (waitMs > 0) await delay(waitMs);
        await this.#refreshOpenSubagentThread(
          threadId,
          index === SUBAGENT_TERMINAL_REFRESH_DELAYS_MS.length - 1,
        );
      }
    }
    if (previousStatus === status) return;
    this.#subagentThreadStatuses.set(threadId, status);
    await this.#writer.json({
      method: "thread/status/changed",
      emittedAtMs: Date.now(),
      params: {
        threadId,
        status: status === "active" ? { type: "active", activeFlags: [] } : { type: "idle" },
      },
    });
  }

  async #projectApproval(
    thread: ExternalThread,
    interaction: HostApprovalInteraction,
  ): Promise<void> {
    const projection = this.#projectedTurn(thread, interaction.turnId);
    await this.#waitForTurnResponse(thread, interaction.turnId);
    let result: CodexApprovalProjection;
    try {
      result = projection.projector.projectApproval(
        interaction,
        this.#pluginDescriptors.find(({ id }) => id === thread.harnessId)?.name ??
          this.#pluginDescriptors.find(({ id }) => id === thread.harnessId)?.name ??
          thread.harnessId,
      );
    } catch (error) {
      this.#diagnose(error);
      thread.ignoredInteractionIds.add(interaction.interactionId);
      const denied = await this.#denyApproval(thread, interaction);
      if (!denied) thread.ignoredInteractionIds.delete(interaction.interactionId);
      return;
    }
    for (const message of result.messages) await this.#writer.json(message);

    const requestId = this.#allocateApprovalRequestId();
    const pending: PendingDesktopApproval = {
      thread,
      interaction,
      projection: result.approvalRequest,
    };
    this.#pendingDesktopApprovals.set(requestId, pending);
    try {
      await this.#writer.json({ id: requestId, ...result.approvalRequest.request });
    } catch (error) {
      this.#pendingDesktopApprovals.delete(requestId);
      await this.#denyApproval(thread, interaction);
      throw error;
    }
  }

  async #handleDesktopApprovalResponse(value: JsonValue): Promise<boolean> {
    if (!isRecord(value) || !isHostApprovalRequestId(value.id)) return false;
    const requestId = value.id;
    const pending = this.#pendingDesktopApprovals.get(requestId);
    if (!pending) return true;
    return this.#externalRuntime.idleRelease.runOperation(pending.thread.id, async () => {
      if (
        this.#externalRuntime.get(pending.thread.id) !== pending.thread ||
        this.#externalRuntime.idleRelease.failure(pending.thread)
      )
        return true;
      if (this.#options.externalOnly)
        await this.#resolveDesktopApproval(pending.interaction.interactionId);
      else this.#pendingDesktopApprovals.delete(requestId);

      let response: HostApprovalResponse;
      try {
        response =
          "error" in value
            ? pending.projection.denyResponse
            : pending.projection.parseResponse(value.result);
      } catch (error) {
        this.#diagnose(error);
        response = pending.projection.denyResponse;
      }
      const result = await pending.thread.session.execute({
        type: "interaction.respond",
        interactionId: pending.interaction.interactionId,
        response,
      });
      if (!result.ok && result.error.code !== "invalidState") {
        this.#diagnose(`Approval response failed: ${result.error.message}`);
        const cancelled = await pending.thread.session.execute({
          type: "turn.cancel",
          turnId: pending.interaction.turnId,
        });
        if (!cancelled.ok && cancelled.error.code !== "invalidState") {
          this.#diagnose(`Approval fail-closed cancellation failed: ${cancelled.error.message}`);
        }
      }
      return true;
    });
  }

  async #denyApproval(
    thread: ExternalThread,
    interaction: HostApprovalInteraction,
  ): Promise<boolean> {
    const denyActions = interaction.actions.filter(({ effect }) => effect === "deny");
    if (denyActions.length !== 1) {
      const cancelled = await thread.session.execute({
        type: "turn.cancel",
        turnId: interaction.turnId,
      });
      if (!cancelled.ok) {
        this.#diagnose(`Unsupported Approval cancellation failed: ${cancelled.error.message}`);
      }
      return cancelled.ok;
    }
    const action = denyActions[0];
    if (!action) return false;
    const denied = await thread.session.execute({
      type: "interaction.respond",
      interactionId: interaction.interactionId,
      response: { type: "approval", actionId: action.id },
    });
    if (!denied.ok) {
      this.#diagnose(`Unsupported Approval denial failed: ${denied.error.message}`);
    }
    return denied.ok;
  }

  async #resolveDesktopApproval(interactionId: HostInteractionId): Promise<void> {
    for (const [requestId, pending] of this.#pendingDesktopApprovals) {
      if (pending.interaction.interactionId !== interactionId) continue;
      this.#pendingDesktopApprovals.delete(requestId);
      await this.#writer.json({
        method: "serverRequest/resolved",
        params: { threadId: pending.thread.id, requestId },
      });
    }
  }

  #allocateApprovalRequestId(): HostApprovalRequestId {
    if (this.#nextApprovalRequestId < HOST_APPROVAL_REQUEST_ID_MIN) {
      throw new Error("Host Approval Request ID namespace is exhausted");
    }
    const requestId = this.#nextApprovalRequestId;
    this.#nextApprovalRequestId -= 1;
    return requestId;
  }

  async #projectQuestion(
    thread: ExternalThread,
    interaction: HostQuestionInteraction,
  ): Promise<void> {
    const projection = this.#projectedTurn(thread, interaction.turnId);
    await this.#waitForTurnResponse(thread, interaction.turnId);
    let result: CodexQuestionProjection;
    try {
      result = projection.projector.projectQuestion(
        interaction,
        hostItemIdSchema.parse(randomUUID()),
      );
    } catch (error) {
      this.#diagnose(error);
      thread.ignoredInteractionIds.add(interaction.interactionId);
      const cancelled = await thread.session.execute({
        type: "interaction.respond",
        interactionId: interaction.interactionId,
        response: { type: "question", answers: {}, cancelled: true },
      });
      if (!cancelled.ok) {
        thread.ignoredInteractionIds.delete(interaction.interactionId);
        this.#diagnose(`Unsupported Question cancellation failed: ${cancelled.error.message}`);
      }
      return;
    }
    for (const message of result.messages) await this.#writer.json(message);

    const requestId = this.#allocateQuestionRequestId();
    const expiresAtMs = interaction.expiresAt ? Date.parse(interaction.expiresAt) : Number.NaN;
    const timeoutMs = Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - Date.now()) : null;
    const pending: PendingDesktopQuestion = {
      thread,
      interaction,
      projection: result.questionRequest,
      timeout: null,
    };
    if (timeoutMs !== null) {
      pending.timeout = setTimeout(() => {
        void this.#cancelExpiredQuestion(requestId).catch((error) => this.#diagnose(error));
      }, timeoutMs);
    }
    this.#pendingDesktopQuestions.set(requestId, pending);
    try {
      await this.#writer.json({ id: requestId, ...result.questionRequest.request });
    } catch (error) {
      this.#retireDesktopQuestion(interaction.interactionId);
      await thread.session
        .execute({
          type: "interaction.respond",
          interactionId: interaction.interactionId,
          response: { type: "question", answers: {}, cancelled: true },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  async #handleDesktopQuestionResponse(value: JsonValue): Promise<boolean> {
    if (!isRecord(value) || !isHostQuestionRequestId(value.id)) return false;
    const requestId = value.id;
    const pending = this.#pendingDesktopQuestions.get(requestId);
    if (!pending) return true;
    return this.#externalRuntime.idleRelease.runOperation(pending.thread.id, async () => {
      if (
        this.#externalRuntime.get(pending.thread.id) !== pending.thread ||
        this.#externalRuntime.idleRelease.failure(pending.thread)
      )
        return true;
      if (this.#options.externalOnly)
        await this.#resolveDesktopQuestion(pending.interaction.interactionId);
      else this.#pendingDesktopQuestions.delete(requestId);
      if (pending.timeout) clearTimeout(pending.timeout);

      let response;
      try {
        response =
          "error" in value
            ? { type: "question" as const, answers: {}, cancelled: true as const }
            : pending.projection.parseResponse(value.result);
      } catch (error) {
        this.#diagnose(error);
        response = { type: "question" as const, answers: {}, cancelled: true as const };
      }
      const result = await pending.thread.session.execute({
        type: "interaction.respond",
        interactionId: pending.interaction.interactionId,
        response,
      });
      if (!result.ok && result.error.code !== "invalidState") {
        this.#diagnose(`Question response failed: ${result.error.message}`);
      }
      return true;
    });
  }

  async #cancelExpiredQuestion(requestId: HostQuestionRequestId): Promise<void> {
    const pending = this.#pendingDesktopQuestions.get(requestId);
    if (!pending) return;
    await this.#externalRuntime.idleRelease.runOperation(pending.thread.id, async () => {
      if (
        this.#externalRuntime.get(pending.thread.id) !== pending.thread ||
        this.#externalRuntime.idleRelease.failure(pending.thread)
      )
        return;
      await this.#resolveDesktopQuestion(pending.interaction.interactionId);
      const result = await pending.thread.session.execute({
        type: "interaction.respond",
        interactionId: pending.interaction.interactionId,
        response: { type: "question", answers: {}, cancelled: true },
      });
      if (!result.ok && result.error.code !== "invalidState") {
        this.#diagnose(`Question expiry failed: ${result.error.message}`);
      }
    });
  }

  #retireDesktopQuestion(interactionId: HostInteractionId): void {
    for (const [requestId, pending] of this.#pendingDesktopQuestions) {
      if (pending.interaction.interactionId !== interactionId) continue;
      if (pending.timeout) clearTimeout(pending.timeout);
      this.#pendingDesktopQuestions.delete(requestId);
    }
  }

  async #resolveDesktopQuestion(interactionId: HostInteractionId): Promise<void> {
    for (const [requestId, pending] of this.#pendingDesktopQuestions) {
      if (pending.interaction.interactionId !== interactionId) continue;
      if (pending.timeout) clearTimeout(pending.timeout);
      this.#pendingDesktopQuestions.delete(requestId);
      await this.#writer.json({
        method: "serverRequest/resolved",
        params: { threadId: pending.thread.id, requestId },
      });
    }
  }

  #allocateQuestionRequestId(): HostQuestionRequestId {
    if (this.#nextQuestionRequestId < HOST_QUESTION_REQUEST_ID_MIN) {
      throw new Error("Host Question Request ID namespace is exhausted");
    }
    const requestId = this.#nextQuestionRequestId;
    this.#nextQuestionRequestId -= 1;
    return requestId;
  }

  async #setThreadStatus(thread: ExternalThread, status: ExternalThreadStatus): Promise<void> {
    thread.thread.status = status;
    await this.#writer.json({
      method: "thread/status/changed",
      emittedAtMs: Date.now(),
      params: { threadId: thread.id, status },
    });
  }

  #projectedTurn(thread: ExternalThread, turnId: HostTurnId): ProjectedTurn {
    const projection = thread.projectedTurns.get(turnId);
    if (!projection) throw new Error("Harness output references an unknown Host Turn");
    return projection;
  }

  async #waitForTurnResponse(thread: ExternalThread, turnId: HostTurnId): Promise<void> {
    await thread.responseGates.get(turnId)?.promise;
  }

  #latestCompletedTurnId(thread: ExternalThread): HostTurnId | null {
    const parsed = hostTurnIdSchema.safeParse(thread.turns.at(-1)?.id);
    return parsed.success ? parsed.data : null;
  }

  #isKnownExternalTurn(thread: ExternalThread, turnId: HostTurnId): boolean {
    return thread.projectedTurns.has(turnId) || thread.turns.some((turn) => turn.id === turnId);
  }

  /** Native snapshot plus Host-derived metering; metering faults never hide native fields. */
  async #threadUsage(thread: ExternalThread): Promise<HostUsage | null> {
    try {
      const usage = thread.usageMeter.derive(thread.latestUsage, await this.#modelPrices.lookup());
      // An unpriced model may have been listed since the price table was fetched.
      if (usage?.unpricedModels?.length) this.#modelPrices.missing();
      return usage;
    } catch (error) {
      this.#diagnose(error);
      return thread.latestUsage;
    }
  }

  async #notifyThreadUsage(thread: ExternalThread): Promise<void> {
    await this.#writer.json({
      method: THREAD_USAGE_UPDATED_METHOD,
      params: { threadId: thread.id },
    });
  }

  /** Host-observed Turn timing; returns true when a derived metric changed. */
  #meterTurnTiming(thread: ExternalThread, event: HostEvent): boolean {
    if (this.#externalRuntime.get(thread.id) !== thread) return false;
    const meter = thread.usageMeter;
    switch (event.type) {
      case "turn.started":
      case "turn.autonomous.started":
        meter.turnStarted(event.turnId, Date.now());
        return false;
      case "item.updated":
        return event.update.type === "text.append" && event.update.text.length > 0
          ? meter.outputObserved(event.turnId, Date.now())
          : false;
      case "item.started":
      case "item.completed": {
        const item = event.type === "item.started" ? event.item : event.snapshot.item;
        return (item.type === "agentMessage" || item.type === "reasoning") && item.text.length > 0
          ? meter.outputObserved(event.turnId, Date.now())
          : false;
      }
      case "turn.completed":
        meter.turnCompleted(event.turnId);
        return true;
      default:
        return false;
    }
  }

  async #replayExternalUsage(thread: ExternalThread): Promise<void> {
    const latestTurnId = this.#latestCompletedTurnId(thread);
    if (!latestTurnId || !thread.latestUsage) return;
    thread.usageTurnId = latestTurnId;
    await this.#writeExternalUsage(thread, latestTurnId);
  }

  async #writeExternalUsage(thread: ExternalThread, turnId: HostTurnId): Promise<void> {
    const usage = thread.latestUsage;
    if (!usage || this.#externalRuntime.get(thread.id) !== thread) return;
    const projection = projectCodexThreadUsage({ threadId: thread.id, turnId, usage });
    if (!projection) return;
    await this.#waitForTurnResponse(thread, turnId);
    if (
      this.#externalRuntime.get(thread.id) !== thread ||
      thread.latestUsage !== usage ||
      thread.usageTurnId !== turnId
    ) {
      return;
    }
    await this.#writer.json(projection);
  }

  #dispatchDesktopRequest(run: () => Promise<void>, threadId?: string): void {
    try {
      const task = threadId ? this.#externalRuntime.idleRelease.runOperation(threadId, run) : run();
      void task.catch((error) => this.#diagnose(error));
    } catch (error) {
      this.#diagnose(error);
    }
  }

  #diagnose(error: unknown): void {
    this.#options.diagnosticOutput.write(`codexhost Host Runtime: ${errorMessage(error)}\n`);
  }
}
