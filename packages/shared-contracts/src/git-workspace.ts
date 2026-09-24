import { z } from "zod";

import { hostThreadIdSchema } from "./ids.js";

export const GIT_STATUS_METHOD = "codexhost/git/status";
export const GIT_DIFF_METHOD = "codexhost/git/diff";
export const GIT_STAGE_METHOD = "codexhost/git/stage";
export const GIT_UNSTAGE_METHOD = "codexhost/git/unstage";
export const GIT_COMMIT_METHOD = "codexhost/git/commit";
export const GIT_PUSH_METHOD = "codexhost/git/push";
export const GIT_MESSAGE_MODEL_METHOD = "codexhost/git/message-models";
export const GIT_MESSAGE_GENERATE_METHOD = "codexhost/git/message/generate";

export const GIT_FILE_PATH_MAX_LENGTH = 16_384;
export const GIT_COMMIT_MESSAGE_MAX_LENGTH = 20_000;
export const GIT_DIFF_MAX_BYTES = 2_000_000;

const nonBlankTextSchema = z.string().trim().min(1);
export const gitFilePathSchema = nonBlankTextSchema.max(GIT_FILE_PATH_MAX_LENGTH);
export const gitCommitMessageSchema = nonBlankTextSchema.max(GIT_COMMIT_MESSAGE_MAX_LENGTH);

export const gitWorkspaceParamsSchema = z.object({ threadId: hostThreadIdSchema }).strict();
export type GitWorkspaceParams = z.infer<typeof gitWorkspaceParamsSchema>;

export const gitDiffParamsSchema = gitWorkspaceParamsSchema
  .extend({ path: gitFilePathSchema })
  .strict();
export type GitDiffParams = z.infer<typeof gitDiffParamsSchema>;

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
  })
  .strict();
export type GitChange = z.infer<typeof gitChangeSchema>;

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
  })
  .strict();
export type GitWorkspaceStatus = z.infer<typeof gitWorkspaceStatusSchema>;

export const gitDiffResultSchema = z
  .object({
    path: gitFilePathSchema,
    diff: z.string(),
    truncated: z.boolean(),
  })
  .strict();
export type GitDiffResult = z.infer<typeof gitDiffResultSchema>;

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
