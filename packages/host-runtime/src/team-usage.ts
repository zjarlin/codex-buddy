import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

import {
  USAGE_STATISTICS_RANGES,
  teamUsageMemberResponseSchema,
  teamUsagePairResultSchema,
  type TeamUsageMemberResponse,
  type TeamUsageMemberUsage,
  type TeamUsagePairResult,
  type TeamUsageSettingsSetParams,
  type TeamUsageSnapshot,
  type TeamUsageSnapshotParams,
  type TeamUsageState,
} from "@codexhost/shared-contracts";

import { TeamUsageDiscovery } from "./team-usage-discovery.js";
import {
  addressesWithPort,
  errorMessage,
  hashSecret,
  readJson,
  remoteAddress,
  sameCode,
  sameSecret,
  sendJson,
} from "./team-usage-http.js";
import {
  DEVICE_ID,
  MAX_PENDING,
  TeamUsageStateStore,
  dataDirectory,
  type TeamPeer,
  type TeamPending,
  type TeamState,
} from "./team-usage-state.js";
import type { UsageStatistics } from "./usage-statistics.js";

/** Separate UDP port: discovery traffic cannot collide with the usage listener. */
const DISCOVERY_PORT = 45_872;
const CODE_LIFETIME_MS = 5 * 60_000;
const PAIR_LIFETIME_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 4_000;
const CODE = /^\d{8}$/u;
const MAX_PEERS_PER_DIRECTION = 200;

