import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { desktopSshConnection } from "../src/desktop-ssh-connection.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function state(connection: unknown) {
  const directory = await mkdtemp(path.join(tmpdir(), "ssh-connection-"));
  cleanup.push(directory);
  await writeFile(
    path.join(directory, ".codex-global-state.json"),
    JSON.stringify({
      "codex-managed-remote-connections": [connection],
    }),
  );
  return { CODEX_HOME: directory };
}

it("uses the saved SSH alias without guessing from a host ID", async () => {
  const environment = await state({
    hostId: "remote-ssh-discovered:252",
    source: "discovered",
    alias: "okm252",
  });
  await expect(desktopSshConnection("remote-ssh-discovered:252", environment)).resolves.toEqual({
    arguments: ["okm252"],
    authority: "okm252",
  });
  await expect(
    desktopSshConnection("remote-ssh-discovered:unconfigured", environment),
  ).rejects.toThrow("SSH 连接");
});

it("preserves the configured SSH port and identity", async () => {
  const environment = await state({
    hostId: "managed-host",
    source: "codex-managed",
    hostname: "server.test",
    sshPort: 2222,
    identity: "/keys/team key",
  });
  const connection = await desktopSshConnection("managed-host", environment);
  expect(connection.arguments).toEqual(["-i", "/keys/team key", "-p", "2222", "server.test"]);
});

it.each(["-oProxyCommand=bad", "alias with spaces", "alias\ncommand"])(
  "rejects an unsafe alias: %j",
  async (alias) => {
    const environment = await state({ hostId: "host", source: "discovered", alias });
    await expect(desktopSshConnection("host", environment)).rejects.toThrow();
  },
);
