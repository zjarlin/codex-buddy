import { describe, expect, it, vi } from "vitest";
import type { RendererHostRoute } from "@codexhost/desktop-control/renderer-bindings";
import { BUDDY_TRANSLATE_METHOD } from "@codexhost/shared-contracts";
import { createRendererHostClients } from "../src/renderer-host-clients.js";

vi.mock("../src/renderer-external-queue.js", () => ({ installRendererExternalQueue: vi.fn() }));
vi.mock("../src/renderer-external-steering.js", () => ({
  installRendererExternalSteering: vi.fn(),
}));
vi.mock("../src/renderer-thread-archive.js", () => ({ installRendererThreadArchive: vi.fn() }));

const request = { text: "Let me inspect the server capacity.", targetLocale: "zh-CN" };
const result = { translated: "让我检查服务器容量。", model: "sub2api:baidu", latencyMs: 8 };

function fixture(
  sendRemote: ReturnType<typeof vi.fn>,
  sendLocal = vi.fn().mockResolvedValue(result),
) {
  let current = true;
  const remote = {
    hostId: "remote-ssh-discovered:server",
    manager: { sendRequest: sendRemote },
  } as unknown as RendererHostRoute;
  const local = {
    hostId: "local",
    manager: { sendRequest: sendLocal },
  } as unknown as RendererHostRoute;
  const clients = createRendererHostClients(() => ({
    forHost: (hostId: string) => (hostId === "local" ? local : current ? remote : null),
    hostIdForComposer: () => remote.hostId,
    forComposer: () => remote,
    dispose: vi.fn(),
  }));
  const client = clients.forHost(remote.hostId);
  if (!client?.translate) throw new Error("Fixture translation client unavailable");
  return {
    translate: client.translate.bind(client),
    sendLocal,
    clients,
    retire: () => {
      current = false;
    },
  };
}

describe("SSH conversation translation", () => {
  it.each([-32600, -32601])(
    "uses the local translator only when the remote method is absent (%s)",
    async (code) => {
      const sendRemote = vi.fn().mockRejectedValue({
        code,
        message: `Invalid request: unknown variant \`${BUDDY_TRANSLATE_METHOD}\``,
      });
      const f = fixture(sendRemote);
      await expect(f.translate(request)).resolves.toEqual(result);
      await expect(
        f.translate({ ...request, text: "Next I will verify the serving configuration." }),
      ).resolves.toEqual(result);
      expect(sendRemote).toHaveBeenCalledTimes(1);
      expect(f.sendLocal).toHaveBeenCalledWith(BUDDY_TRANSLATE_METHOD, request);
      f.clients.dispose();
    },
  );

  it("preserves translation from a remote Buddy Host", async () => {
    const f = fixture(vi.fn().mockResolvedValue(result));
    await expect(f.translate(request)).resolves.toEqual(result);
    expect(f.sendLocal).not.toHaveBeenCalled();
    f.clients.dispose();
  });

  it.each([
    { code: -32092, message: "provider unavailable" },
    { code: -32600, message: "bad params" },
    new Error("connection lost"),
  ])("does not fall back on network, parameter or provider errors", async (failure) => {
    const f = fixture(vi.fn().mockRejectedValue(failure));
    await expect(f.translate(request)).rejects.toBe(failure);
    expect(f.sendLocal).not.toHaveBeenCalled();
    f.clients.dispose();
  });

  it("discards a result if its SSH connection was retired", async () => {
    const sendLocal = vi.fn(async () => {
      f.retire();
      return result;
    });
    const f = fixture(vi.fn().mockRejectedValue({ code: -32601 }), sendLocal);
    await expect(f.translate(request)).rejects.toThrow("SSH 连接已变化");
    f.clients.dispose();
  });
});