/** Keeps the newest attempts so a burst of requests cannot exceed what the page renders. */
function trimPending(pending: TeamPending[]): TeamPending[] {
  if (pending.length <= MAX_PENDING) return pending;
  return pending.sort((left, right) => left.expiresAt - right.expiresAt).slice(-MAX_PENDING);
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export interface TeamUsageOptions {
  environment: NodeJS.ProcessEnv;
  /** The Host's own machine-wide statistics; team members only ever see a projection. */
  usage: () => UsageStatistics | undefined;
  diagnose?: (message: string) => void;
}

/**
 * Team usage: a LAN Host that answers usage projections to coordinators this member approved,
 * and a coordinator that pulls those projections from paired members. Pairing is explicit on
 * both sides and produces one shared secret per member; no member ever reads another's sessions.
 */
export class TeamUsage {
  readonly #states: TeamUsageStateStore;
  readonly #options: TeamUsageOptions;
  #server: Server | null = null;
  #port: number | null = null;
  #discovery: TeamUsageDiscovery | null = null;
  /** Port the running discovery announces; it must follow a listener moved to another port. */
  #discoveryPort: number | null = null;
  /** Settings as of the last write, so announcements do not need a listener restart. */
  #liveSettings: { name: string; department: string | null } | null = null;
  #tail: Promise<unknown> = Promise.resolve();
  /** Pair attempts per source address, so a LAN peer cannot enumerate the invite code. */
  readonly #attempts = new Map<string, number[]>();

  constructor(options: TeamUsageOptions) {
    this.#options = options;
    this.#states = new TeamUsageStateStore(
      path.join(dataDirectory(options.environment), "team-usage"),
    );
  }

  #serialized<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(action, action);
    this.#tail = next.catch(() => undefined);
    return next;
  }

  #publicState(state: TeamState): TeamUsageState {
    const now = Date.now();
    return {
      enabled: state.enabled,
      name: state.name,
      department: state.department,
      // The configured port stays visible while the listener is off, so it can be edited.
      port: this.#port ?? state.port,
      addresses: state.enabled ? addressesWithPort(this.#port) : [],
      invite:
        state.invite && state.invite.expiresAt > now
          ? {
              code: state.invite.code,
              expiresAt: state.invite.expiresAt,
              addresses: addressesWithPort(this.#port),
            }
          : null,
      pending: state.pending
        .filter((entry) => entry.expiresAt > now)
        .map((entry) => ({
          requestId: entry.requestId,
          name: entry.name,
          outbound: entry.outbound,
          address: entry.address,
          fingerprint: createHash("sha256").update(entry.requestId).digest("hex").slice(0, 16),
          expiresAt: entry.expiresAt,
        })),
      peers: state.peers.map((peer) => ({
        id: peer.id,
        name: peer.name,
        address: peer.address,
        department: peer.department,
        direction: peer.direction,
      })),
      discovered: (this.#discovery?.list() ?? []).map((peer) => ({
        id: peer.id,
        name: peer.name,
        department: peer.department,
        address: peer.address,
        seenAtMs: peer.seenAtMs,
      })),
    };
  }

  /** Starts or stops listening so the page's toggle takes effect without a Host restart. */
  async #apply(state: TeamState): Promise<void> {
    if (!state.enabled) {
      await this.#stop();
      return;
    }
    if (this.#server && this.#port === state.port) return;
    await this.#stop();
    const server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => {
        if (!response.headersSent)
          sendJson(response, 500, { error: errorMessage(error).slice(0, 200) });
      });
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = 10_000;
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(state.port, "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    }).catch((error: unknown) => {
      server.close();
      this.#options.diagnose?.(`Team usage listener: ${errorMessage(error)}`);
      throw new Error(
        `Cannot listen on port ${state.port}: ${errorMessage(error)}. Choose another port or turn team usage off.`,
      );
    });
    this.#server = server;
    this.#port = (server.address() as { port: number } | null)?.port ?? null;
  }

  async #stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    if (!server) return;
    // `close()` waits for live connections, and a pooled keep-alive socket would keep it open.
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections?.();
    await closed;
  }

  /** Discovery mirrors the listener: it needs the same enable switch and live port. */
  async #applyDiscovery(state: TeamState, id: string): Promise<void> {
    // Renaming or reassigning a department reaches the next announcement through `#liveSettings`,
    // so an unchanged listener keeps its socket instead of re-binding it on every save.
    if (!state.enabled || this.#port === null) {
      await this.#discovery?.close();
      this.#discovery = null;
      this.#discoveryPort = null;
      return;
    }
    if (this.#discovery !== null && this.#discoveryPort === this.#port) return;
    await this.#discovery?.close();
    this.#discovery = null;
    this.#discoveryPort = null;
    const port = this.#port;
    const discovery = new TeamUsageDiscovery({
      port: DISCOVERY_PORT,
      self: () => ({
        id,
        // Live settings: renaming or reassigning the department must reach the next announcement.
        name: this.#liveSettings?.name ?? state.name,
        department: this.#liveSettings?.department ?? state.department,
        port,
      }),
      ...(this.#options.diagnose === undefined ? {} : { diagnose: this.#options.diagnose }),
    });
    // A bind failure is reported inside `start()` and leaves the Host serving usage unseen; the
    // next save retries instead of keeping a socket that is already closed.
    if (!(await discovery.start())) return;
    this.#discovery = discovery;
    this.#discoveryPort = port;
  }

  /** Restores the saved listener state; a failure is reported, not thrown into startup. */
  async start(): Promise<void> {
    try {
      const state = await this.#states.read();
      this.#liveSettings = { name: state.name, department: state.department };
      await this.#apply(state);
      await this.#applyDiscovery(state, await this.#states.id());
    } catch (error) {
      this.#options.diagnose?.(`Team usage: ${errorMessage(error)}`);
    }
  }

  async close(): Promise<void> {
    await this.#discovery?.close();
    this.#discovery = null;
    this.#discoveryPort = null;
    await this.#stop();
  }

  async state(): Promise<TeamUsageState> {
    return this.#publicState(await this.#states.read());
  }

  async setSettings(input: TeamUsageSettingsSetParams): Promise<TeamUsageState> {
    return this.#serialized(async () => {
      const state = await this.#states.read();
      if (input.name !== undefined) state.name = input.name;
      if (input.department !== undefined) state.department = input.department;
      if (input.port !== undefined) state.port = input.port;
      if (input.enabled !== undefined) state.enabled = input.enabled;
      try {
        await this.#apply(state);
      } catch (error) {
        // Keep the previous preference out of effect: the page must show why it did not start.
        state.enabled = false;
        await this.#states.write(state);
        await this.#applyDiscovery(state, await this.#states.id());
        throw error;
      }
      await this.#states.write(state);
      this.#liveSettings = { name: state.name, department: state.department };
      await this.#applyDiscovery(state, await this.#states.id());
      return this.#publicState(state);
    });
  }

  async invite(): Promise<TeamUsageState> {
    return this.#serialized(async () => {
      const state = await this.#states.read();
      if (!state.enabled) throw new Error("Enable team usage on this Host first");
      state.invite = {
        code: String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, "0"),
        expiresAt: Date.now() + CODE_LIFETIME_MS,
      };
      await this.#states.write(state);
      return this.#publicState(state);
    });
  }

  async accept(requestId: string): Promise<TeamUsageState> {
    return this.#serialized(async () => {
      const state = await this.#states.read();
      const pending = state.pending.find(
        (entry) => entry.requestId === requestId && !entry.outbound,
      );
      if (!pending || pending.expiresAt <= Date.now()) throw new Error("Pairing request expired");
      const secret = randomBytes(32).toString("hex");
      const memberId = pending.memberId ?? requestId;
      // Re-approving a coordinator keeps the department this Host assigned to it.
      const previous = state.peers.find((peer) => peer.id === memberId && peer.direction === "in");
      if (
        !previous &&
        state.peers.filter((peer) => peer.direction === "in").length >= MAX_PEERS_PER_DIRECTION
      )
        throw new Error(`This Host already answers ${MAX_PEERS_PER_DIRECTION} coordinators`);
      state.peers = [
        ...state.peers.filter((peer) => peer.id !== memberId || peer.direction !== "in"),
        {
          id: memberId,
          pairingRequestId: requestId,
          name: pending.name,
          // The request only carries the coordinator's ephemeral source address; this Host never
          // calls it back, so no member endpoint is known for an inbound peer.
          address: null,
          secret,
          department: previous?.department ?? null,
          direction: "in",
          lastSeenAtMs: null,
        },
      ];
      state.pending = state.pending.filter((entry) => entry.requestId !== requestId);
      state.invite = null;
      await this.#states.write(state);
      return this.#publicState(state);
    });
  }

  async reject(requestId: string): Promise<TeamUsageState> {
    return this.#serialized(async () => {
      const state = await this.#states.read();
      state.pending = state.pending.filter((entry) => entry.requestId !== requestId);
      await this.#states.write(state);
      return this.#publicState(state);
    });
  }

  async memberSet(
    id: string,
    input: { name?: string | undefined; department?: string | null | undefined },
  ) {
    return this.#serialized(async () => {
      const state = await this.#states.read();
      const peers = state.peers.filter((entry) => entry.id === id);
      if (peers.length === 0) throw new Error("Unknown team member");
      for (const peer of peers) {
        if (input.name !== undefined) peer.name = input.name;
        if (input.department !== undefined) peer.department = input.department;
      }
      await this.#states.write(state);
      return this.#publicState(state);
    });
  }

  async memberRemove(id: string, direction?: "in" | "out"): Promise<TeamUsageState> {
    return this.#serialized(async () => {
      const state = await this.#states.read();
      // Dropping the readable row must not revoke that person's right to read this Host.
      state.peers = state.peers.filter(
        (peer) => peer.id !== id || (direction !== undefined && peer.direction !== direction),
      );
      await this.#states.write(state);
      return this.#publicState(state);
    });
  }

  /** Outbound pair attempt: the member answers `pending` until a human approves it there. */
  async pair(address: string, code: string): Promise<TeamUsagePairResult> {
    if (!CODE.test(code)) throw new Error("Pairing code must be eight digits");
    const state = await this.#states.read();
    if (state.peers.filter((peer) => peer.direction === "out").length >= MAX_PEERS_PER_DIRECTION)
      throw new Error(`This Host already reads ${MAX_PEERS_PER_DIRECTION} members`);
    const response = await this.#post(`http://${address}/v1/team-usage/pair`, {
      code,
      name: state.name,
      id: await this.#states.id(),
    });
    const requestId = response.requestId;
    if (typeof requestId !== "string" || !DEVICE_ID.test(requestId))
      throw new Error("Member returned an invalid pairing request");
    // The member's own ID is what a coordinator remembers; re-pairing the same Host replaces
    // its row instead of counting that person twice.
    const memberId =
      typeof response.id === "string" && DEVICE_ID.test(response.id) ? response.id : requestId;
    await this.#serialized(async () => {
      const next = await this.#states.read();
      // Keep reading the old row until the member approves this attempt: a rejected or abandoned
      // re-pairing must not blank that person's figures or the department assigned here.
      if (!next.pending.some((entry) => entry.requestId === requestId)) {
        next.pending = trimPending([
          ...next.pending,
          {
            requestId,
            name: typeof response.name === "string" ? response.name.slice(0, 120) : address,
            address,
            expiresAt: Date.now() + PAIR_LIFETIME_MS,
            outbound: true,
            memberId,
          },
        ]);
      }
      await this.#states.write(next);
    });
    return teamUsagePairResultSchema.parse({ status: "pending", requestId });
  }

  /** Resolves outbound pairing attempts and reads every reachable member's projection. */
  async snapshot(params: TeamUsageSnapshotParams): Promise<TeamUsageSnapshot> {
    await this.#resolvePending();
    const state = await this.#states.read();
    const statistics = this.#options.usage();
    if (!statistics) throw new Error("Usage statistics are unavailable on this Host");
    const local = await statistics.get({
      range: params.range,
      ...(params.timeZone === undefined ? {} : { timeZone: params.timeZone }),
    });
    const localUsage: TeamUsageMemberUsage = {
      totals: local.totals,
      byHarness: local.byHarness,
      byModel: local.byModel,
      byProject: local.byProject,
    };
    const members: TeamUsageSnapshot["members"] = [
      {
        id: "local",
        name: state.name,
        department: state.department,
        address: null,
        reachable: true,
        lastSeenAtMs: Date.now(),
        usage: localUsage,
      },
    ];
    const remote = await Promise.all(
      state.peers
        .filter((peer) => peer.direction === "out")
        .map(async (peer) => {
          if (peer.address === null) {
            return {
              id: peer.id,
              name: peer.name,
              department: peer.department,
              address: peer.address,
              reachable: false,
              lastSeenAtMs: peer.lastSeenAtMs,
              error: "This member has no registered address",
            };
          }
          try {
            const usage = await this.#memberUsage(peer, params);
            return {
              id: peer.id,
              name: peer.name,
              department: peer.department ?? usage.department ?? null,
              address: peer.address,
              reachable: true,
              lastSeenAtMs: Date.now(),
              usage: usage.usage,
            };
          } catch (error) {
            return {
              id: peer.id,
              name: peer.name,
              department: peer.department,
              address: peer.address,
              reachable: false,
              lastSeenAtMs: peer.lastSeenAtMs,
              error: errorMessage(error).slice(0, 2048),
            };
          }
        }),
    );
    await this.#rememberSeen(remote);
    members.push(...remote);
    return {
      range: params.range,
      from: local.from,
      to: local.to,
      timeZone: params.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      generatedAtMs: Date.now(),
      costBasis: "public-model-price",
      members,
    };
  }

  async #rememberSeen(
    remote: ReadonlyArray<{ id: string; reachable: boolean; lastSeenAtMs: number | null }>,
  ): Promise<void> {
    const seen = new Map(
      remote.flatMap((member) =>
        member.reachable && member.lastSeenAtMs !== null
          ? [[member.id, member.lastSeenAtMs] as const]
          : [],
      ),
    );
    if (seen.size === 0) return;
    await this.#serialized(async () => {
      const state = await this.#states.read();
      for (const peer of state.peers) {
        const at = seen.get(peer.id);
        if (at !== undefined) peer.lastSeenAtMs = at;
      }
      await this.#states.write(state);
    });
  }

  async #resolvePending(): Promise<void> {
    const state = await this.#states.read();
    const pending = state.pending.filter((entry) => entry.outbound);
    for (const entry of pending) {
      if (entry.address === null || entry.expiresAt <= Date.now()) continue;
      try {
        const result = await this.#get(
          `http://${entry.address}/v1/team-usage/pair/${entry.requestId}`,
        );
        if (result.status !== "approved") continue;
        const secret = typeof result.secret === "string" ? result.secret : "";
        if (secret.length < 32) continue;
        await this.#serialized(async () => {
          const next = await this.#states.read();
          const memberId = entry.memberId ?? entry.requestId;
          // Re-pairing the same person refreshes the row this Host reads and keeps the
          // department assigned here; an inbound row (their right to read this Host) stays.
          const existing = next.peers.find(
            (peer) =>
              (peer.id === memberId || peer.id === entry.requestId) && peer.direction === "out",
          );
          next.peers = next.peers.filter(
            (peer) =>
              peer.direction !== "out" || (peer.id !== memberId && peer.id !== entry.requestId),
          );
          next.peers.push({
            id: memberId,
            name: entry.name,
            address: entry.address,
            secret,
            department: existing?.department ?? null,
            direction: "out",
            lastSeenAtMs: existing?.lastSeenAtMs ?? null,
          });
          next.pending = next.pending.filter((item) => item.requestId !== entry.requestId);
          await this.#states.write(next);
        });
      } catch {
        // A member that is off now stays pending until its attempt expires.
      }
    }
  }

  async #memberUsage(
    peer: TeamPeer,
    params: TeamUsageSnapshotParams,
  ): Promise<TeamUsageMemberResponse> {
    if (peer.address === null) throw new Error("No member address");
    const query = new URLSearchParams({ range: params.range });
    if (params.timeZone !== undefined) query.set("timeZone", params.timeZone);
    const value = await this.#get(
      `http://${peer.address}/v1/team-usage/usage?${query.toString()}`,
      peer.secret,
    );
    return teamUsageMemberResponseSchema.parse(value);
  }

  async #get(url: string, secret?: string): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      headers: secret === undefined ? {} : { authorization: `Bearer ${secret}` },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok || !body || typeof body !== "object")
      throw new Error(`Member answered HTTP ${response.status}`);
    return body as Record<string, unknown>;
  }

  async #post(url: string, payload: object): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok || !body || typeof body !== "object")
      throw new Error(`Member answered HTTP ${response.status}`);
    return body as Record<string, unknown>;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://team-usage.local");
    if (url.pathname === "/v1/team-usage/pair" && request.method === "POST") {
      const address = remoteAddress(request);
      const recent = (this.#attempts.get(address) ?? []).filter(
        (time) => time > Date.now() - 60_000,
      );
      if (recent.length >= 20) {
        sendJson(response, 429, { error: "Too many pairing attempts" });
        return;
      }
      recent.push(Date.now());
      if (this.#attempts.size > 1_024 && !this.#attempts.has(address)) {
        // Only live entries matter; drop the oldest source once the map grows past a LAN's size.
        const [oldest] = this.#attempts.keys();
        if (oldest !== undefined) this.#attempts.delete(oldest);
      }
      this.#attempts.set(address, recent);
      const body = await readJson(request);
      if (
        !body ||
        typeof body.code !== "string" ||
        !CODE.test(body.code) ||
        typeof body.name !== "string" ||
        body.name.length === 0 ||
        body.name.length > 120 ||
        typeof body.id !== "string" ||
        !DEVICE_ID.test(body.id)
      ) {
        sendJson(response, 400, { error: "Invalid pairing request" });
        return;
      }
      const state = await this.#states.read();
      const invite = state.invite;
      if (!invite || invite.expiresAt <= Date.now() || !sameCode(invite.code, body.code)) {
        sendJson(response, 403, { error: "Pairing code is invalid or expired" });
        return;
      }
      const requestId = randomUUID();
      await this.#serialized(async () => {
        const next = await this.#states.read();
        next.pending = trimPending([
          ...next.pending.filter((entry) => entry.expiresAt > Date.now()),
          {
            requestId,
            name: body.name as string,
            address,
            expiresAt: Date.now() + PAIR_LIFETIME_MS,
            outbound: false,
            memberId: body.id as string,
          },
        ]);
        await this.#states.write(next);
      });
      sendJson(response, 200, { requestId, name: state.name, id: await this.#states.id() });
      return;
    }
    const status = /^\/v1\/team-usage\/pair\/([0-9a-f-]{36})$/u.exec(url.pathname);
    if (status && request.method === "GET" && DEVICE_ID.test(status[1] ?? "")) {
      const requestId = status[1] as string;
      const state = await this.#states.read();
      if (state.pending.some((entry) => entry.requestId === requestId && !entry.outbound)) {
        sendJson(response, 200, { status: "pending", requestId });
        return;
      }
      const peer = state.peers.find((entry) => entry.pairingRequestId === requestId);
      if (!peer) {
        sendJson(response, 404, { error: "Unknown pairing request" });
        return;
      }
      sendJson(response, 200, { status: "approved", requestId, secret: peer.secret });
      return;
    }
    if (url.pathname === "/v1/team-usage/usage" && request.method === "GET") {
      const header = request.headers.authorization ?? "";
      const secret = header.startsWith("Bearer ") ? header.slice(7) : "";
      const state = await this.#states.read();
      // Only secrets this Host issued to its coordinators authenticate a read; an outbound
      // secret belongs to the other member and must not work in the other direction.
      const authorized = state.peers.some(
        (peer) => peer.direction === "in" && sameSecret(hashSecret(peer.secret), secret),
      );
      if (!secret || !authorized) {
        sendJson(response, 401, { error: "Unknown member" });
        return;
      }
      const requested = url.searchParams.get("range") ?? "30d";
      const range = USAGE_STATISTICS_RANGES.find((value) => value === requested);
      if (range === undefined) {
        sendJson(response, 400, { error: "Unknown usage range" });
        return;
      }
      const timeZone = url.searchParams.get("timeZone") ?? undefined;
      if (timeZone !== undefined && !isTimeZone(timeZone)) {
        sendJson(response, 400, { error: "Unknown timezone" });
        return;
      }
      const statistics = this.#options.usage();
      if (!statistics) {
        sendJson(response, 503, { error: "Usage statistics are unavailable" });
        return;
      }
      const result = await statistics.get({
        range,
        ...(timeZone === undefined ? {} : { timeZone }),
      });
      sendJson(response, 200, {
        protocol: "codexhost-team-usage-v1",
        range: result.range,
        from: result.from,
        to: result.to,
        timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        name: state.name,
        ...(state.department === null ? {} : { department: state.department }),
        usage: {
          totals: result.totals,
          byHarness: result.byHarness,
          byModel: result.byModel,
          byProject: result.byProject,
        },
      });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  }
}
