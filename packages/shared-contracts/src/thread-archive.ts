import { z } from "zod";

export const THREAD_ARCHIVE_COMPLETED_METHOD = "codexhost/thread/archive-completed";

export const threadArchiveCompletedParamsSchema = z
  .object({ threadId: z.string().min(1) })
  .strict();

export const threadArchiveCompletedResultSchema = z
  .object({
    archived: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  })
  .strict();

export type ThreadArchiveCompletedParams = z.infer<typeof threadArchiveCompletedParamsSchema>;
export type ThreadArchiveCompletedResult = z.infer<typeof threadArchiveCompletedResultSchema>;
