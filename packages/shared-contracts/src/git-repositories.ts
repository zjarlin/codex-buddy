import { z } from "zod";
import { gitWorkspaceTargetSchema } from "./git-workspace.js";

export const GIT_REPOSITORIES_METHOD = "codexhost/git/repositories";
export const GIT_REPOSITORY_LINK_METHOD = "codexhost/git/repository/link";
export const GIT_REPOSITORY_UNLINK_METHOD = "codexhost/git/repository/unlink";
export const GIT_REPOSITORY_DIRECTORIES_METHOD = "codexhost/git/repository/directories";
export const GIT_REPOSITORY_DIRECTORY_LIMIT = 5000;

export const gitRepositoriesParamsSchema = gitWorkspaceTargetSchema;
export type GitRepositoriesParams = z.infer<typeof gitRepositoriesParamsSchema>;
export const gitRepositoryLinkParamsSchema = gitRepositoriesParamsSchema
  .safeExtend({ repository: z.string().trim().min(1).max(16_384) })
  .strict();
export type GitRepositoryLinkParams = z.infer<typeof gitRepositoryLinkParamsSchema>;
export const gitRepositoriesSchema = z
  .object({
    project: z.string().min(1),
    repositories: z.array(z.object({ path: z.string().min(1), primary: z.boolean() }).strict()),
  })
  .strict();
export type GitRepositories = z.infer<typeof gitRepositoriesSchema>;

export const gitRepositoryDirectoriesParamsSchema = gitRepositoriesParamsSchema
  .safeExtend({ path: z.string().trim().max(16_384).optional() })
  .strict();
export type GitRepositoryDirectoriesParams = z.infer<typeof gitRepositoryDirectoriesParamsSchema>;

export const gitRepositoryDirectoryEntrySchema = z
  .object({
    name: z.string().min(1).max(1024),
    path: z.string().min(1).max(16_384),
  })
  .strict();
export type GitRepositoryDirectoryEntry = z.infer<typeof gitRepositoryDirectoryEntrySchema>;

export const gitRepositoryDirectoriesSchema = z
  .object({
    project: z.string().min(1),
    path: z.string().min(1).max(16_384),
    parent: z.string().min(1).max(16_384).nullable(),
    entries: z.array(gitRepositoryDirectoryEntrySchema).max(GIT_REPOSITORY_DIRECTORY_LIMIT),
    truncated: z.boolean(),
  })
  .strict();
export type GitRepositoryDirectories = z.infer<typeof gitRepositoryDirectoriesSchema>;
