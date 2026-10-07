import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  TurnActionRecommendations,
  type ActionRecommendationInput,
} from "../src/turn-action-recommendations.js";
const homes: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "action-recommendation-"));
  homes.push(home);
  await writeFile(
    join(home, "config.toml"),
    '[model_providers.gateway]\nbase_url="https://fixture.invalid/v1"\nenv_key="TEST_KEY"\n',
  );
  const privateMode = vi.fn(async () => false);
  const input: ActionRecommendationInput = {
    threadId: "019ccb31-9520-7120-bc17-556e9a92d860",
    turnId: "turn-1",
    contextId: "a".repeat(64),
    provider: "gateway",
    features: { git_changes: 2, git_conflicts: 0, git_ahead: 0, git_behind: 0 },
    actions: [
      {
        actionId: "git.commit",
        version: "1",
        label: "提交代码",
        description: "commit",
        kind: "prompt",
        argumentMode: "none",
        enabled: true,
      },
    ],
  };
  const value = {
    session_id: input.threadId,
    run_id: input.turnId,
    context_id: input.contextId,
    features: input.features,
    source: "laya",
    model: "laya",
    state: "completed",
    actions: [{ action_id: "git.commit", version: "1", confidence: 0.9, reason: "changes" }],
    updated_at: 1,
  };
  return {
    input,
    value,
    privateMode,
    service: new TurnActionRecommendations({
      environment: { CODEX_HOME: home, TEST_KEY: "secret" },
      privateMode,
    }),
  };
}
it("reads persisted recommendations before generating, coalesces polling and sends only candidate metadata", async () => {
  const f = await fixture();
  const fetch = vi.fn(async (_url: URL, options: RequestInit) =>
    options.method === "GET" ? Response.json({ data: [] }) : Response.json(f.value),
  );
  vi.stubGlobal("fetch", fetch);
  f.service.inspect(f.input, true);
  f.service.inspect(f.input, true);
  await vi.waitFor(() => expect(f.service.inspect(f.input, true).state).toBe("completed"));
  expect(fetch).toHaveBeenCalledTimes(2);
  const request = JSON.parse(String(fetch.mock.calls[1]?.[1].body));
  expect(request).toMatchObject({
    session_id: f.input.threadId,
    run_id: "turn-1",
    candidates: [{ action_id: "git.commit" }],
  });
  expect(JSON.stringify(request)).not.toContain("secret");
  expect(request).not.toHaveProperty("prompt");
});
it.each([
  ["array", () => ({ data: [] })],
  ["object", () => ({ data: null })],
])("falls back to generation for an empty %s response", async (_name, response) => {
  const f = await fixture();
  const fetch = vi.fn(async (_url: URL, options: RequestInit) =>
    options.method === "GET" ? Response.json(response()) : Response.json(f.value),
  );
  vi.stubGlobal("fetch", fetch);
  f.service.inspect(f.input, true);
  await vi.waitFor(() => expect(f.service.inspect(f.input, true).state).toBe("completed"));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]?.[1].method).toBe("POST");
});
it.each([401, 403, 422])(
  "treats HTTP %s as unsupported recommendation capability",
  async (status) => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    f.service.inspect(f.input, true);
    await vi.waitFor(() => expect(f.service.inspect(f.input, true).state).toBe("unsupported"));
  },
);
it.each(["thread", "turn", "action"])("rejects mismatched %s results", async (kind) => {
  const f = await fixture();
  if (kind === "thread") f.value.session_id = "019ccb31-9520-7120-bc17-556e9a92d861";
  if (kind === "turn") f.value.run_id = "other";
  if (kind === "action" && f.value.actions[0]) f.value.actions[0].action_id = "unregistered";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: [f.value] })),
  );
  f.service.inspect(f.input, true);
  await vi.waitFor(() => expect(f.service.inspect(f.input, true).state).toBe("failed"));
});
it("does not query in private mode and does not generate for historical turns or unsupported gateways", async () => {
  const f = await fixture();
  const fetch = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  f.privateMode.mockResolvedValue(true);
  f.service.inspect(f.input, true);
  await vi.waitFor(() => expect(f.service.inspect(f.input, true).state).toBe("unsupported"));
  expect(fetch).not.toHaveBeenCalled();
  f.privateMode.mockResolvedValue(false);
  const other = { ...f.input, contextId: "b".repeat(64) };
  f.service.inspect(other, false);
  await vi.waitFor(() => expect(f.service.inspect(other, false).state).toBe("unsupported"));
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("times out one recommendation within budget and does not retry it on polling", async () => {
  const f = await fixture();
  const fetch = vi.fn(async () => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetch);
  f.service.inspect(f.input, true);
  await vi.waitFor(() => expect(f.service.inspect(f.input, true).state).toBe("timed_out"), {
    timeout: 4000,
  });
  expect(f.service.inspect(f.input, true).state).toBe("timed_out");
  expect(fetch).toHaveBeenCalledOnce();
});
