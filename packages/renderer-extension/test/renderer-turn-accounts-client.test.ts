import { describe, expect, it, vi } from "vitest";
import { createRendererModelClient } from "../src/renderer-model-client.js";

const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";

describe("Turn dispatch accounts", () => {
  it("sends the conversation and turn window to the Host method", async () => {
    const sendRequest = vi.fn(async () => ({
      supported: true,
      attribution: "window",
      accounts: [{ account_id: 832, account_name: "acct-832", model: "ds" }],
    }));
    const client = createRendererModelClient([{ sendRequest }]);
    expect(client).not.toBeNull();
    const result = await client?.readTurnAccounts?.({
      threadId,
      runId: "turn-1",
      since: 1_790_000_000,
      until: 1_790_000_300,
    });
    expect(sendRequest).toHaveBeenCalledWith("codexhost/turn/accounts", {
      threadId,
      runId: "turn-1",
      since: 1_790_000_000,
      until: 1_790_000_300,
    });
    expect(result?.accounts[0]?.account_id).toBe(832);
  });

  it("reports an unsupported Host instead of throwing", async () => {
    const sendRequest = vi.fn(async () => {
      throw { code: -32601, message: "unknown variant `codexhost/turn/accounts`" };
    });
    const client = createRendererModelClient([{ sendRequest }]);
    expect(await client?.readTurnAccounts?.({ threadId })).toEqual({
      supported: false,
      accounts: [],
      attribution: "unknown",
      unavailableReason: "host",
    });
  });

  it("keeps transient failures retryable and rejects untrusted payloads", async () => {
    const sendRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ supported: true, accounts: [{ account_id: -1, model: "ds" }] });
    const client = createRendererModelClient([{ sendRequest }]);
    await expect(client?.readTurnAccounts?.({ threadId })).rejects.toThrow("offline");
    await expect(client?.readTurnAccounts?.({ threadId })).rejects.toThrow();
  });
});
