import { z } from "zod";

import { threadTerminalIdSchema } from "./thread-terminal.js";

export const PROJECT_TERMINAL_OPEN_METHOD = "codexhost/project/terminal/open";
export const PROJECT_WORKSPACE_OPEN_METHOD = "codexhost/project/workspace/open";

const absolutePathSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine((value) => !value.includes("\0"), "Path must not contain NUL")
  .refine(
    (value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\"),
    "Path must be absolute",
  );

export const projectTerminalOpenParamsSchema = z
  .object({
    path: absolutePathSchema,
    terminalId: threadTerminalIdSchema.optional(),
  })
  .strict();
export type ProjectTerminalOpenParams = z.infer<typeof projectTerminalOpenParamsSchema>;

export const projectTerminalOpenResultSchema = z
  .object({
    workspace: z.string().min(1),
    terminal: threadTerminalIdSchema,
  })
  .strict();
export type ProjectTerminalOpenResult = z.infer<typeof projectTerminalOpenResultSchema>;

export const projectWorkspaceOpenParamsSchema = z.object({ path: absolutePathSchema }).strict();
export type ProjectWorkspaceOpenParams = z.infer<typeof projectWorkspaceOpenParamsSchema>;

export const projectWorkspaceOpenResultSchema = z
  .object({
    workspace: z.string().min(1),
    application: z.literal("vscode"),
  })
  .strict();
export type ProjectWorkspaceOpenResult = z.infer<typeof projectWorkspaceOpenResultSchema>;
