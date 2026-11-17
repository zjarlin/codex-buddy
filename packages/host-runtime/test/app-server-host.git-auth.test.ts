import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { JsonObject } from "@codexhost/protocol-core";
import {
  GIT_AUTH_SIGN_IN_METHOD,
  GIT_AUTH_SIGN_OUT_METHOD,
  GIT_AUTH_SSH_KEY_METHOD,
  GIT_AUTH_STATUS_METHOD,
  GIT_AUTH_VERIFY_METHOD,
} from "@codexhost/shared-contracts";
import { createFixture, requestId, stopFixture, writeRequest } from "./app-server-host-fixture.js";

const TOKEN = "ghp_synthetic_token_value";
const cleanup: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "codexhost-git-auth-rpc-"));
  cleanup.push(directory);
  return directory;
}

it("serves Git account RPCs without leaking tokens", async () => {
  const fetchStub = vi.fn(
    async () =>
      new Response(JSON.stringify({ login: "zjarlin" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchStub);
  const fixture = createFixture();
  const project = await temporaryDirectory();
  let id = 900;
  const rpc = async (method: string, params?: JsonObject) => {
    const request = ++id;
    writeRequest(fixture.desktopInput, {
      id: request,
      method,
      ...(params === undefined ? {} : { params }),
    });
    return fixture.collector.waitFor((message) => requestId(message, request));
  };
  const accounts = path.join(fixture.mappingStoreDirectory, "codex-home", "git-accounts");
  try {
    await fixture.ready;
    // 没有保存账号时 Status 仍要返回契约形状，界面才能显示空态。
    expect(await rpc(GIT_AUTH_STATUS_METHOD)).toMatchObject({ result: { hosts: [] } });
    expect(await rpc(GIT_AUTH_STATUS_METHOD, {})).toMatchObject({ result: { hosts: [] } });

    const signIn = await rpc(GIT_AUTH_SIGN_IN_METHOD, {
      method: "https-token",
      host: "github.com",
      token: TOKEN,
      cwd: project,
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(signIn).toMatchObject({
      result: {
        verified: true,
        status: {
          hosts: [
            {
              host: "github.com",
              provider: "github",
              state: "signed-in",
              source: "stored",
              account: { host: "github.com", method: "https-token", username: "zjarlin" },
            },
          ],
        },
      },
    });
    // 令牌只存在 Host 本地；任何 RPC 结果都不能回传原文。
    expect(JSON.stringify(signIn)).not.toContain(TOKEN);

    const status = await rpc(GIT_AUTH_STATUS_METHOD, { cwd: project });
    expect(status).toMatchObject({
      result: { hosts: [{ host: "github.com", state: "signed-in", repositories: [] }] },
    });
    expect(JSON.stringify(status)).not.toContain(TOKEN);

    const verify = await rpc(GIT_AUTH_VERIFY_METHOD, { host: "github.com", cwd: project });
    expect(verify).toMatchObject({ result: { verified: true } });
    expect(JSON.stringify(verify)).not.toContain(TOKEN);

    // 临时 CODEX_HOME 里没有密钥：create=false 只报告不存在，不生成。
    expect(await rpc(GIT_AUTH_SSH_KEY_METHOD, { host: "github.com", create: false })).toMatchObject(
      {
        result: { host: "github.com", exists: false, publicKey: null, fingerprint: null },
      },
    );
    expect(await readdir(accounts)).toHaveLength(1);

    const signOut = await rpc(GIT_AUTH_SIGN_OUT_METHOD, { host: "github.com", cwd: project });
    expect(signOut).toMatchObject({ result: { hosts: [] } });
    expect(await readdir(accounts)).toHaveLength(0);

    for (const [method, params] of [
      [GIT_AUTH_STATUS_METHOD, { cwd: "relative" }],
      [GIT_AUTH_SIGN_IN_METHOD, { method: "https-token", host: "github.com", token: "   " }],
      [GIT_AUTH_SIGN_IN_METHOD, { method: "https-token", host: "https://", token: TOKEN }],
      [GIT_AUTH_SIGN_IN_METHOD, { method: "https-token", host: "bad host", token: TOKEN }],
      [GIT_AUTH_SIGN_IN_METHOD, { method: "https-token", token: TOKEN }],
      [GIT_AUTH_SIGN_OUT_METHOD, {}],
      [GIT_AUTH_SSH_KEY_METHOD, { host: "github.com", create: "yes" }],
      [GIT_AUTH_VERIFY_METHOD, { host: "github.com", cwd: "relative" }],
    ] as const) {
      const response = await rpc(method, params as JsonObject);
      expect(response).toMatchObject({ error: { code: -32094 } });
      expect(JSON.stringify(response)).not.toContain(TOKEN);
    }
    // 非法参数不会留下账号，也不会把 Host 的本地路径写出去。
    expect(await readdir(accounts)).toHaveLength(0);
    expect(fixture.official.stdin.read()).toBeNull();
  } finally {
    await stopFixture(fixture);
  }
});
