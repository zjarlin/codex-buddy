import type { Readable, Writable } from "node:stream";

import { createRemoteOfficialAppServerConnection } from "./remote-official-connection.js";

/**
 * Relays one Desktop stdio connection to the persistent local Host listener.
 * The listener owns the Host, mapping store, Harness sessions, and official
 * backend; this process may exit and reconnect without cancelling active work.
 */
export async function runLocalHostProxy(input: {
  socketPath: string;
  input?: Readable;
  output?: Writable;
  diagnosticOutput?: Writable;
}): Promise<number> {
  const diagnosticOutput = input.diagnosticOutput ?? process.stderr;
  let connection: Awaited<ReturnType<typeof createRemoteOfficialAppServerConnection>>;
  try {
    connection = await createRemoteOfficialAppServerConnection(input.socketPath);
  } catch (error) {
    diagnosticOutput.write(
      `codexhost local Host proxy: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const desktopInput = input.input ?? process.stdin;
  const desktopOutput = input.output ?? process.stdout;
  desktopInput.pipe(connection.stdin);
  connection.stdout.pipe(desktopOutput, { end: false });
  connection.stderr.pipe(diagnosticOutput, { end: false });

  const close = (): void => connection.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  try {
    const result = await connection.closed;
    if (result.error) {
      diagnosticOutput.write(
        `codexhost local Host proxy: ${result.error instanceof Error ? result.error.message : String(result.error)}\n`,
      );
      return 1;
    }
    return result.signal ? 1 : (result.code ?? 0);
  } finally {
    process.removeListener("SIGINT", close);
    process.removeListener("SIGTERM", close);
    desktopInput.unpipe(connection.stdin);
  }
}
