import { z } from "zod";

export const REMOTE_PROJECTS_INSPECT_METHOD = "codexhost/ssh/projects/inspect";
export const REMOTE_PROJECTS_SYNC_METHOD = "codexhost/ssh/projects/sync";

export const remoteProjectPathSchema = z.string().trim().min(1).max(16_384);
export const remoteProjectThreadSchema = z
  .object({
    id: z.string().trim().min(1).max(1_024),
    name: z.string().max(4_096),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export const remoteProjectSchema = z
  .object({
    key: z.string().regex(/^[a-f0-9]{16}$/u),
    name: z.string().trim().min(1).max(200),
    roots: z.array(remoteProjectPathSchema).min(1).max(100),
    threads: z.array(remoteProjectThreadSchema).max(10_000),
  })
  .strict();
export const remoteProjectAccountSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{16}$/u),
    label: z.string().trim().min(1).max(80),
    current: z.boolean(),
    projects: z.array(remoteProjectSchema).max(1_000),
  })
  .strict();

export const remoteProjectsInspectParamsSchema = z
  .object({ hostId: z.string().trim().min(1).max(1_024) })
  .strict();
export const remoteProjectsSyncParamsSchema = z
  .object({
    hostId: z.string().trim().min(1).max(1_024),
  })
  .strict();
export const remoteProjectsSnapshotSchema = z
  .object({
    account: remoteProjectAccountSchema,
    accounts: z.array(remoteProjectAccountSchema).max(64),
  })
  .strict();

export type RemoteProject = z.infer<typeof remoteProjectSchema>;
export type RemoteProjectThread = z.infer<typeof remoteProjectThreadSchema>;
export type RemoteProjectAccount = z.infer<typeof remoteProjectAccountSchema>;
export type RemoteProjectsSnapshot = z.infer<typeof remoteProjectsSnapshotSchema>;
export type RemoteProjectsInspectParams = z.infer<typeof remoteProjectsInspectParamsSchema>;
export type RemoteProjectsSyncParams = z.infer<typeof remoteProjectsSyncParamsSchema>;
