import { z } from "zod";

import { hostThreadIdSchema } from "./ids.js";

export const THREAD_TERMINAL_OPEN_METHOD = "codexhost/thread/terminal/open";

export const threadTerminalOpenParamsSchema = z
  .object({
    threadId: hostThreadIdSchema,
  })
  .strict();
export type ThreadTerminalOpenParams = z.infer<typeof threadTerminalOpenParamsSchema>;

export const threadTerminalOpenResultSchema = z
  .object({
    workspace: z.string().min(1),
    terminal: z.enum(["terminal", "windows-terminal", "x-terminal-emulator"]),
    mode: z.literal("resume"),
  })
  .strict();
export type ThreadTerminalOpenResult = z.infer<typeof threadTerminalOpenResultSchema>;
