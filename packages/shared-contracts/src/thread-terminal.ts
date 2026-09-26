import { z } from "zod";

import { hostThreadIdSchema } from "./ids.js";

export const THREAD_TERMINAL_OPEN_METHOD = "codexhost/thread/terminal/open";
export const THREAD_TERMINAL_LIST_METHOD = "codexhost/thread/terminal/list";

export const threadTerminalIdSchema = z.enum([
  "system-default",
  "apple-terminal",
  "iterm2",
  "ghostty",
  "warp",
  "wezterm",
  "alacritty",
  "kitty",
  "hyper",
  "tabby",
  "windows-terminal",
  "powershell",
  "command-prompt",
  "git-bash",
  "nushell",
  "x-terminal-emulator",
]);
export type ThreadTerminalId = z.infer<typeof threadTerminalIdSchema>;

export const threadTerminalDescriptorSchema = z
  .object({
    id: threadTerminalIdSchema,
    name: z.string().min(1).max(128),
    installed: z.boolean(),
    default: z.boolean(),
  })
  .strict();
export type ThreadTerminalDescriptor = z.infer<typeof threadTerminalDescriptorSchema>;

export const threadTerminalListParamsSchema = z.object({}).strict();
export const threadTerminalListResultSchema = z
  .object({
    terminals: z.array(threadTerminalDescriptorSchema).min(1).max(64),
  })
  .strict();
export type ThreadTerminalListResult = z.infer<typeof threadTerminalListResultSchema>;

export const threadTerminalOpenParamsSchema = z
  .object({
    threadId: hostThreadIdSchema,
    terminalId: threadTerminalIdSchema.optional(),
  })
  .strict();
export type ThreadTerminalOpenParams = z.infer<typeof threadTerminalOpenParamsSchema>;

export const threadTerminalOpenResultSchema = z
  .object({
    workspace: z.string().min(1),
    terminal: threadTerminalIdSchema,
    mode: z.literal("resume"),
  })
  .strict();
export type ThreadTerminalOpenResult = z.infer<typeof threadTerminalOpenResultSchema>;
