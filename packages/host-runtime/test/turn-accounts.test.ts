import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readTurnAccounts } from "../src/turn-accounts.js";
import { readTurnWindow } from "../src/turn-window.js";

const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";
const homes: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "turn-accounts-"));
  homes.push(home);
  await writeFile(
    join(home, "config.toml"),
    `model_provider = "wrong"\n[model_providers.gateway]\nbase_url = "https://fixture.invalid/custom/v1"\nenv_key = "TEST_KEY"\n`,
  );
  return {
    params: { threadId },
    environment: { CODEX_HOME: home, TEST_KEY: "fixture-secret" },
    privateMode: vi.fn(async () => false),
    readThread: vi.fn(async () => ({
      result: { thread: { id: threadId, modelProvider: "gateway" } },
    })),
  };
}

describe("turn dispatch accounts", () => {
  it("queries the resolved provider with the session and turn window", async () => {
    const input = await fixture();
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.pathname).toBe("/custom/v1/turn/accounts");
      expect(url.searchParams.get("session_id")).toBe(threadId);
      expect(url.searchParams.get("since")).toBe("2026-10-27T02:00:00Z");
      expect(url.searchParams.get("until")).toBe("2026-10-27T02:02:00Z");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-secret");
      expect(init?.redirect).toBe("error");
      return Response.json({
        object: "list",
        data: [{ account_id: 832, account_name: "acct-832", model: "ds", api_key: "leak" }],
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await readTurnAccounts({
      ...input,
      params: { threadId, runId: "turn-1", since: 1_793_066_400, until: 1_793_066_520 },
    });
    expect(result).toEqual({
      supported: true,
      attribution: "window",
      runId: "turn-1",
      accounts: [{ account_id: 832, account_name: "acct-832", model: "ds" }],
    });
  });

  it("derives the window from an owned rollout before querying", async () => {
    const input = await fixture();
    const home = input.environment.CODEX_HOME;
    const directory = join(home, "sessions", "2026", "10", "27");
    await mkdir(directory, { recursive: true });
    const rollout = join(directory, `rollout-2026-10-27T02-00-00-${threadId}.jsonl`);
    await writeFile(
      rollout,
      [
        JSON.stringify({ type: "session_meta", payload: { id: threadId, session_id: threadId } }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-1", started_at: 1_793_066_400 },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "task_complete",
            turn_id: "turn-1",
            started_at: 1_793_066_400,
            completed_at: 1_793_066_520,
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-2", started_at: 1_793_067_000 },
        }),
      ].join("\n") + "\n",
    );
    input.readThread.mockResolvedValue({
      result: { thread: { id: threadId, modelProvider: "gateway", path: rollout } },
    });
    const fetcher = vi.fn(async (url: URL) => {
      expect(url.searchParams.get("since")).toBe("2026-10-27T02:00:00Z");
      expect(url.searchParams.get("until")).toBe("2026-10-27T02:02:00Z");
      return Response.json({ object: "list", data: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    await readTurnAccounts({ ...input, params: { threadId, runId: "turn-1" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      await readTurnWindow({ codexHome: home, threadPath: rollout, threadId, runId: "turn-1" }),
    ).toEqual({ since: 1_793_066_400, until: 1_793_066_520 });
    // 未收尾的回合以「下一次任务开始」为界。
    expect(
      await readTurnWindow({ codexHome: home, threadPath: rollout, threadId, runId: "turn-2" }),
    ).toEqual({ since: 1_793_067_000 });
  });

  it("refuses rollouts outside the Codex home and unknown turns", async () => {
    const input = await fixture();
    const outside = join(tmpdir(), `rollout-outside-${threadId}.jsonl`);
    await writeFile(outside, "{}\n");
    input.readThread.mockResolvedValue({
      result: { thread: { id: threadId, modelProvider: "gateway", path: outside } },
    });
    const fetcher = vi.fn(async () => Response.json({ object: "list", data: [] }));
    vi.stubGlobal("fetch", fetcher);
    // 读不到 rollout 时降级为「会话最近一次请求」，而不是失败。
    const result = await readTurnAccounts({ ...input, params: { threadId, runId: "turn-1" } });
    expect(result.supported).toBe(true);
    expect(result.attribution).toBe("unknown");
    const url = (fetcher.mock.calls[0] as unknown as [URL])[0];
    expect(url.searchParams.get("since")).toBeNull();
    await rm(outside, { force: true });
  });

  it("treats a missing extension as unsupported and never leaks provider text", async () => {
    const input = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not supported fixture-secret", { status: 404 })),
    );
    expect(await readTurnAccounts(input)).toEqual({
      supported: false,
      accounts: [],
      attribution: "unknown",
      unavailableReason: "provider",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ object: "list", data: [{ account_id: 0, model: "ds" }] })),
    );
    await expect(readTurnAccounts(input)).rejects.toThrow("Unable to read turn accounts");
  });

  it("does not contact the provider in privacy mode", async () => {
    const input = await fixture();
    input.privateMode.mockResolvedValue(true);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await readTurnAccounts(input)).toEqual({
      supported: false,
      accounts: [],
      attribution: "unknown",
      unavailableReason: "private",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a native Thread identity mismatch before reading credentials", async () => {
    const input = await fixture();
    input.readThread.mockResolvedValue({
      result: { thread: { id: "other", modelProvider: "gateway" } },
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(readTurnAccounts(input)).rejects.toThrow("ownership");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
