import { z } from "zod";

export const PROJECT_SYNC_INSPECT_METHOD = "codexhost/project-sync/inspect";
export const PROJECT_SYNC_INVITE_METHOD = "codexhost/project-sync/invite";
export const PROJECT_SYNC_PAIR_METHOD = "codexhost/project-sync/pair";
export const PROJECT_SYNC_ACCEPT_METHOD = "codexhost/project-sync/accept";
export const PROJECT_SYNC_REJECT_METHOD = "codexhost/project-sync/reject";
export const PROJECT_SYNC_GIT_CONFIGURE_METHOD = "codexhost/project-sync/git-configure";
export const PROJECT_SYNC_GIT_PULL_METHOD = "codexhost/project-sync/git-pull";
export const PROJECT_SYNC_GIT_PUSH_METHOD = "codexhost/project-sync/git-push";
export const PROJECT_SYNC_SYNC_METHOD = "codexhost/project-sync/sync";
export const PROJECT_SYNC_REMOVE_PEER_METHOD = "codexhost/project-sync/remove-peer";
export const PROJECT_SYNC_ADD_METHOD = "codexhost/project-sync/add";
export const PROJECT_SYNC_BIND_METHOD = "codexhost/project-sync/bind";
export const PROJECT_SYNC_CLONE_METHOD = "codexhost/project-sync/clone";

export const projectSyncEmptyParamsSchema = z.object({}).strict();
export const projectSyncPathSchema = z.string().trim().min(1).max(4096);
export const projectSyncRemoteSchema = z.string().trim().min(1).max(2048);
export const projectSyncPairParamsSchema = z
  .object({
    code: z.string().regex(/^\d{8}$/u),
  })
  .strict();
export const projectSyncRequestParamsSchema = z.object({ requestId: z.string().uuid() }).strict();
export const projectSyncGitConfigureParamsSchema = z
  .object({ remote: projectSyncRemoteSchema.nullable() })
  .strict();
export const projectSyncPeerParamsSchema = z.object({ peerId: z.string().uuid() }).strict();
export const projectSyncAddParamsSchema = z.object({ path: projectSyncPathSchema }).strict();
export const projectSyncBindParamsSchema = z
  .object({ remote: projectSyncRemoteSchema, path: projectSyncPathSchema })
  .strict();
export const projectSyncCloneParamsSchema = z
  .object({ remote: projectSyncRemoteSchema, parent: projectSyncPathSchema })
  .strict();

export const projectSyncProjectSchema = z
  .object({
    name: z.string().min(1).max(200),
    remote: projectSyncRemoteSchema,
    localPath: z.string().nullable(),
    state: z.enum(["ready", "missing"]),
  })
  .strict();
export const projectSyncPeerSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
  })
  .strict();
export const projectSyncPendingSchema = z
  .object({
    requestId: z.string().uuid(),
    name: z.string().min(1).max(100),
    fingerprint: z.string().length(16),
  })
  .strict();
export const projectSyncSnapshotSchema = z
  .object({
    peers: z.array(projectSyncPeerSchema).max(32),
    pending: z.array(projectSyncPendingSchema).max(32),
    connected: z.boolean(),
    relay: z.string().nullable(),
    gitRemote: projectSyncRemoteSchema.nullable(),
    projects: z.array(projectSyncProjectSchema).max(1000),
  })
  .strict();
export const projectSyncInviteSchema = z
  .object({
    code: z.string().regex(/^\d{8}$/u),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type ProjectSyncSnapshot = z.infer<typeof projectSyncSnapshotSchema>;
export type ProjectSyncInvite = z.infer<typeof projectSyncInviteSchema>;
export type ProjectSyncPairParams = z.infer<typeof projectSyncPairParamsSchema>;
export type ProjectSyncRequestParams = z.infer<typeof projectSyncRequestParamsSchema>;
export type ProjectSyncGitConfigureParams = z.infer<typeof projectSyncGitConfigureParamsSchema>;
export type ProjectSyncPeerParams = z.infer<typeof projectSyncPeerParamsSchema>;
export type ProjectSyncAddParams = z.infer<typeof projectSyncAddParamsSchema>;
export type ProjectSyncBindParams = z.infer<typeof projectSyncBindParamsSchema>;
export type ProjectSyncCloneParams = z.infer<typeof projectSyncCloneParamsSchema>;
