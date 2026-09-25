import { z } from "zod";

import { hostThreadIdSchema } from "./ids.js";

export const WORKSPACE_FILES_LIST_METHOD = "codexhost/workspace/files/list";
export const WORKSPACE_FILES_READ_METHOD = "codexhost/workspace/files/read";
export const WORKSPACE_FILE_READ_MAX_BYTES = 1024 * 1024;
export const WORKSPACE_FILE_PATH_MAX_LENGTH = 4096;
export const WORKSPACE_DIRECTORY_ENTRY_LIMIT = 5000;

export const workspaceFilesListParamsSchema = z
  .object({
    threadId: hostThreadIdSchema,
    path: z.string().max(WORKSPACE_FILE_PATH_MAX_LENGTH).default(""),
  })
  .strict();
export type WorkspaceFilesListParams = z.infer<typeof workspaceFilesListParamsSchema>;

export const workspaceFileKindSchema = z.enum(["file", "directory", "symlink"]);
export type WorkspaceFileKind = z.infer<typeof workspaceFileKindSchema>;

export const workspaceFileEntrySchema = z
  .object({
    name: z.string().min(1).max(1024),
    path: z.string().min(1).max(WORKSPACE_FILE_PATH_MAX_LENGTH),
    kind: workspaceFileKindSchema,
    size: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type WorkspaceFileEntry = z.infer<typeof workspaceFileEntrySchema>;

export const workspaceFilesListResultSchema = z
  .object({
    workspace: z.string().min(1),
    path: z.string().max(WORKSPACE_FILE_PATH_MAX_LENGTH),
    entries: z.array(workspaceFileEntrySchema).max(WORKSPACE_DIRECTORY_ENTRY_LIMIT),
    truncated: z.boolean(),
  })
  .strict();
export type WorkspaceFilesListResult = z.infer<typeof workspaceFilesListResultSchema>;

export const workspaceFileReadParamsSchema = z
  .object({
    threadId: hostThreadIdSchema,
    path: z.string().min(1).max(WORKSPACE_FILE_PATH_MAX_LENGTH),
  })
  .strict();
export type WorkspaceFileReadParams = z.infer<typeof workspaceFileReadParamsSchema>;

export const workspaceFileReadResultSchema = z
  .object({
    workspace: z.string().min(1),
    path: z.string().min(1).max(WORKSPACE_FILE_PATH_MAX_LENGTH),
    size: z.number().int().nonnegative(),
    content: z.string(),
    binary: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();
export type WorkspaceFileReadResult = z.infer<typeof workspaceFileReadResultSchema>;
