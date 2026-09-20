import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { buddyTurnStartOptions } from "../src/buddy-turn-start-policy.js";
import { installDraftPrewarmPolicyBridge } from "../src/renderer-draft-prewarm-runtime.js";

afterEach(() => vi.useRealTimers());

it("keeps a slow planning submission pending until its single native receipt arrives", async () => {
  vi.useFakeTimers();
  const onOutcomeUnknown = vi.fn();
  const receipt = { turn: { id: "accepted-turn", status: "inProgress" } };
  let nativePromise: Promise<unknown> | undefined;
  const originalSend = vi.fn((_method, _params, options) => {
    nativePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        options.onOutcomeUnknown();
        reject(new Error("outcome-unknown"));
      }, options.timeoutMs);
      setTimeout(() => {
        clearTimeout(timeout);
        resolve(receipt);
      }, 146_000);
    });
    return nativePromise;
  });
  const bridge = {
    sendRequest: originalSend,
    prewarmThreadStart: vi.fn(),
    enqueueRequest: vi.fn(),
    onResult: vi.fn(),
    onError: vi.fn(),
  };
  const manager = {
    onNotification: vi.fn(),
    onRequest: vi.fn(),
    dispatchAppServerResponse: vi.fn(),
  };
  installDraftPrewarmPolicyBridge(
    manager,
    bridge,
    "local",
    {},
    {
      discardAllPrewarmedThreads: vi.fn(),
    },
  );
  const parameters = { threadId: "work", input: [{ type: "text", text: "修复问题" }] };
  const options = { timeoutMs: 30_000, onOutcomeUnknown, priority: "critical" };
  const promise = bridge.sendRequest("turn/start", parameters, options);
  expect(promise).toBe(nativePromise);
  expect(originalSend).toHaveBeenCalledExactlyOnceWith("turn/start", parameters, {
    ...options,
    timeoutMs: 240_000,
  });
  await vi.advanceTimersByTimeAsync(31_000);
  expect(onOutcomeUnknown).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(115_000);
  await expect(promise).resolves.toBe(receipt);
  expect(onOutcomeUnknown).not.toHaveBeenCalled();
  expect(originalSend).toHaveBeenCalledTimes(1);
  expect(options.timeoutMs).toBe(30_000);
});

it.each([
  ["remote-ssh-discovered:host", "turn/start", {}],
  ["local", "turn/steer", {}],
  ["local", "turn/start", { outputSchema: { type: "object" } }],
  ["local", "turn/start", { toolOutput: { callId: "tool", output: "ok" } }],
  ["local", "turn/start", { model: "codexhost/claude-code" }],
  ["local", "turn/start", { input: [] }],
])("preserves the timeout for %s %s %j", (hostId, method, overrides) => {
  const parameters = { threadId: "work", input: [{ type: "text", text: "hello" }], ...overrides };
  const options = { timeoutMs: 30_000 };
  expect(buddyTurnStartOptions(hostId, method, parameters, options)).toBe(options);
});

it.each([undefined, {}, { timeoutMs: null }, { timeoutMs: 0 }, { timeoutMs: 300_000 }])(
  "preserves an unlimited or longer native deadline: %j",
  (options) => {
    expect(
      buddyTurnStartOptions(
        "local",
        "turn/start",
        { input: [{ type: "text", text: "hi" }] },
        options,
      ),
    ).toBe(options);
  },
);

it("can be injected without access to module scope", () => {
  const injected = runInNewContext(
    `(${buddyTurnStartOptions.toString()})`,
  ) as typeof buddyTurnStartOptions;
  expect(
    injected(
      "local",
      "turn/start",
      { input: [{ type: "text", text: "hi" }] },
      { timeoutMs: 30_000 },
    ),
  ).toEqual({ timeoutMs: 240_000 });
});
