import { createServer, type Server } from "node:http";
import { randomInt } from "node:crypto";
import { createPublicKey, verify } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const MAX_MESSAGE = 256 * 1024;
const CODE_LIFETIME = 5 * 60_000;
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface Participant {
  socket: WebSocket;
  id: string;
  key: string;
  name: string;
  exchangeKey: string;
  code: string | null;
  expiresAt: number;
  requests: number[];
  pending: Map<string, { from: string; expiresAt: number }>;
  trusted: Map<string, string>;
}

export function createProjectSyncRelay(): { server: Server; close(): Promise<void> } {
  const server = createServer((_request, response) => response.writeHead(404).end());
  const sockets = new WebSocketServer({
    server,
    maxPayload: MAX_MESSAGE,
    perMessageDeflate: false,
  });
  const devices = new Map<string, Participant>();
  const codes = new Map<string, Participant>();
  const identities = new Map<string, { key: string; exchangeKey: string }>();

  function send(socket: WebSocket, value: object): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  }

  sockets.on("connection", (socket) => {
    let participant: Participant | null = null;
    socket.on("message", (raw, isBinary) => {
      if (isBinary || raw.toString().length > MAX_MESSAGE) return socket.close(1009);
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(raw.toString());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          return socket.close(1003);
        message = parsed as Record<string, unknown>;
      } catch {
        return socket.close(1003);
      }
      const now = Date.now();
      if (message.type === "register" && !participant) {
        if (
          typeof message.id !== "string" ||
          !DEVICE_ID.test(message.id) ||
          typeof message.key !== "string" ||
          message.key.length > 256 ||
          typeof message.name !== "string" ||
          !message.name ||
          message.name.length > 100 ||
          typeof message.exchangeKey !== "string" ||
          message.exchangeKey.length > 256 ||
          typeof message.proof !== "string" ||
          message.proof.length > 256 ||
          (identities.has(message.id) &&
            (identities.get(message.id)?.key !== message.key ||
              identities.get(message.id)?.exchangeKey !== message.exchangeKey)) ||
          devices.has(message.id)
        )
          return socket.close(1008);
        try {
          const key = createPublicKey(message.key);
          if (
            key.asymmetricKeyType !== "ed25519" ||
            !verify(
              null,
              Buffer.from(`register:${message.id}`),
              key,
              Buffer.from(message.proof, "base64"),
            )
          )
            return socket.close(1008);
        } catch {
          return socket.close(1008);
        }
        participant = {
          socket,
          id: message.id,
          name: message.name,
          key: message.key,
          exchangeKey: message.exchangeKey,
          code: null,
          expiresAt: 0,
          requests: [],
          pending: new Map(),
          trusted: new Map(),
        };
        devices.set(participant.id, participant);
        identities.set(participant.id, {
          key: participant.key,
          exchangeKey: participant.exchangeKey,
        });
        send(socket, { type: "registered" });
        return;
      }
      if (!participant) return socket.close(1008);
      participant.requests = participant.requests.filter((time) => time > now - 60_000);
      if (participant.requests.length >= 120) return socket.close(1008);
      participant.requests.push(now);
      if (
        message.type === "trust" &&
        typeof message.peerId === "string" &&
        DEVICE_ID.test(message.peerId) &&
        typeof message.key === "string" &&
        message.key.length <= 256
      ) {
        participant.trusted.set(message.peerId, message.key);
        return;
      }
      if (
        message.type === "revoke" &&
        typeof message.peerId === "string" &&
        DEVICE_ID.test(message.peerId)
      ) {
        participant.trusted.delete(message.peerId);
        return;
      }
      if (message.type === "invite") {
        if (participant.code) codes.delete(participant.code);
        let code: string;
        do {
          code = String(randomInt(0, 100_000_000)).padStart(8, "0");
        } while (codes.has(code));
        participant.code = code;
        participant.expiresAt = now + CODE_LIFETIME;
        codes.set(code, participant);
        send(socket, { type: "invite", code, expiresAt: participant.expiresAt });
        return;
      }
      if (message.type === "request") {
        if (
          typeof message.code !== "string" ||
          !/^\d{8}$/u.test(message.code) ||
          typeof message.requestId !== "string" ||
          !DEVICE_ID.test(message.requestId) ||
          typeof message.name !== "string" ||
          message.name.length > 100 ||
          typeof message.proof !== "string" ||
          message.proof.length > 256 ||
          typeof message.exchangeKey !== "string" ||
          message.exchangeKey.length > 256
        )
          return socket.close(1008);
        const target = codes.get(message.code);
        if (!target || target.expiresAt < now || target === participant)
          return send(socket, { type: "error", requestId: message.requestId, reason: "expired" });
        target.pending.set(message.requestId, {
          from: participant.id,
          expiresAt: now + CODE_LIFETIME,
        });
        send(socket, {
          type: "candidate",
          requestId: message.requestId,
          id: target.id,
          name: target.name,
          key: target.key,
          exchangeKey: target.exchangeKey,
        });
        send(target.socket, {
          type: "request",
          requestId: message.requestId,
          from: participant.id,
          name: message.name,
          key: participant.key,
          exchangeKey: message.exchangeKey,
          proof: message.proof,
          code: message.code,
        });
        return;
      }
      if (
        message.type === "forward" &&
        typeof message.to === "string" &&
        DEVICE_ID.test(message.to) &&
        typeof message.payload === "string" &&
        message.payload.length < MAX_MESSAGE
      ) {
        const target = devices.get(message.to);
        if (!target) {
          send(socket, { type: "error", requestId: message.requestId, reason: "offline" });
          return;
        }
        if (message.pairing === true && typeof message.requestId === "string") {
          const pending = participant.pending.get(message.requestId);
          if (!pending || pending.from !== target.id || pending.expiresAt < now) return;
          participant.pending.delete(message.requestId);
          if (participant.code) codes.delete(participant.code);
          participant.code = null;
        } else if (
          participant.trusted.get(target.id) !== target.key ||
          target.trusted.get(participant.id) !== participant.key
        ) {
          send(socket, { type: "error", requestId: message.requestId, reason: "untrusted" });
          return;
        }
        send(target.socket, {
          type: "forward",
          from: participant.id,
          key: participant.key,
          payload: message.payload,
        });
        return;
      }
      socket.close(1008);
    });
    socket.on("close", () => {
      if (!participant) return;
      if (devices.get(participant.id) === participant) devices.delete(participant.id);
      if (participant.code) codes.delete(participant.code);
    });
  });
  return {
    server,
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
