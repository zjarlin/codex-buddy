import { z } from "zod";

import { usageStatisticsTotalsSchema, USAGE_STATISTICS_RANGES } from "./usage-statistics.js";

/**
 * Team usage is the same per-request metering as machine usage, read across LAN peers a member
 * explicitly paired with this Host. Each Host owns and prices its own machine and answers with a
 * projection of its own totals; a coordinator never receives another member's raw sessions.
 */
export const TEAM_USAGE_STATE_METHOD = "codexhost/team-usage/state";
export const TEAM_USAGE_SNAPSHOT_METHOD = "codexhost/team-usage/snapshot";
export const TEAM_USAGE_INVITE_METHOD = "codexhost/team-usage/invite";
export const TEAM_USAGE_PAIR_METHOD = "codexhost/team-usage/pair";
export const TEAM_USAGE_ACCEPT_METHOD = "codexhost/team-usage/accept";
export const TEAM_USAGE_REJECT_METHOD = "codexhost/team-usage/reject";
export const TEAM_USAGE_SETTINGS_SET_METHOD = "codexhost/team-usage/settings/set";
export const TEAM_USAGE_MEMBER_SET_METHOD = "codexhost/team-usage/member/set";
export const TEAM_USAGE_MEMBER_REMOVE_METHOD = "codexhost/team-usage/member/remove";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const label = z.string().trim().min(1).max(120);
const project = z.string().min(1).max(4096);
const model = z.string().min(1).max(512);
const harness = z.string().min(1).max(128);
/** `host:port` of a member's Host on the local network. */
const address = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\]|[a-z0-9.-]+):\d{1,5}$/u);
const department = z.string().trim().min(1).max(120).nullable();

export const teamUsageMemberUsageSchema = z.strictObject({
  totals: usageStatisticsTotalsSchema,
  byHarness: z.array(z.strictObject({ harness, ...usageStatisticsTotalsSchema.shape })).max(256),
  byModel: z
    .array(z.strictObject({ model: model.nullable(), ...usageStatisticsTotalsSchema.shape }))
    .max(4096),
  byProject: z
    .array(z.strictObject({ project: project.nullable(), ...usageStatisticsTotalsSchema.shape }))
    .max(4096),
});

export const teamUsageMemberSchema = z.strictObject({
  /** Stable peer identity; this Host appears as `local`. */
  id: z.union([z.literal("local"), z.uuid()]),
  name: label,
  /** Department the coordinator assigned to the member; null when unassigned. */
  department,
  /**
   * Where the coordinator reaches this member's Host; null for `local`, and for members that only
   * read this Host (they never published a listener this Host could call).
   */
  address: address.nullable(),
  reachable: z.boolean(),
  lastSeenAtMs: count.nullable(),
  /** Why this member's figures are missing; the rest of the snapshot stays valid. */
  error: z.string().max(2048).optional(),
  usage: teamUsageMemberUsageSchema.optional(),
});

export const teamUsageSnapshotSchema = z.strictObject({
  range: z.enum(USAGE_STATISTICS_RANGES),
  from: localDate.nullable(),
  to: localDate,
  timeZone: z.string().min(1).max(128),
  generatedAtMs: count,
  /** Public model-catalog price estimate, not a gateway invoice. */
  costBasis: z.literal("public-model-price"),
  /** Local Host plus at most 200 paired members. */
  members: z.array(teamUsageMemberSchema).max(256),
});

export const teamUsageInviteSchema = z.strictObject({
  code: z.string().regex(/^\d{8}$/u),
  addresses: z.array(address).max(16),
  expiresAt: count,
});

/** Answer to a pairing attempt: pending until the coordinator approves, then the shared secret. */
export const teamUsagePairResultSchema = z.strictObject({
  status: z.enum(["pending", "approved"]),
  requestId: z.uuid(),
  /** Present only once approved; both sides keep it and never display it. */
  secret: z.string().min(32).max(256).optional(),
});

export const teamUsagePendingSchema = z.strictObject({
  requestId: z.uuid(),
  /** The person this attempt pairs with: the coordinator when `outbound`, the member otherwise. */
  name: label,
  /**
   * `true` when this Host asked to read that member and is waiting for its approval; those rows
   * are informational and cannot be accepted here. Absent on Hosts that only published inbound
   * requests, which are the ones a person can approve.
   */
  outbound: z.boolean().optional(),
  /**
   * Only the source address of the coordinator's request, which is an ephemeral socket and not a
   * usage endpoint. It is shown for identification; the member never calls back to it.
   */
  address: z.string().trim().min(1).max(300).nullable(),
  fingerprint: z.string().length(16),
  expiresAt: count,
});

/** A member announcing itself on the LAN; pairing still needs its eight-digit code. */
export const teamUsageDiscoveredSchema = z.strictObject({
  id: z.uuid(),
  name: label,
  department,
  address,
  seenAtMs: count,
});

