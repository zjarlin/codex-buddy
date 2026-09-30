import { z } from "zod";

export const THREAD_AUTO_ARCHIVE_SETTINGS_METHOD = "codexhost/settings/thread-auto-archive/set";
export const THREAD_AUTO_ARCHIVE_DAYS_MIN = 1;
export const THREAD_AUTO_ARCHIVE_DAYS_MAX = 3650;

export const threadAutoArchiveSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  inactiveDays: z
    .number()
    .int()
    .min(THREAD_AUTO_ARCHIVE_DAYS_MIN)
    .max(THREAD_AUTO_ARCHIVE_DAYS_MAX),
});

export type ThreadAutoArchiveSettings = z.infer<typeof threadAutoArchiveSettingsSchema>;

export const DEFAULT_THREAD_AUTO_ARCHIVE_SETTINGS: Readonly<ThreadAutoArchiveSettings> =
  Object.freeze({
    enabled: false,
    inactiveDays: 30,
  });
