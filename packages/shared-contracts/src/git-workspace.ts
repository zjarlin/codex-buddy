import { z } from "zod";

import { hostThreadIdSchema } from "./ids.js";

export const GIT_STATUS_METHOD = "codexhost/git/status";
export const GIT_DIFF_METHOD = "codexhost/git/diff";
export const GIT_CONTENT_METHOD = "codexhost/git/content";
export const GIT_STAGE_METHOD = "codexhost/git/stage";
export const GIT_UNSTAGE_METHOD = "codexhost/git/unstage";
export const GIT_COMMIT_METHOD = "codexhost/git/commit";
export const GIT_PUSH_METHOD = "codexhost/git/push";
export const GIT_MESSAGE_MODEL_METHOD = "codexhost/git/message-models";
export const GIT_MESSAGE_GENERATE_METHOD = "codexhost/git/message/generate";
export const GIT_SUBMODULES_METHOD = "codexhost/git/submodules";
export const GIT_SUBMODULE_UPDATE_METHOD = "codexhost/git/submodule/update";
export const GIT_LOG_METHOD = "codexhost/git/log";
export const GIT_COMMIT_DETAIL_METHOD = "codexhost/git/commit-detail";
export const GIT_COMMIT_DIFF_METHOD = "codexhost/git/commit-diff";
export const GIT_FETCH_METHOD = "codexhost/git/fetch";
export const GIT_SYNC_METHOD = "codexhost/git/sync";
export const GIT_MERGE_CONTINUE_METHOD = "codexhost/git/merge/continue";
export const GIT_MERGE_ABORT_METHOD = "codexhost/git/merge/abort";

export const GIT_FILE_PATH_MAX_LENGTH = 16_384;
export const GIT_COMMIT_MESSAGE_MAX_LENGTH = 20_000;
export const GIT_DIFF_MAX_BYTES = 2_000_000;
export const GIT_CONTENT_MAX_BYTES = 1024 * 1024;

const nonBlankTextSchema = z.string().trim().min(1);
export const gitFilePathSchema = nonBlankTextSchema.max(GIT_FILE_PATH_MAX_LENGTH);
export const gitCommitMessageSchema = nonBlankTextSchema.max(GIT_COMMIT_MESSAGE_MAX_LENGTH);

export const gitWorkspaceParamsSchema = z
  .object({
    threadId: hostThreadIdSchema,
    repository: z.string().trim().min(1).max(GIT_FILE_PATH_MAX_LENGTH).optional(),
  })
  .strict();
export type GitWorkspaceParams = z.infer<typeof gitWorkspaceParamsSchema>;

export const gitDiffParamsSchema = gitWorkspaceParamsSchema
  .extend({ path: gitFilePathSchema })
  .strict();
export type GitDiffParams = z.infer<typeof gitDiffParamsSchema>;

export const gitContentParamsSchema = gitDiffParamsSchema;
export type GitContentParams = z.infer<typeof gitContentParamsSchema>;

export const gitStageParamsSchema = gitWorkspaceParamsSchema
  .extend({ paths: z.array(gitFilePathSchema).max(10_000) })
  .strict();
export type GitStageParams = z.infer<typeof gitStageParamsSchema>;

export const gitCommitParamsSchema = gitWorkspaceParamsSchema
  .extend({
    message: gitCommitMessageSchema,
    paths: z.array(gitFilePathSchema).max(10_000).default([]),
    push: z.boolean().default(false),
  })
  .strict();
export type GitCommitParams = z.infer<typeof gitCommitParamsSchema>;

export const gitMessageGenerateParamsSchema = gitWorkspaceParamsSchema
  .extend({
    model: z.string().trim().min(1).max(512),
    paths: z.array(gitFilePathSchema).max(10_000).default([]),
  })
  .strict();
export type GitMessageGenerateParams = z.infer<typeof gitMessageGenerateParamsSchema>;

export const gitSubmoduleUpdateParamsSchema = gitWorkspaceParamsSchema
  .extend({
    path: gitFilePathSchema,
    init: z.boolean().default(false),
  })
  .strict();
export type GitSubmoduleUpdateParams = z.infer<typeof gitSubmoduleUpdateParamsSchema>;

export const gitLogParamsSchema = gitWorkspaceParamsSchema
  .extend({ limit: z.number().int().min(1).max(1000).default(200) })
  .strict();
export type GitLogParams = z.infer<typeof gitLogParamsSchema>;

const gitObjectIdSchema = z.string().regex(/^[0-9a-f]{7,64}$/iu);
export const gitCommitDetailParamsSchema = gitWorkspaceParamsSchema
  .extend({ commit: gitObjectIdSchema })
  .strict();
export type GitCommitDetailParams = z.infer<typeof gitCommitDetailParamsSchema>;

export const gitCommitDiffParamsSchema = gitCommitDetailParamsSchema
  .extend({ path: gitFilePathSchema })
  .strict();
export type GitCommitDiffParams = z.infer<typeof gitCommitDiffParamsSchema>;