export const teamUsagePeerSchema = z.strictObject({
  id: z.uuid(),
  name: label,
  address: address.nullable(),
  department,
  /**
   * `out`: this Host reads that member. `in`: that Host is a coordinator allowed to read this
   * Host. The two lists answer different questions and must not be shown as one member list.
   */
  direction: z.enum(["in", "out"]),
});

/** What the team page needs to configure this Host and approve joins. */
export const teamUsageStateSchema = z.strictObject({
  enabled: z.boolean(),
  name: label,
  department,
  /** Configured listening port; the live one while the listener runs, otherwise what it will use. */
  port: z.number().int().min(1).max(65535).nullable(),
  addresses: z.array(address).max(16),
  invite: teamUsageInviteSchema.nullable(),
  pending: z.array(teamUsagePendingSchema).max(32),
  /** One row per person per direction: at most 200 members this Host reads and 200 that read it. */
  peers: z.array(teamUsagePeerSchema).max(400),
  /** Members announcing themselves on this LAN in the last minute; absent on older Hosts. */
  discovered: z.array(teamUsageDiscoveredSchema).max(64).optional(),
});

/** Same display-timezone rule as machine usage: a zone every member can format dates with. */
const timeZone = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unsupported team usage timezone");

export const teamUsageSnapshotParamsSchema = z.strictObject({
  range: z.enum(USAGE_STATISTICS_RANGES),
  /** Display timezone shared by every member's date buckets; omitted means the Host's zone. */
  timeZone: timeZone.optional(),
});

export const teamUsageEmptyParamsSchema = z.strictObject({});

export const teamUsagePairParamsSchema = z.strictObject({
  address,
  code: z.string().regex(/^\d{8}$/u),
});

export const teamUsageRequestParamsSchema = z.strictObject({ requestId: z.uuid() });

export const teamUsageSettingsSetParamsSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    name: label.optional(),
    department: department.optional(),
    /** Port the member's listener binds; null keeps the current one. */
    port: z.number().int().min(1).max(65535).optional(),
  })
  .refine(
    (value) =>
      value.enabled !== undefined ||
      value.name !== undefined ||
      value.department !== undefined ||
      value.port !== undefined,
    "Nothing to change",
  );

export const teamUsageMemberSetParamsSchema = z.strictObject({
  id: z.uuid(),
  name: label.optional(),
  department: department.optional(),
});

export const teamUsageMemberRemoveParamsSchema = z.strictObject({
  id: z.uuid(),
  /**
   * Which relationship to drop. A person can be both read by this Host and allowed to read it;
   * removing one row must not silently revoke the other. Omitted removes both.
   */
  direction: z.enum(["in", "out"]).optional(),
});

/** Response shape of a member's own usage endpoint; the coordinator validates it. */
export const teamUsageMemberResponseSchema = z.strictObject({
  protocol: z.literal("codexhost-team-usage-v1"),
  range: z.enum(USAGE_STATISTICS_RANGES),
  from: localDate.nullable(),
  to: localDate,
  timeZone: z.string().min(1).max(128),
  name: label,
  /** The department the member set for itself; a coordinator may override it locally. */
  department: department.optional(),
  usage: teamUsageMemberUsageSchema,
});

export type TeamUsageDepartment = z.infer<typeof department>;
export type TeamUsageMemberUsage = z.infer<typeof teamUsageMemberUsageSchema>;
export type TeamUsageMember = z.infer<typeof teamUsageMemberSchema>;
export type TeamUsageSnapshot = z.infer<typeof teamUsageSnapshotSchema>;
export type TeamUsageInvite = z.infer<typeof teamUsageInviteSchema>;
export type TeamUsagePairResult = z.infer<typeof teamUsagePairResultSchema>;
export type TeamUsagePending = z.infer<typeof teamUsagePendingSchema>;
export type TeamUsageDiscovered = z.infer<typeof teamUsageDiscoveredSchema>;
export type TeamUsagePeer = z.infer<typeof teamUsagePeerSchema>;
export type TeamUsageState = z.infer<typeof teamUsageStateSchema>;
export type TeamUsageSnapshotParams = z.infer<typeof teamUsageSnapshotParamsSchema>;
export type TeamUsagePairParams = z.infer<typeof teamUsagePairParamsSchema>;
export type TeamUsageRequestParams = z.infer<typeof teamUsageRequestParamsSchema>;
export type TeamUsageSettingsSetParams = z.infer<typeof teamUsageSettingsSetParamsSchema>;
export type TeamUsageMemberSetParams = z.infer<typeof teamUsageMemberSetParamsSchema>;
export type TeamUsageMemberRemoveParams = z.infer<typeof teamUsageMemberRemoveParamsSchema>;
export type TeamUsageMemberResponse = z.infer<typeof teamUsageMemberResponseSchema>;
