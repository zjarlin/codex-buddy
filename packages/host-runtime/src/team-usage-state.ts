import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const STATE_VERSION = 1;
const DEFAULT_PORT = 45_871;
export const DEVICE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface TeamPeer {
  /** The person's stable member ID, never a single pairing attempt. */
  id: string;
  /** The pairing attempt that approved this peer, so only it can fetch the secret. */
  pairingRequestId?: string;
  name: string;
  /** Where this member's Host answers; null when only the member knows the coordinator. */
  address: string | null;
  secret: string;
  department: string | null;
  /** `in`: approved a coordinator; `out`: this Host pulled that member. */
  direction: "in" | "out";
  lastSeenAtMs: number | null;
}

export interface TeamPending {
  requestId: string;
  name: string;
  address: string | null;
  expiresAt: number;
  /** Outbound attempts poll the member; inbound ones wait for a local approval. */
  outbound: boolean;
  /**
   * The member's own stable ID, which is what a coordinator remembers. Older state has none and
   * falls back to the pairing request ID.
   */
  memberId?: string;
}

export interface TeamState {
  version: 1;
  enabled: boolean;
  port: number;
  name: string;
  department: string | null;
  invite: { code: string; expiresAt: number } | null;
  peers: TeamPeer[];
  pending: TeamPending[];
}

export function dataDirectory(environment: NodeJS.ProcessEnv): string {
  return environment.CODEXHOST_DATA_DIR
    ? path.resolve(environment.CODEXHOST_DATA_DIR)
    : path.join(os.homedir(), ".codexhost");
}

export function defaultName(): string {
  return os.hostname().slice(0, 120) || "codexhost";
}

/**
 * Settings, peers and the pending pairing attempts of one Host. Every read validates what an older
 * or hand-edited file could contain, so a malformed row is dropped instead of breaking the page.
 */
export class TeamUsageStateStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  /**
   * Stable member identity, kept beside the settings: coordinators remember a member by this ID,
   * so regenerating it on every start would orphan their pairing and department.
   */
  async id(): Promise<string> {
    const file = path.join(this.#directory, "id");
    try {
      const value = (await readFile(file, "utf8")).trim();
      if (DEVICE_ID.test(value)) return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const id = randomUUID();
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await writeFile(file, `${id}\n`, { mode: 0o600, flag: "wx" }).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    const stored = (await readFile(file, "utf8")).trim();
    return DEVICE_ID.test(stored) ? stored : id;
  }

  async read(): Promise<TeamState> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.#directory, "state.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        version: STATE_VERSION,
        enabled: false,
        port: DEFAULT_PORT,
        name: defaultName(),
        department: null,
        invite: null,
        peers: [],
        pending: [],
      };
    }
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid team usage state");
    const record = value as Record<string, unknown>;
    if (record.version !== STATE_VERSION) throw new Error("Unsupported team usage state");
    const peers = Array.isArray(record.peers)
      ? record.peers.flatMap((peer): TeamPeer[] => {
          if (!peer || typeof peer !== "object") return [];
          const item = peer as Record<string, unknown>;
          if (
            typeof item.id !== "string" ||
            !DEVICE_ID.test(item.id) ||
            typeof item.name !== "string" ||
            typeof item.secret !== "string" ||
            (item.direction !== "in" && item.direction !== "out")
          )
            return [];
          return [
            {
              id: item.id,
              ...(typeof item.pairingRequestId === "string" && DEVICE_ID.test(item.pairingRequestId)
                ? { pairingRequestId: item.pairingRequestId }
                : {}),
              name: item.name.slice(0, 120),
              address: typeof item.address === "string" ? item.address : null,
              secret: item.secret,
              department: typeof item.department === "string" ? item.department : null,
              direction: item.direction,
              lastSeenAtMs: typeof item.lastSeenAtMs === "number" ? item.lastSeenAtMs : null,
            },
          ];
        })
      : [];
    const pending = Array.isArray(record.pending)
      ? record.pending.flatMap((entry): TeamPending[] => {
          if (!entry || typeof entry !== "object") return [];
          const item = entry as Record<string, unknown>;
          if (
            typeof item.requestId !== "string" ||
            typeof item.name !== "string" ||
            typeof item.expiresAt !== "number" ||
            typeof item.outbound !== "boolean"
          )
            return [];
          return [
            {
              requestId: item.requestId,
              name: item.name.slice(0, 120),
              address: typeof item.address === "string" ? item.address : null,
              expiresAt: item.expiresAt,
              outbound: item.outbound,
              ...(typeof item.memberId === "string" && DEVICE_ID.test(item.memberId)
                ? { memberId: item.memberId }
                : {}),
            },
          ];
        })
      : [];
    return {
      version: STATE_VERSION,
      enabled: record.enabled === true,
      port:
        typeof record.port === "number" && record.port >= 1 && record.port <= 65_535
          ? record.port
          : DEFAULT_PORT,
      name: typeof record.name === "string" && record.name ? record.name : defaultName(),
      department: typeof record.department === "string" ? record.department : null,
      invite:
        record.invite &&
        typeof record.invite === "object" &&
        typeof (record.invite as Record<string, unknown>).code === "string" &&
        typeof (record.invite as Record<string, unknown>).expiresAt === "number"
          ? {
              code: (record.invite as Record<string, string>).code,
              expiresAt: (record.invite as Record<string, number>).expiresAt,
            }
          : null,
      peers,
      pending: pending.filter((entry) => entry.expiresAt > Date.now()),
    };
  }

  async write(state: TeamState): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.#directory, "state.json");
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
  }
}