export const gitChangeSchema = z
  .object({
    path: gitFilePathSchema,
    originalPath: gitFilePathSchema.optional(),
    indexStatus: z.string().length(1),
    workTreeStatus: z.string().length(1),
    staged: z.boolean(),
    unstaged: z.boolean(),
    untracked: z.boolean(),
    conflicted: z.boolean(),
    submodule: z
      .object({
        path: gitFilePathSchema,
        status: z.enum(["current", "modified", "uninitialized", "conflicted"]),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type GitChange = z.infer<typeof gitChangeSchema>;

export const gitSubmoduleSchema = z
  .object({
    path: gitFilePathSchema,
    status: z.enum(["current", "modified", "uninitialized", "conflicted"]),
  })
  .strict();
export type GitSubmodule = z.infer<typeof gitSubmoduleSchema>;

export const gitSubmoduleListSchema = z
  .object({
    submodules: z.array(gitSubmoduleSchema).max(10_000),
    warnings: z.array(z.string()).optional(),
  })
  .strict();
export type GitSubmoduleList = z.infer<typeof gitSubmoduleListSchema>;

export const gitLogRefSchema = z
  .object({
    name: z.string().min(1).max(1024),
    kind: z.enum(["head", "local", "remote", "tag"]),
    commit: gitObjectIdSchema,
    current: z.boolean(),
  })
  .strict();
export type GitLogRef = z.infer<typeof gitLogRefSchema>;

export const gitLogCommitSchema = z
  .object({
    commit: gitObjectIdSchema,
    shortCommit: z.string().min(4).max(64),
    subject: z.string().max(20_000),
    authorName: z.string().max(512),
    authorEmail: z.string().max(1024),
    authoredAt: z.string().min(1).max(128),
    parents: z.array(gitObjectIdSchema).max(32),
    refs: z.array(z.string().min(1).max(1024)).max(128),
  })
  .strict();
export type GitLogCommit = z.infer<typeof gitLogCommitSchema>;

export const gitLogResultSchema = z
  .object({
    workspace: z.string().min(1),
    branch: z.string().nullable(),
    head: gitObjectIdSchema.nullable(),
    refs: z.array(gitLogRefSchema).max(5000),
    commits: z.array(gitLogCommitSchema).max(1000),
  })
  .strict();
export type GitLogResult = z.infer<typeof gitLogResultSchema>;

export const gitCommitFileSchema = z
  .object({
    path: gitFilePathSchema,
    originalPath: gitFilePathSchema.optional(),
    status: z.string().length(1),
    additions: z.number().int().nonnegative().nullable(),
    deletions: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type GitCommitFile = z.infer<typeof gitCommitFileSchema>;

export const gitCommitDetailSchema = z
  .object({
    commit: gitLogCommitSchema,
    body: z.string().max(200_000),
    files: z.array(gitCommitFileSchema).max(10_000),
  })
  .strict();
export type GitCommitDetail = z.infer<typeof gitCommitDetailSchema>;

export const gitWorkspaceStatusSchema = z
  .object({
    workspace: z.string().min(1),
    branch: z.string().nullable(),
    detached: z.boolean(),
    head: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    changes: z.array(gitChangeSchema),
    submodules: z.array(gitSubmoduleSchema),
    warnings: z.array(z.string()).optional(),
    // 进行中的合并/变基操作；null 表示当前没有未完成的合并或变基。
    operation: z.enum(["merge", "rebase"]).nullable().default(null),
    // 冲突文件路径，便于界面与模型直接定位而无需再次扫描 changes。
    conflicts: z.array(gitFilePathSchema).default([]),
  })
  .strict();
export type GitWorkspaceStatus = z.infer<typeof gitWorkspaceStatusSchema>;

// 拉取并同步的结果：策略说明本次如何合入远端，冲突时列出待消解的文件。
export const gitSyncStrategySchema = z.enum(["up-to-date", "fast-forward", "merged", "conflict"]);
export type GitSyncStrategy = z.infer<typeof gitSyncStrategySchema>;

export const gitSyncResultSchema = z
  .object({
    strategy: gitSyncStrategySchema,
    behind: z.number().int().nonnegative(),
    conflicts: z.array(gitFilePathSchema),
    output: z.string(),
    status: gitWorkspaceStatusSchema,
  })
  .strict();
export type GitSyncResult = z.infer<typeof gitSyncResultSchema>;

export const gitDiffResultSchema = z
  .object({
    path: gitFilePathSchema,
    diff: z.string(),
    truncated: z.boolean(),
  })
  .strict();
export type GitDiffResult = z.infer<typeof gitDiffResultSchema>;

export const gitContentResultSchema = z
  .object({
    path: gitFilePathSchema,
    baseLabel: z.string(),
    base: z.string(),
    working: z.string(),
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    conflicted: z.boolean(),
    ours: z.string().nullable(),
    theirs: z.string().nullable(),
    binary: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();
export type GitContentResult = z.infer<typeof gitContentResultSchema>;

export const gitCommitResultSchema = z
  .object({
    commit: z.string().nullable(),
    pushed: z.boolean(),
    output: z.string(),
    status: gitWorkspaceStatusSchema,
  })
  .strict();
export type GitCommitResult = z.infer<typeof gitCommitResultSchema>;

export const gitMessageModelSchema = z
  .object({
    id: z.string().min(1).max(512),
    label: z.string().min(1).max(512),
    tier: z.enum(["夯", "垃"]),
    eligible: z.boolean(),
    recommended: z.boolean().default(false),
  })
  .strict();
export type GitMessageModel = z.infer<typeof gitMessageModelSchema>;

export const gitMessageModelsSchema = z
  .object({
    models: z.array(gitMessageModelSchema),
    defaultModel: z.string().nullable(),
  })
  .strict();
export type GitMessageModels = z.infer<typeof gitMessageModelsSchema>;

export const gitGeneratedMessageSchema = z
  .object({
    message: gitCommitMessageSchema,
    model: z.string().min(1).max(512),
  })
  .strict();
export type GitGeneratedMessage = z.infer<typeof gitGeneratedMessageSchema>;
