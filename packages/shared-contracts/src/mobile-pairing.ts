import { z } from "zod";

/** How a client reached the Host. The Host records this from its own channel, not the user agent. */
export const hostClientKindSchema = z.enum(["desktop", "console", "mobile", "remote"]);
export type HostClientKind = z.infer<typeof hostClientKindSchema>;

/** Stable, opaque client identity. Mobile clients keep it across reconnects and pairings. */
export const hostClientIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
export type HostClientId = z.infer<typeof hostClientIdSchema>;

/** Distinguishes paired phones sharing one Host while keeping their names user-editable. */
export const hostClientLabelSchema = z.string().trim().min(1).max(80);
export type HostClientLabel = z.infer<typeof hostClientLabelSchema>;

/**
 * A client that completed pairing. `id` is the device identity, `token` is only returned at
 * pairing time and kept as a digest by the Host. The Host rejects the token after revocation,
 * replacement, or the expiry configured for that pairing.
 */
export const mobilePairingCredentialSchema = z.strictObject({
  schemaVersion: z.literal(1),
  clientId: hostClientIdSchema,
  label: hostClientLabelSchema,
  token: z.string().regex(/^[0-9a-f]{64}$/u),
  expiresAt: z.number().int().positive(),
});
export type MobilePairingCredential = z.infer<typeof mobilePairingCredentialSchema>;

/** A QR value. Only the invite secret is in the URL; the page and WebSocket use the same origin. */
export const mobilePairingInviteSchema = z.strictObject({
  schemaVersion: z.literal(1),
  origin: z
    .string()
    .max(2048)
    .regex(/^http:\/\/[^/?#\s]+(?::\d{1,5})?\/?$/u),
  invite: z.string().regex(/^[0-9a-f]{64}$/u),
  expiresAt: z.number().int().positive(),
});
export type MobilePairingInvite = z.infer<typeof mobilePairingInviteSchema>;

/** The pairing page exchanges the one-time invite for a long-lived per-device credential. */
export const mobilePairingRequestSchema = z.strictObject({
  invite: z.string().regex(/^[0-9a-f]{64}$/u),
  clientId: hostClientIdSchema,
  label: hostClientLabelSchema,
});
export type MobilePairingRequest = z.infer<typeof mobilePairingRequestSchema>;

/** What a client declares when it opens the mobile control WebSocket. */
export const mobileClientHelloSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("mobile"),
  clientId: hostClientIdSchema,
  label: hostClientLabelSchema,
  token: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type MobileClientHello = z.infer<typeof mobileClientHelloSchema>;

export const mobilePairingStatusSchema = z.strictObject({
  /** Clients the Host keeps across reconnects. Secrets are never included. */
  clients: z.array(
    z.strictObject({
      clientId: hostClientIdSchema,
      label: hostClientLabelSchema,
      kind: hostClientKindSchema,
      connected: z.boolean(),
      pairedAt: z.number().int().positive(),
      lastSeenAt: z.number().int().positive(),
    }),
  ),
});
export type MobilePairingStatus = z.infer<typeof mobilePairingStatusSchema>;

export const MOBILE_PAIRING_STATUS_METHOD = "codexhost/mobile/pairing/status";
export const MOBILE_PAIRING_INVITE_METHOD = "codexhost/mobile/pairing/invite";
export const MOBILE_PAIRING_REVOKE_METHOD = "codexhost/mobile/pairing/revoke";

/**
 * Host server requests a paired phone may see and answer. Everything else, including
 * authentication, attestation, time, and tool-call requests, stays on the computer.
 */
export const MOBILE_SERVER_REQUEST_METHODS = Object.freeze([
  "mcpServer/elicitation/request",
  "item/tool/requestUserInput",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
] as const);
export type MobileServerRequestMethod = (typeof MOBILE_SERVER_REQUEST_METHODS)[number];

export function isMobileServerRequestMethod(method: string): method is MobileServerRequestMethod {
  return (MOBILE_SERVER_REQUEST_METHODS as readonly string[]).includes(method);
}

export const mobilePairingRevokeParamsSchema = z.strictObject({
  clientId: hostClientIdSchema,
});
export type MobilePairingRevokeParams = z.infer<typeof mobilePairingRevokeParamsSchema>;

/** Pairing attempts are bounded so a LAN scan cannot create unbounded state. */
export const MOBILE_PAIRING_MAX_CLIENTS = 16;
/** LAN access is opt-in and short-lived; the token is not a replacement for the Desktop auth. */
export const MOBILE_PAIRING_INVITE_TTL_MS = 5 * 60 * 1000;
export const MOBILE_PAIRING_CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
