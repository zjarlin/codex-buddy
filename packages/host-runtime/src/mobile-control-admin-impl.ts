import type { MobilePairingStatus } from "@codexhost/shared-contracts";

import { MobilePairingStore, mobilePairingStatePath } from "./mobile-pairing.js";
import { startMobileControlServer } from "./mobile-control-server.js";
import type { MobileControlAdmin } from "./mobile-control-admin.js";
import type { MobileControlSession, MobileControlSessionStreams } from "./mobile-control-server.js";

export interface MobileControlRuntimeOptions {
  environment: NodeJS.ProcessEnv;
  appDirectory?: string;
  createSession(streams: MobileControlSessionStreams): MobileControlSession;
  diagnosticOutput?: NodeJS.WritableStream;
}

/**
 * Composes persisted credentials with the LAN listener for the local Host. The listener starts
 * only when the user asks for a pairing QR, so an unpaired Host never exposes a LAN port.
 */
export async function startMobileControlAdmin(
  options: MobileControlRuntimeOptions,
): Promise<MobileControlAdmin> {
  const pairing = new MobilePairingStore({ file: mobilePairingStatePath(options.environment) });
  await pairing.initialize();
  let listening: Promise<MobileControlServer> | null = null;
  let started: MobileControlServer | null = null;
  let closed = false;

  const server = (): Promise<MobileControlServer> => {
    if (closed) return Promise.reject(new Error("Phone control was closed"));
    listening ??= startMobileControlServer({
      pairing,
      createSession: options.createSession,
      environment: options.environment,
      ...(options.appDirectory ? { appDirectory: options.appDirectory } : {}),
      ...(options.diagnosticOutput ? { diagnosticOutput: options.diagnosticOutput } : {}),
    })
      .then((value) => {
        started = value;
        return value;
      })
      .catch((error: unknown) => {
        listening = null;
        throw error;
      });
    return listening;
  };

  return {
    status(): Promise<MobilePairingStatus> {
      return pairing.status();
    },
    async invite(): Promise<{ url: string; expiresAt: number }> {
      return (await server()).invite();
    },
    async revoke(clientId: string): Promise<boolean> {
      const removed = await pairing.revoke(clientId);
      if (removed) started?.disconnectClient(clientId);
      return removed;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const active = listening;
      listening = null;
      if (active) await (await active).close();
    },
  };
}
