import { z } from "zod";
import { hostThreadIdSchema } from "./ids.js";

export const GIT_REPOSITORIES_METHOD = "codexhost/git/repositories";
export const GIT_REPOSITORY_LINK_METHOD = "codexhost/git/repository/link";
export const GIT_REPOSITORY_UNLINK_METHOD = "codexhost/git/repository/unlink";

export const gitRepositoriesParamsSchema = z.object({ threadId: hostThreadIdSchema }).strict();
export type GitRepositoriesParams = z.infer<typeof gitRepositoriesParamsSchema>;
export const gitRepositoryLinkParamsSchema = gitRepositoriesParamsSchema
  .extend({ repository: z.string().trim().min(1).max(16_384) })
  .strict();
export type GitRepositoryLinkParams = z.infer<typeof gitRepositoryLinkParamsSchema>;
export const gitRepositoriesSchema = z
  .object({
    project: z.string().min(1),
    repositories: z.array(z.object({ path: z.string().min(1), primary: z.boolean() }).strict()),
  })
  .strict();
export type GitRepositories = z.infer<typeof gitRepositoriesSchema>;
