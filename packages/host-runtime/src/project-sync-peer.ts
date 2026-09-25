import { createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

import {
  projectSyncInviteSchema,
  projectSyncSnapshotSchema,
  type ProjectSyncInvite,
  type ProjectSyncSnapshot,
} from "@codexhost/shared-contracts";

import {
  createDeviceIdentity,
  keyFingerprint,
  open,
  seal,
  signature,
  validatedKey,
  verifySignature,
  type DeviceIdentity,
} from "./project-sync-crypto.js";
import { ProjectSync, type ProjectEntry } from "./project-sync.js";
import { ProjectSyncGit } from "./project-sync-git.js";

const TIMEOUT = 15_000;
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_RELAY = "wss://aio.addzero.site/codexhost-relay/";

type Peer = { id: string; name: string; publicKey: string; exchangePublicKey: string };
type Pending = Peer & { requestId: string; code: string; expiresAt: number };
type Waiting = {
  peer: Peer;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class ProjectSyncPeer {
  readonly #store: ProjectSync;
  readonly #git: ProjectSyncGit;
  readonly #directory: string;
  readonly #relay: string | null;
  #identity: DeviceIdentity | null = null;
  #socket: WebSocket | null = null;
  #connection: Promise<void> | null = null;
  #closed = false;
  #invite: { code: string; expiresAt: number } | null = null;
  readonly #pending = new Map<string, Pending>();
  readonly #waiting = new Map<string, Waiting>();
  readonly #responses = new Map<
    string,
    {
      resolve: (payload: ProjectEntry[]) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  readonly #seen = new Map<string, number>();
  readonly #messages = new Set<(value: Record<string, unknown>) => void>();

  constructor(environment: NodeJS.ProcessEnv = process.env, store = new ProjectSync(environment)) {
    this.#store = store;
    this.#git = new ProjectSyncGit(store);
    this.#directory = path.join(
      environment.CODEXHOST_DATA_DIR
        ? path.resolve(environment.CODEXHOST_DATA_DIR)
        : path.join(os.homedir(), ".codexhost"),
      "project-sync",
    );
    const relay = environment.CODEXHOST_PROJECT_SYNC_RELAY_URL ?? DEFAULT_RELAY;
    if (relay) {
      const url = new URL(relay);
      if (
        !["wss:", "ws:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol === "ws:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      )
        throw new Error("Project sync relay must use WSS (or local WS)");
      this.#relay = url.toString();
    } else this.#relay = null;
  }

  async #device(): Promise<DeviceIdentity> {
    if (this.#identity) return this.#identity;
    const file = path.join(this.#directory, "device.json");
    try {
      const value = JSON.parse(await readFile(file, "utf8")) as DeviceIdentity;
      if (
        !DEVICE_ID.test(value.id) ||
        !value.name ||
        !value.privateKey ||
        validatedKey(value.publicKey, "ed25519") !== value.publicKey ||
        validatedKey(value.exchangePublicKey, "x25519") !== value.exchangePublicKey ||
        createPublicKey(createPrivateKey(value.privateKey))
          .export({ type: "spki", format: "pem" })
          .toString() !== value.publicKey ||
        createPublicKey(createPrivateKey(value.exchangePrivateKey))
          .export({ type: "spki", format: "pem" })
          .toString() !== value.exchangePublicKey
      )
        throw new Error("Invalid device identity");
      this.#identity = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const value = createDeviceIdentity(os.hostname());
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      try {
        await writeFile(file, JSON.stringify(value), { mode: 0o600, flag: "wx" });
        this.#identity = value;
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
        return this.#device();
      }
    }
    return this.#identity;
  }

  async #connect(): Promise<void> {
    if (this.#closed) throw new Error("Project sync is closed");
    if (!this.#relay)
      throw new Error("Configure CODEXHOST_PROJECT_SYNC_RELAY_URL for device pairing");
    if (this.#socket?.readyState === WebSocket.OPEN) return;
    if (this.#connection) return this.#connection;
    const relay = this.#relay;
    this.#connection = (async () => {
      const identity = await this.#device();
      const socket = new WebSocket(relay, { maxPayload: 256 * 1024, perMessageDeflate: false });
      this.#socket = socket;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.terminate();
          reject(new Error("Relay connection timed out"));
        }, TIMEOUT);
        socket.on("open", () =>
          socket.send(
            JSON.stringify({
              type: "register",
              id: identity.id,
              name: identity.name,
              key: identity.publicKey,
              exchangeKey: identity.exchangePublicKey,
              proof: sign(
                null,
                Buffer.from(`register:${identity.id}`),
                identity.privateKey,
              ).toString("base64"),
            }),
          ),
        );
        socket.on("message", (raw, binary) => {
          if (binary) return socket.close(1003);
          let value: Record<string, unknown>;
          try {
            value = JSON.parse(raw.toString()) as Record<string, unknown>;
          } catch {
            return socket.close(1003);
          }
          if (value.type === "registered") {
            clearTimeout(timer);
            void this.#store
              .peers()
              .then((peers) => {
                for (const peer of peers)
                  socket.send(
                    JSON.stringify({ type: "trust", peerId: peer.id, key: peer.publicKey }),
                  );
                resolve();
              })
              .catch(reject);
          } else void this.#receive(value).catch(() => undefined);
          for (const listener of this.#messages) listener(value);
        });
        socket.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        socket.on("close", () => {
          clearTimeout(timer);
          if (this.#socket === socket) this.#socket = null;
          reject(new Error("Relay disconnected"));
          for (const [id, waiting] of this.#waiting) {
            clearTimeout(waiting.timer);
            waiting.reject(new Error("Relay disconnected"));
            this.#waiting.delete(id);
          }
          for (const [id, response] of this.#responses) {
            clearTimeout(response.timer);
            response.reject(new Error("Relay disconnected"));
            this.#responses.delete(id);
          }
        });
      });
    })().finally(() => {
      this.#connection = null;
    });
    return this.#connection;
  }

  #send(value: object): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) throw new Error("Relay is offline");
    this.#socket.send(JSON.stringify(value));
  }

  #waitFor(
    type: string,
    matches: (message: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#messages.delete(listener);
        reject(new Error("Peer did not respond"));
      }, TIMEOUT);
      const listener = (message: Record<string, unknown>) => {
        if (message.type !== type || !matches(message)) return;
        clearTimeout(timer);
        this.#messages.delete(listener);
        resolve(message);
      };
      this.#messages.add(listener);
    });
  }

  async #receive(message: Record<string, unknown>): Promise<void> {
    const identity = await this.#device();
    if (message.type === "error" && typeof message.requestId === "string") {
      const response = this.#responses.get(message.requestId);
      if (response) {
        clearTimeout(response.timer);
        this.#responses.delete(message.requestId);
        response.reject(
          new Error(
            message.reason === "untrusted"
              ? "Peer no longer trusts this device"
              : "Peer is offline",
          ),
        );
      }
      return;
    }
    if (message.type === "request") {
      if (
        typeof message.requestId !== "string" ||
        !DEVICE_ID.test(message.requestId) ||
        typeof message.from !== "string" ||
        !DEVICE_ID.test(message.from) ||
        typeof message.name !== "string" ||
        !message.name ||
        message.name.length > 100 ||
        typeof message.code !== "string" ||
        typeof message.key !== "string" ||
        typeof message.exchangeKey !== "string"
      )
        return;
      const invite = this.#invite;
      if (!invite || invite.expiresAt < Date.now() || invite.code !== message.code) return;
      const peer: Peer = {
        id: message.from,
        name: message.name,
        publicKey: validatedKey(message.key, "ed25519"),
        exchangePublicKey: validatedKey(message.exchangeKey, "x25519"),
      };
      const request = {
        requestId: message.requestId,
        id: peer.id,
        name: peer.name,
        key: peer.publicKey,
        exchangeKey: peer.exchangePublicKey,
        code: message.code,
      };
      if (!verifySignature(peer.publicKey, request, message.proof)) return;
      this.#pending.set(message.requestId, {
        ...peer,
        requestId: message.requestId,
        code: message.code,
        expiresAt: invite.expiresAt,
      });
      return;
    }
    if (
      message.type !== "forward" ||
      typeof message.from !== "string" ||
      typeof message.payload !== "string"
    )
      return;
    let peer = (await this.#store.peers()).find((entry) => entry.id === message.from);
    if (!peer) {
      for (const waiting of this.#waiting.values())
        if (waiting.peer.id === message.from) peer = waiting.peer;
    }
    if (!peer || message.key !== peer.publicKey) return;
    const decoded = open(identity, peer, message.payload);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return;
    const data = decoded as Record<string, unknown>;
    if (data.type === "accepted" && typeof data.requestId === "string") {
      const waiting = this.#waiting.get(data.requestId);
      if (!waiting || waiting.peer.id !== peer.id) return;
      const proof = {
        requestId: data.requestId,
        id: peer.id,
        key: peer.publicKey,
        exchangeKey: peer.exchangePublicKey,
      };
      if (!verifySignature(peer.publicKey, proof, data.proof)) return;
      clearTimeout(waiting.timer);
      this.#waiting.delete(data.requestId);
      await this.#store.trust(waiting.peer);
      this.#send({ type: "trust", peerId: waiting.peer.id, key: waiting.peer.publicKey });
      waiting.resolve();
      return;
    }
    if (data.type === "rejected" && typeof data.requestId === "string") {
      const waiting = this.#waiting.get(data.requestId);
      if (waiting && waiting.peer.id === peer.id) {
        clearTimeout(waiting.timer);
        this.#waiting.delete(data.requestId);
        waiting.reject(new Error("Pairing was declined"));
      }
      return;
    }
    if (
      typeof data.nonce !== "string" ||
      !DEVICE_ID.test(data.nonce) ||
      typeof data.timestamp !== "number" ||
      Math.abs(Date.now() - data.timestamp) > 60_000 ||
      this.#seen.has(`${peer.id}:${data.nonce}`)
    )
      return;
    const trusted = (await this.#store.peers()).some(
      (entry) => entry.id === peer.id && entry.publicKey === peer.publicKey,
    );
    if (!trusted) return;
    this.#seen.set(`${peer.id}:${data.nonce}`, Date.now());
    for (const [nonce, when] of this.#seen)
      if (when < Date.now() - 60_000) this.#seen.delete(nonce);
    if (data.type === "sync" && Array.isArray(data.projects)) {
      await this.#store.merge(data.projects as ProjectEntry[]);
      this.#send({
        type: "forward",
        to: peer.id,
        payload: seal(identity, peer, {
          type: "snapshot",
          nonce: randomUUID(),
          timestamp: Date.now(),
          requestId: data.nonce,
          projects: await this.#store.entries(),
        }),
      });
    } else if (
      data.type === "snapshot" &&
      typeof data.requestId === "string" &&
      Array.isArray(data.projects)
    ) {
      const response = this.#responses.get(data.requestId);
      if (response) {
        clearTimeout(response.timer);
        this.#responses.delete(data.requestId);
        response.resolve(data.projects as ProjectEntry[]);
      }
    }
  }

  async invite(): Promise<ProjectSyncInvite> {
    await this.#connect();
    const waiting = this.#waitFor("invite", (message) => typeof message.code === "string");
    this.#send({ type: "invite" });
    const result = await waiting;
    const invite = projectSyncInviteSchema.parse({
      code: result.code,
      expiresAt: result.expiresAt,
    });
    this.#invite = invite;
    return invite;
  }

  async pair(code: string): Promise<ProjectSyncSnapshot> {
    if (!/^\d{8}$/u.test(code)) throw new Error("Invalid pairing code");
    await this.#connect();
    const identity = await this.#device();
    const requestId = randomUUID();
    const request = {
      requestId,
      id: identity.id,
      name: identity.name,
      key: identity.publicKey,
      exchangeKey: identity.exchangePublicKey,
      code,
    };
    const peerPromise = this.#waitFor("candidate", (message) => message.requestId === requestId);
    this.#send({ type: "request", ...request, proof: signature(identity, request) });
    const candidate = await peerPromise;
    const peer: Peer = {
      id: String(candidate.id),
      name: String(candidate.name),
      publicKey: validatedKey(candidate.key, "ed25519"),
      exchangePublicKey: validatedKey(candidate.exchangeKey, "x25519"),
    };
    if (!DEVICE_ID.test(peer.id) || !peer.name || peer.name.length > 100)
      throw new Error("Invalid peer response");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(requestId);
        reject(new Error("Pairing approval timed out"));
      }, 5 * 60_000);
      this.#waiting.set(requestId, { peer, resolve, reject, timer });
    });
    return this.inspect();
  }

  async accept(requestId: string): Promise<ProjectSyncSnapshot> {
    await this.#connect();
    const pending = this.#pending.get(requestId);
    if (!pending || pending.expiresAt < Date.now()) throw new Error("Pairing request expired");
    const identity = await this.#device();
    const proof = {
      requestId,
      id: identity.id,
      key: identity.publicKey,
      exchangeKey: identity.exchangePublicKey,
    };
    const peer: Peer = pending;
    this.#send({
      type: "forward",
      to: peer.id,
      pairing: true,
      requestId,
      payload: seal(identity, peer, {
        type: "accepted",
        requestId,
        proof: signature(identity, proof),
      }),
    });
    await this.#store.trust(peer);
    this.#send({ type: "trust", peerId: peer.id, key: peer.publicKey });
    this.#pending.delete(requestId);
    this.#invite = null;
    return this.inspect();
  }

  async reject(requestId: string): Promise<ProjectSyncSnapshot> {
    const pending = this.#pending.get(requestId);
    if (pending) {
      const identity = await this.#device();
      this.#send({
        type: "forward",
        to: pending.id,
        pairing: true,
        requestId,
        payload: seal(identity, pending, { type: "rejected", requestId }),
      });
      this.#pending.delete(requestId);
    }
    return this.inspect();
  }

  async sync(peerId: string): Promise<ProjectSyncSnapshot> {
    await this.#connect();
    const identity = await this.#device();
    const peer = (await this.#store.peers()).find((entry) => entry.id === peerId);
    if (!peer) throw new Error("Device is not paired");
    const nonce = randomUUID();
    const result = new Promise<ProjectEntry[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#responses.delete(nonce);
        reject(new Error("Peer is offline or did not respond"));
      }, TIMEOUT);
      this.#responses.set(nonce, { resolve, reject, timer });
    });
    try {
      this.#send({
        type: "forward",
        to: peer.id,
        requestId: nonce,
        payload: seal(identity, peer, {
          type: "sync",
          nonce,
          timestamp: Date.now(),
          projects: await this.#store.entries(),
        }),
      });
    } catch (error) {
      const response = this.#responses.get(nonce);
      if (response) {
        clearTimeout(response.timer);
        this.#responses.delete(nonce);
        response.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return result.then((entries) => this.#store.merge(entries));
    }
    return this.#store.merge(await result);
  }

  async inspect(): Promise<ProjectSyncSnapshot> {
    if (this.#relay && !this.#closed && this.#socket?.readyState !== WebSocket.OPEN) {
      await this.#connect().catch(() => undefined);
    }
    const snapshot = await this.#store.inspect();
    return projectSyncSnapshotSchema.parse({
      ...snapshot,
      pending: [...this.#pending.values()]
        .filter((item) => item.expiresAt > Date.now())
        .map(({ requestId, name, publicKey }) => ({
          requestId,
          name,
          fingerprint: keyFingerprint(publicKey),
        })),
      connected: this.#socket?.readyState === WebSocket.OPEN,
      relay: this.#relay,
    });
  }
  add(folder: string): Promise<ProjectSyncSnapshot> {
    return this.#store.add(folder).then(() => this.inspect());
  }
  bind(remote: string, folder: string): Promise<ProjectSyncSnapshot> {
    return this.#store.bind(remote, folder).then(() => this.inspect());
  }
  clone(remote: string, parent: string): Promise<ProjectSyncSnapshot> {
    return this.#store.clone(remote, parent).then(() => this.inspect());
  }
  async removePeer(id: string): Promise<ProjectSyncSnapshot> {
    await this.#store.removePeer(id);
    if (this.#socket?.readyState === WebSocket.OPEN) this.#send({ type: "revoke", peerId: id });
    return this.inspect();
  }
  configureGit(remote: string | null): Promise<ProjectSyncSnapshot> {
    return this.#store.configureGit(remote).then(() => this.inspect());
  }
  async pullGit(): Promise<ProjectSyncSnapshot> {
    await this.#git.pull();
    return this.inspect();
  }
  async pushGit(): Promise<ProjectSyncSnapshot> {
    await this.#git.push();
    return this.inspect();
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#socket?.terminate();
    this.#socket = null;
    this.#invite = null;
    this.#pending.clear();
  }
}
