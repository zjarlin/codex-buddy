import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";

export interface DeviceIdentity {
  id: string;
  name: string;
  publicKey: string;
  privateKey: string;
  exchangePublicKey: string;
  exchangePrivateKey: string;
}

export function createDeviceIdentity(name: string): DeviceIdentity {
  const signing = generateKeyPairSync("ed25519");
  const exchange = generateKeyPairSync("x25519");
  return {
    id: randomUUID(),
    name: name.slice(0, 100),
    publicKey: signing.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: signing.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    exchangePublicKey: exchange.publicKey.export({ type: "spki", format: "pem" }).toString(),
    exchangePrivateKey: exchange.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function validatedKey(value: unknown, kind: "ed25519" | "x25519"): string {
  if (typeof value !== "string" || value.length > 256) throw new Error("Invalid device key");
  const key = createPublicKey(value);
  if (key.asymmetricKeyType !== kind) throw new Error("Invalid device key type");
  return key.export({ type: "spki", format: "pem" }).toString();
}

export function signature(identity: DeviceIdentity, value: object): string {
  return sign(null, Buffer.from(JSON.stringify(value)), identity.privateKey).toString("base64");
}

export function verifySignature(publicKey: string, value: object, proof: unknown): boolean {
  return (
    typeof proof === "string" &&
    proof.length <= 256 &&
    verify(null, Buffer.from(JSON.stringify(value)), publicKey, Buffer.from(proof, "base64"))
  );
}

function sessionKey(identity: DeviceIdentity, peer: { exchangePublicKey: string }): Buffer {
  const secret = diffieHellman({
    privateKey: createPrivateKey(identity.exchangePrivateKey),
    publicKey: createPublicKey(peer.exchangePublicKey),
  });
  return createHash("sha256").update("codexhost-project-sync-v1").update(secret).digest();
}

export function seal(
  identity: DeviceIdentity,
  peer: { exchangePublicKey: string },
  payload: object,
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(identity, peer), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return JSON.stringify({
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  });
}

export function open(
  identity: DeviceIdentity,
  peer: { exchangePublicKey: string },
  message: string,
): unknown {
  const envelope = JSON.parse(message) as Record<string, unknown>;
  if (
    typeof envelope.nonce !== "string" ||
    typeof envelope.ciphertext !== "string" ||
    typeof envelope.tag !== "string"
  )
    throw new Error("Invalid encrypted message");
  const nonce = Buffer.from(envelope.nonce, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  if (nonce.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted message");
  const decipher = createDecipheriv("aes-256-gcm", sessionKey(identity, peer), nonce);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
