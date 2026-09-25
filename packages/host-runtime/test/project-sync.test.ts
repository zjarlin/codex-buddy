import { execFile } from "node:child_process";
import { sign } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectSyncPeer } from "../src/project-sync-peer.js";
import { createDeviceIdentity } from "../src/project-sync-crypto.js";
import { createProjectSyncRelay } from "../src/project-sync-relay.js";
import { ProjectSync } from "../src/project-sync.js";

const git = promisify(execFile);
const directories: string[] = [];
const peers: ProjectSyncPeer[] = [];
const relays: ReturnType<typeof createProjectSyncRelay>[] = [];

afterEach(async () => {
  await Promise.all(peers.splice(0).map((peer) => peer.close()));
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
  await Promise.all(
    directories.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{ root: string; project: string; remote: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "codexhost-project-sync-"));
  directories.push(root);
  const remote = path.join(root, "project.git");
  await git("git", ["init", "--bare", "-q", remote]);
  const project = path.join(root, "project");
  await git("git", ["clone", "-q", remote, project]);
  await writeFile(path.join(project, "README.md"), "test\n");
  await git("git", ["-C", project, "add", "README.md"]);
  await git("git", [
    "-C",
    project,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "initial",
  ]);
  await git("git", ["-C", project, "push", "-q", "origin", "HEAD"]);
  return { root, project, remote };
}

async function pairFixture() {
  const { root, project, remote } = await fixture();
  const relay = createProjectSyncRelay();
  relays.push(relay);
  await new Promise<void>((resolve) => relay.server.listen(0, "127.0.0.1", resolve));
  const port = (relay.server.address() as { port: number }).port;
  const firstEnv = {
    CODEXHOST_DATA_DIR: path.join(root, "machine-a"),
    CODEXHOST_PROJECT_SYNC_RELAY_URL: `ws://127.0.0.1:${port}`,
  };
  const secondEnv = {
    CODEXHOST_DATA_DIR: path.join(root, "machine-b"),
    CODEXHOST_PROJECT_SYNC_RELAY_URL: `ws://127.0.0.1:${port}`,
  };
  const first = new ProjectSyncPeer(firstEnv, new ProjectSync(firstEnv, true));
  const second = new ProjectSyncPeer(secondEnv, new ProjectSync(secondEnv, true));
  peers.push(first, second);
  return { root, project, remote, first, second, port };
}

async function pending(peer: ProjectSyncPeer): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const request = (await peer.inspect()).pending[0];
    if (request) return request.requestId;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected pairing request");
}

describe("ProjectSync", () => {
  it("pairs only after approval and exchanges encrypted project metadata", async () => {
    const { first, second, project } = await pairFixture();
    await first.add(project);
    const invite = await first.invite();
    const pairing = second.pair(invite.code);
    const requestId = await pending(first);
    expect((await first.inspect()).peers).toHaveLength(0);
    await first.accept(requestId);
    await pairing;
    const firstId = (await second.inspect()).peers[0]?.id;
    if (!firstId) throw new Error("Expected paired device");
    const result = await second.sync(firstId);
    expect(result.projects).toMatchObject([{ name: "project", localPath: null, state: "missing" }]);
    expect((await first.inspect()).projects[0]?.localPath).toBe(await realpath(project));
    await second.removePeer(firstId);
    await expect(second.sync(firstId)).rejects.toThrow("not paired");
    const secondId = (await first.inspect()).peers[0]?.id;
    if (!secondId) throw new Error("Expected reciprocal trust");
    await expect(first.sync(secondId)).rejects.toThrow("no longer trusts");
  });

  it("keeps a Git catalog as a second sync path", async () => {
    const { root, project, first, second } = await pairFixture();
    const catalog = path.join(root, "catalog.git");
    await git("git", ["init", "--bare", "-q", catalog]);
    const seed = path.join(root, "seed");
    await git("git", ["clone", "-q", catalog, seed]);
    await writeFile(path.join(seed, "README.md"), "catalog\n");
    await git("git", ["-C", seed, "add", "README.md"]);
    await git("git", [
      "-C",
      seed,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "initial",
    ]);
    await git("git", ["-C", seed, "push", "-q", "origin", "HEAD"]);
    await first.add(project);
    await first.configureGit(catalog);
    await first.pushGit();
    await second.configureGit(catalog);
    const result = await second.pullGit();
    expect(result.projects).toMatchObject([{ name: "project", localPath: null, state: "missing" }]);
    const checkout = path.join(root, "inspect");
    await git("git", ["clone", "-q", catalog, checkout]);
    const manifest = await readFile(path.join(checkout, "codexbuddy-projects.json"), "utf8");
    expect(manifest).not.toContain("localPath");
    expect(manifest).not.toContain("machine-a");
  });

  it("does not trust a rejected pairing request", async () => {
    const { first, second } = await pairFixture();
    const invite = await first.invite();
    const pairing = second.pair(invite.code);
    const requestId = await pending(first);
    await first.reject(requestId);
    await expect(pairing).rejects.toThrow("declined");
    expect((await first.inspect()).peers).toHaveLength(0);
    expect((await second.inspect()).peers).toHaveLength(0);
  });

  it("resumes trusted sync after both clients reconnect", async () => {
    const { root, project, first, second, port } = await pairFixture();
    await first.add(project);
    const invite = await first.invite();
    const pairing = second.pair(invite.code);
    await first.accept(await pending(first));
    await pairing;
    await first.close();
    await second.close();
    const firstEnv = {
      CODEXHOST_DATA_DIR: path.join(root, "machine-a"),
      CODEXHOST_PROJECT_SYNC_RELAY_URL: `ws://127.0.0.1:${port}`,
    };
    const secondEnv = {
      CODEXHOST_DATA_DIR: path.join(root, "machine-b"),
      CODEXHOST_PROJECT_SYNC_RELAY_URL: `ws://127.0.0.1:${port}`,
    };
    const restoredFirst = new ProjectSyncPeer(firstEnv, new ProjectSync(firstEnv, true));
    const restoredSecond = new ProjectSyncPeer(secondEnv, new ProjectSync(secondEnv, true));
    peers.push(restoredFirst, restoredSecond);
    await restoredFirst.invite();
    const id = (await restoredSecond.inspect()).peers[0]?.id;
    if (!id) throw new Error("Expected persisted trust");
    expect((await restoredSecond.sync(id)).projects).toHaveLength(1);
  });

  it("rejects reuse of a device ID with another key", async () => {
    const { root, first, port } = await pairFixture();
    await first.invite();
    const identity = JSON.parse(
      await readFile(path.join(root, "machine-a", "project-sync", "device.json"), "utf8"),
    ) as { id: string };
    const attacker = createDeviceIdentity("Attacker");
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const rejected = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
    await new Promise<void>((resolve) => socket.once("open", () => resolve()));
    socket.send(
      JSON.stringify({
        type: "register",
        id: identity.id,
        name: attacker.name,
        key: attacker.publicKey,
        exchangeKey: attacker.exchangePublicKey,
        proof: sign(null, Buffer.from(`register:${identity.id}`), attacker.privateKey).toString(
          "base64",
        ),
      }),
    );
    expect(await rejected).toBe(1008);
  });

  it("rejects credentials in remote URLs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codexhost-project-sync-"));
    directories.push(root);
    const store = new ProjectSync({ CODEXHOST_DATA_DIR: root });
    await expect(store.configureGit("https://user:token@example.com/repo.git")).rejects.toThrow();
    await expect(
      store.merge([{ name: "private", remote: "https://user:token@example.com/repo.git" }]),
    ).rejects.toThrow();
  });
});
