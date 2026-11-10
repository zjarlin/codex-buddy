import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MOBILE_PAIRING_CLIENT_TTL_MS,
  MOBILE_PAIRING_INVITE_TTL_MS,
  MOBILE_PAIRING_MAX_CLIENTS,
  hostClientIdSchema,
  hostClientLabelSchema,
  mobileClientHelloSchema,
  mobilePairingStatusSchema,
  type HostClientId,
  type HostClientKind,
  type MobilePairingStatus,
} from "@codexhost/shared-contracts";

const STATE_VERSION = 1;
const TOKEN_BYTES = 32;
const INVITE_BYTES = 32;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

interface PairingClientRecord {
  clientId: HostClientId;
  label: string;
  kind: HostClientKind;
  tokenDigest: string;
  pairedAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

interface StoredPairingState {
  version: 1;
  invite: { digest: string; expiresAt: number } | null;
  clients: PairingClientRecord[];
}

export interface MobilePairingSession {
  clientId: HostClientId;
  label: string;
  /** Distinguishes concurrent connections from one device for status and cleanup. */
  connectionId: string;
}

export interface MobilePairingInvite {
  /** Secret carried by the QR URL; never logged. */
  secret: string;
  expiresAt: number;
}

export class MobilePairingError extends Error {
  constructor(
    readonly code: "invalid-invite" | "invalid-client" | "expired" | "full" | "revoked",
    message: string,
  ) {
    super(message);
    this.name = "MobilePairingError";
  }
}

function digest(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function sameDigest(expected: string, provided: string): boolean {
  if (!DIGEST_PATTERN.test(expected) || !DIGEST_PATTERN.test(provided)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(provided, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function opaqueId(): string {
  return randomBytes(16).toString("hex");
}

export function mobilePairingStatePath(environment: NodeJS.ProcessEnv = process.env): string {
  const directory = environment.CODEXHOST_DATA_DIR
    ? path.resolve(environment.CODEXHOST_DATA_DIR)
    : path.join(os.homedir(), ".codexhost");
  return path.join(directory, "mobile-pairing.json");
}

function parseClient(value: unknown): PairingClientRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const clientId = hostClientIdSchema.safeParse(record.clientId);
  const label = hostClientLabelSchema.safeParse(record.label);
  if (
    !clientId.success ||
    !label.success ||
    record.kind !== "mobile" ||
    typeof record.tokenDigest !== "string" ||
    !DIGEST_PATTERN.test(record.tokenDigest) ||
    typeof record.pairedAt !== "number" ||
    !Number.isSafeInteger(record.pairedAt) ||
    typeof record.lastSeenAt !== "number" ||
    !Number.isSafeInteger(record.lastSeenAt) ||
    typeof record.expiresAt !== "number" ||
    !Number.isSafeInteger(record.expiresAt)
  ) {
    return null;
  }
  return {
    clientId: clientId.data,
    label: label.data,
    kind: "mobile",
    tokenDigest: record.tokenDigest,
    pairedAt: record.pairedAt,
    lastSeenAt: record.lastSeenAt,
    expiresAt: record.expiresAt,
  };
}

/**
 * Pairing state belongs to the Host, not to one process connection. It keeps only token
 * digests, so a copied state file cannot be used to authenticate a phone.
 */
export class MobilePairingStore {
  readonly #file: string;
  readonly #now: () => number;
  readonly #clients = new Map<HostClientId, PairingClientRecord>();
  readonly #connections = new Map<HostClientId, Set<string>>();
  #invite: { digest: string; expiresAt: number } | null = null;
  #loaded = false;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(options: { file?: string; now?: () => number } = {}) {
    this.#file = options.file ?? mobilePairingStatePath();
    this.#now = options.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    if (this.#loaded) return;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid mobile pairing state");
      }
      const state = parsed as Record<string, unknown>;
      if (state.version !== STATE_VERSION) throw new Error("Unsupported mobile pairing state");
      const invite = state.invite;
      if (
        invite &&
        typeof invite === "object" &&
        !Array.isArray(invite) &&
        typeof (invite as Record<string, unknown>).digest === "string" &&
        DIGEST_PATTERN.test((invite as Record<string, unknown>).digest as string) &&
        typeof (invite as Record<string, unknown>).expiresAt === "number"
      ) {
        const value = invite as Record<string, unknown>;
        this.#invite = {
          digest: value.digest as string,
          expiresAt: value.expiresAt as number,
        };
      }
      const clients = Array.isArray(state.clients) ? state.clients : [];
      for (const value of clients) {
        const client = parseClient(value);
        if (client) this.#clients.set(client.clientId, client);
      }
      this.#prune(this.#now());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#loaded = true;
  }

  /** A new QR secret invalidates the previous invite. It never changes existing paired clients. */
  async invite(): Promise<MobilePairingInvite> {
    return this.#serialized(async () => {
      const now = this.#now();
      this.#prune(now);
      const secret = randomBytes(INVITE_BYTES).toString("hex");
      this.#invite = { digest: digest(secret), expiresAt: now + MOBILE_PAIRING_INVITE_TTL_MS };
      await this.#flush();
      return { secret, expiresAt: this.#invite.expiresAt };
    });
  }

