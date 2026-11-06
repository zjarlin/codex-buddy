import { z } from "zod";

export const LOCAL_WORKSPACE_PREPARE_METHOD = "codexhost/local-workspace/prepare";
export const localWorkspacePrepareParamsSchema = z
  .object({
    path: z.string().trim().min(1).max(4096),
    remote: z.string().trim().min(1).max(2048).optional(),
  })
  .strict();
export const localWorkspacePrepareResultSchema = z
  .object({ path: z.string().min(1), cloned: z.boolean() })
  .strict();
export type LocalWorkspacePrepareParams = z.infer<typeof localWorkspacePrepareParamsSchema>;
export type LocalWorkspacePrepareResult = z.infer<typeof localWorkspacePrepareResultSchema>;

export const LOCAL_WORKSPACE_DIRECTORIES_METHOD = "codexhost/local-workspace/directories";
export const localWorkspaceDirectoriesParamsSchema = z
  .object({ path: z.string().min(1).max(4096).optional() })
  .strict();
export const GIT_ORIGIN_METHOD = "codexhost/git/origin";
export const gitOriginResultSchema = z.object({ remote: z.string().nullable() }).strict();
