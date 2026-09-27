import { z } from "zod";

import { threadTerminalIdSchema } from "./thread-terminal.js";

export const THREAD_TERMINAL_SETTINGS_GET_METHOD = "codexhost/settings/thread-terminal/get";
export const THREAD_TERMINAL_SETTINGS_SET_METHOD = "codexhost/settings/thread-terminal/set";

export const threadTerminalSettingsSchema = z
  .object({
    terminalId: threadTerminalIdSchema.nullable(),
  })
  .strict();
export type ThreadTerminalSettings = z.infer<typeof threadTerminalSettingsSchema>;

export const DEFAULT_THREAD_TERMINAL_SETTINGS: Readonly<ThreadTerminalSettings> = Object.freeze({
  terminalId: null,
});