  /** One invite admits one client. The returned token is only returned by this method. */
  async redeem(
    secret: string,
    input: { clientId: unknown; label: unknown },
  ): Promise<{ clientId: HostClientId; label: string; token: string; expiresAt: number }> {
    return this.#serialized(async () => {
      const now = this.#now();
      this.#prune(now);
      if (!this.#invite || !sameDigest(this.#invite.digest, digest(secret))) {
        throw new MobilePairingError("invalid-invite", "This pairing code is no longer valid");
      }
      if (this.#invite.expiresAt <= now) {
        this.#invite = null;
        await this.#flush();
        throw new MobilePairingError("expired", "This pairing code has expired");
      }
      const parsedId = hostClientIdSchema.safeParse(input.clientId);
      const parsedLabel = hostClientLabelSchema.safeParse(input.label);
      if (!parsedId.success || !parsedLabel.success) {
        throw new MobilePairingError("invalid-client", "The client identity is invalid");
      }
      if (!this.#clients.has(parsedId.data) && this.#clients.size >= MOBILE_PAIRING_MAX_CLIENTS) {
        throw new MobilePairingError("full", "This Host already has the maximum paired Clients");
      }
      const token = randomBytes(TOKEN_BYTES).toString("hex");
      const expiresAt = now + MOBILE_PAIRING_CLIENT_TTL_MS;
      this.#clients.set(parsedId.data, {
        clientId: parsedId.data,
        label: parsedLabel.data,
        kind: "mobile",
        tokenDigest: digest(token),
        pairedAt: now,
        lastSeenAt: now,
        expiresAt,
      });
      // The invite is consumed only after the new credential is durable.
      this.#invite = null;
      await this.#flush();
      return { clientId: parsedId.data, label: parsedLabel.data, token, expiresAt };
    });
  }

  /** Authenticates the token, binds the connection to the hello identity, and updates its label. */
  async hello(value: unknown): Promise<MobilePairingSession> {
    return this.#serialized(async () => {
      const now = this.#now();
      this.#prune(now);
      const parsed = mobileClientHelloSchema.safeParse(value);
      if (!parsed.success) {
        throw new MobilePairingError("invalid-client", "The client hello is invalid");
      }
      const client = this.#clients.get(parsed.data.clientId);
      if (!client || !sameDigest(client.tokenDigest, digest(parsed.data.token))) {
        throw new MobilePairingError("revoked", "This Client is not paired with the Host");
      }
      if (client.expiresAt <= now) {
        this.#clients.delete(client.clientId);
        await this.#flush();
        throw new MobilePairingError("expired", "This Client pairing has expired");
      }
      const label = hostClientLabelSchema.safeParse(parsed.data.label);
      if (!label.success) {
        throw new MobilePairingError("invalid-client", "The client label is invalid");
      }
      client.label = label.data;
      client.lastSeenAt = now;
      client.expiresAt = now + MOBILE_PAIRING_CLIENT_TTL_MS;
      const connectionId = randomUUID();
      let connections = this.#connections.get(client.clientId);
      if (!connections) {
        connections = new Set();
        this.#connections.set(client.clientId, connections);
      }
      connections.add(connectionId);
      await this.#flush();
      return { clientId: client.clientId, label: client.label, connectionId };
    });
  }

  /** Idempotent: a socket may be disconnected and closed more than once. */
  async disconnect(session: MobilePairingSession): Promise<void> {
    const connections = this.#connections.get(session.clientId);
    if (!connections) return;
    connections.delete(session.connectionId);
    if (connections.size === 0) this.#connections.delete(session.clientId);
  }

  async revoke(clientId: string): Promise<boolean> {
    return this.#serialized(async () => {
      const parsed = hostClientIdSchema.safeParse(clientId);
      if (!parsed.success) {
        throw new MobilePairingError("invalid-client", "The client identity is invalid");
      }
      this.#prune(this.#now());
      const removed = this.#clients.delete(parsed.data);
      this.#connections.delete(parsed.data);
      if (removed) await this.#flush();
      return removed;
    });
  }

  async status(): Promise<MobilePairingStatus> {
    return this.#serialized(async () => {
      const now = this.#now();
      const pruned = this.#prune(now);
      if (pruned) await this.#flush();
      return mobilePairingStatusSchema.parse({
        clients: [...this.#clients.values()]
          .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
          .map((client) => ({
            clientId: client.clientId,
            label: client.label,
            kind: client.kind,
            connected: (this.#connections.get(client.clientId)?.size ?? 0) > 0,
            pairedAt: client.pairedAt,
            lastSeenAt: client.lastSeenAt,
          })),
      });
    });
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.initialize();
      return operation();
    };
    const result = this.#tail.then(run, run);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  /** Returns whether anything was removed; callers persist only after a real change. */
  #prune(now: number): boolean {
    let changed = false;
    if (this.#invite && this.#invite.expiresAt <= now) {
      this.#invite = null;
      changed = true;
    }
    for (const [clientId, client] of this.#clients) {
      if (client.expiresAt <= now) {
        this.#clients.delete(clientId);
        this.#connections.delete(clientId);
        changed = true;
      }
    }
    return changed;
  }

  async #flush(): Promise<void> {
    const state: StoredPairingState = {
      version: STATE_VERSION,
      invite: this.#invite,
      clients: [...this.#clients.values()],
    };
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.#file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

export function mobileClientId(): string {
  return opaqueId();
}
