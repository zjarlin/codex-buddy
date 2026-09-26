import { describe, expect, it, vi } from "vitest";
import { selectFixedModel } from "../src/renderer-fixed-model-selection.js";
import type { RendererModelClient } from "../src/renderer-model-client.js";
import { RendererMethodUnavailableError } from "../src/renderer-request-sender.js";

describe("fixed model selection", () => {
  function fixture() {
    const settings = {
      enabled: true,
      planning: true,
      privateMode: true,
      bypass: true,
      role: "auto",
      plannerModel: "planner",
      executorModel: "worker",
    };
    const client = {
      buddyStatus: vi.fn(async () => ({ settings })),
      buddyConfigure: vi.fn(async (settings) => ({ settings })),
    };
    return { client, select: vi.fn() };
  }

  it("disables automatic intervention before selecting, while retaining planning preferences", async () => {
    const { client, select } = fixture();
    await selectFixedModel(client as unknown as RendererModelClient, () => true, select);
    expect(client.buddyConfigure).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        privateMode: false,
        plannerModel: "planner",
        executorModel: "worker",
      }),
    );
    expect(select).toHaveBeenCalledOnce();
    expect(client.buddyConfigure.mock.invocationCallOrder[0]).toBeLessThan(
      select.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("leaves the model unchanged when configuration fails or the conversation changes", async () => {
    const { client, select } = fixture();
    client.buddyConfigure.mockRejectedValueOnce(new Error("offline"));
    await expect(
      selectFixedModel(client as unknown as RendererModelClient, () => true, select),
    ).rejects.toThrow("offline");
    expect(select).not.toHaveBeenCalled();
    let current = true;
    client.buddyConfigure.mockImplementationOnce(async (settings) => {
      current = false;
      return { settings };
    });
    await expect(
      selectFixedModel(client as unknown as RendererModelClient, () => current, select),
    ).rejects.toThrow("conversation changed");
    expect(select).not.toHaveBeenCalled();
  });

  it("allows the native path only for explicit absence of the Host method", async () => {
    const { client, select } = fixture();
    client.buddyStatus.mockRejectedValueOnce(
      new RendererMethodUnavailableError("codexhost/buddy/status", null),
    );
    await selectFixedModel(client as unknown as RendererModelClient, () => true, select);
    expect(select).toHaveBeenCalledOnce();
    expect(client.buddyConfigure).not.toHaveBeenCalled();
  });
  it("does not switch when a Host has routing but cannot configure it", async () => {
    const { client, select } = fixture();
    client.buddyConfigure.mockRejectedValueOnce(
      new RendererMethodUnavailableError("codexhost/buddy/settings", null),
    );
    await expect(
      selectFixedModel(client as unknown as RendererModelClient, () => true, select),
    ).rejects.toThrow("unsupported");
    expect(select).not.toHaveBeenCalled();
  });
});
