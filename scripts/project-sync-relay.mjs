import { createProjectSyncRelay } from "../packages/host-runtime/dist/project-sync-relay.js";

const host = process.env.CODEXHOST_RELAY_HOST || "127.0.0.1";
const port = Number(process.env.CODEXHOST_RELAY_PORT || "8642");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid relay port");
const relay = createProjectSyncRelay();
relay.server.listen(port, host, () =>
  console.log(`Project sync relay listening on ${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void relay.close().then(() => process.exit(0)));
}
