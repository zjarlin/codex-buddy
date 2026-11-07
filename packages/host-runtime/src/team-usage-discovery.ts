import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";

const PROTOCOL = "codexhost-team-usage-discovery-v1";
const ANNOUNCE_MS = 5_000;
const TTL_MS = 20_000;
const MAX_SEEN = 64;

export interface DiscoveryAnnouncement {
  id: string;
  name: string;
  department: string | null;
  port: number;
}

export interface DiscoveredHost extends DiscoveryAnnouncement {
  /** `host:port` of the member's usage endpoint, from the packet source and announced port. */
  address: string;
  seenAtMs: number;
}

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Directed broadcast of one IPv4 interface: the host bits all set. A /31, /32 or a mask that
 * would broadcast to the host itself has no usable directed broadcast.
 */
export function broadcastAddress(address: string, netmask: string): string | null {
  const toBytes = (value: string): number[] | null => {
    const parts = value.split(".");
    if (parts.length !== 4) return null;
    const bytes = parts.map((part) => (/^\d{1,3}$/u.test(part) ? Number(part) : -1));
    return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
  };
  const host = toBytes(address);
  const mask = toBytes(netmask);
  if (!host || !mask) return null;
  const broadcast = host.map((byte, index) => (byte | (~(mask[index] ?? 0) & 255)) & 255);
  // Fewer than two host bits means the "broadcast" is the other host or this host itself: a /31,
  // /32 or a bogus mask has no usable directed broadcast.
  const hostBits = mask.reduce((total, byte) => total + (255 - byte), 0);
  if (hostBits < 2) return null;
  return broadcast.join(".");
}

/** Broadcast targets of this machine: each IPv4 subnet's broadcast plus the limited broadcast. */
export function broadcastTargets(): string[] {
  const targets = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const directed = broadcastAddress(entry.address, entry.netmask);
      if (directed !== null) targets.add(directed);
    }
  }
  targets.add("255.255.255.255");
  return [...targets];
}

/** One announcement from a LAN peer, or null when the packet is not ours or is malformed. */
export function parseAnnouncement(value: unknown, source: string): DiscoveredHost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.protocol !== PROTOCOL) return null;
  if (typeof record.id !== "string" || !DEVICE_ID.test(record.id)) return null;
  if (typeof record.name !== "string" || record.name.length === 0 || record.name.length > 120)
    return null;
  if (
    record.department !== undefined &&
    record.department !== null &&
    (typeof record.department !== "string" || record.department.length > 120)
  )
    return null;
  const port = record.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return {
    id: record.id,
    name: record.name,
    department: typeof record.department === "string" ? record.department : null,
    port,
    address: `${source}:${port}`,
    seenAtMs: Date.now(),
  };
}

/**
 * Announces this Host on the local network and remembers the peers that do the same. Only a name,
 * department and port travel; usage needs the explicit pairing code, so discovery never shares
 * figures. Announcements are unauthenticated and are shown as discovered, never as paired.
 */
export class TeamUsageDiscovery {
  readonly #port: number;
  readonly #self: () => DiscoveryAnnouncement | null;
  readonly #diagnose: ((message: string) => void) | undefined;
  readonly #peers = new Map<string, DiscoveredHost>();
  #socket: Socket | null = null;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: {
    port: number;
    self: () => DiscoveryAnnouncement | null;
    diagnose?: (message: string) => void;
  }) {
    this.#port = options.port;
    this.#self = options.self;
    this.#diagnose = options.diagnose;
  }

  /** False when the discovery port is taken; the Host still serves usage, it is just invisible. */
  async start(): Promise<boolean> {
    if (this.#socket) return true;
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    // A persistent error handler keeps a later socket error from crashing the Host.
    socket.on("error", (error: Error) =>
      this.#diagnose?.(`Team usage discovery: ${error.message}`),
    );
    socket.on("message", (buffer: Buffer, remote: RemoteInfo) => {
      if (buffer.length > 4_096) return;
      let value: unknown;
      try {
        value = JSON.parse(buffer.toString("utf8"));
      } catch {
        return;
      }
      const peer = parseAnnouncement(value, remote.address);
      if (!peer || peer.id === this.#self()?.id) return;
      this.#peers.set(peer.id, peer);
      if (this.#peers.size > MAX_SEEN) {
        const oldest = [...this.#peers.values()].sort(
          (left, right) => left.seenAtMs - right.seenAtMs,
        )[0];
        if (oldest) this.#peers.delete(oldest.id);
      }
    });
    // Bind failure is reported, not fatal: this Host keeps serving usage, it just cannot be
    // discovered. The promise must always settle or Host startup would wait forever.
    const bound = await new Promise<boolean>((resolve) => {
      const failed = (error: Error): void => {
        this.#diagnose?.(`Team usage discovery: ${error.message}`);
        resolve(false);
      };
      socket.once("error", failed);
      socket.bind(this.#port, () => {
        socket.off("error", failed);
        socket.setBroadcast(true);
        resolve(true);
      });
    });
    if (!bound) {
      socket.close();
      return false;
    }
    this.#socket = socket;
    this.#announce();
    this.#timer = setInterval(() => this.#announce(), ANNOUNCE_MS);
    return true;
  }

  #announce(): void {
    const socket = this.#socket;
    const self = this.#self();
    if (!socket || !self) return;
    const payload = Buffer.from(
      JSON.stringify({
        protocol: PROTOCOL,
        id: self.id,
        name: self.name,
        department: self.department,
        port: self.port,
      }),
    );
    for (const target of broadcastTargets()) {
      socket.send(payload, this.#port, target, (error) => {
        if (error) this.#diagnose?.(`Team usage discovery: ${error.message}`);
      });
    }
  }

  /** Peers heard from within the TTL, newest first. */
  list(): DiscoveredHost[] {
    const now = Date.now();
    for (const [id, peer] of this.#peers) {
      if (now - peer.seenAtMs > TTL_MS) this.#peers.delete(id);
    }
    return [...this.#peers.values()].sort((left, right) => right.seenAtMs - left.seenAtMs);
  }

  async close(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    const socket = this.#socket;
    this.#socket = null;
    this.#peers.clear();
    if (!socket) return;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }
}
