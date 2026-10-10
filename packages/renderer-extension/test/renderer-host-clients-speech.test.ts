import { describe, expect, it, vi } from "vitest";
import type { RendererHostRoute } from "@codexhost/desktop-control/renderer-bindings";
import { BUDDY_SPEECH_METHOD } from "@codexhost/shared-contracts";
import { createRendererHostClients } from "../src/renderer-host-clients.js";

vi.mock("../src/renderer-external-queue.js", () => ({ installRendererExternalQueue: vi.fn() }));
vi.mock("../src/renderer-external-steering.js", () => ({
  installRendererExternalSteering: vi.fn(),
}));
vi.mock("../src/renderer-thread-archive.js", () => ({ installRendererThreadArchive: vi.fn() }));

const request = { text: "会话已完成。", locale: "zh-CN" };
const result = { audioBase64: "UklGRg==", format: "wav", characters: 6, latencyMs: 8 };

function fixture(
  sendRemote: ReturnType<typeof vi.fn>,
  sendLocal = vi.fn().mockResolvedValue(result),
) {
  let current = true;
  let localAvailable = true;
  const remote = {
    hostId: "remote-ssh-discovered:server",
    manager: { sendRequest: sendRemote },
  } as unknown as RendererHostRoute;
  const local = {
    hostId: "local",
    manager: { sendRequest: sendLocal },
  } as unknown as RendererHostRoute;
  const clients = createRendererHostClients(() => ({
    forHost: (hostId: string) =>
      hostId === "local" ? (localAvailable ? local : null) : current ? remote : null,
    hostIdForComposer: () => remote.hostId,
    forComposer: () => remote,
    dispose: vi.fn(),
  }));
  const client = clients.forHost(remote.hostId);
  if (!client?.synthesizeSpeech) throw new Error("Fixture speech client unavailable");
  return {
    synthesize: client.synthesizeSpeech.bind(client),
    sendLocal,
    clients,
    retire: () => {
      current = false;
    },
    disconnectLocal: () => {
      localAvailable = false;
    },
  };
}

describe("SSH conversation speech", () => {
  it.each([-32600, -32601])(
    "synthesizes through the local Host when the official SSH method is absent (%s)",
    async (code) => {
      const sendRemote = vi.fn().mockRejectedValue({
        code,
        message: `Invalid request: unknown variant \`${BUDDY_SPEECH_METHOD}\``,
      });
      const f = fixture(sendRemote);
      try {
        await expect(f.synthesize(request)).resolves.toEqual(result);
        await expect(f.synthesize({ ...request, text: "第二次重播。" })).resolves.toEqual(result);
        expect(sendRemote).toHaveBeenCalledExactlyOnceWith(BUDDY_SPEECH_METHOD, request);
        expect(f.sendLocal).toHaveBeenCalledWith(BUDDY_SPEECH_METHOD, request);
        expect(f.sendLocal).toHaveBeenCalledTimes(2);
      } finally {
        f.clients.dispose();
      }
    },
  );

  it("preserves a remote Buddy Host's native speech capability", async () => {
    const f = fixture(vi.fn().mockResolvedValue(result));
    try {
      await expect(f.synthesize(request)).resolves.toEqual(result);
      expect(f.sendLocal).not.toHaveBeenCalled();
    } finally {
      f.clients.dispose();
    }
  });

  it.each([
    { code: -32093, message: "隐私模式已阻止语音播报。" },
    { code: -32093, message: "HTTP 401" },
    { code: -32600, message: "bad params" },
    new Error("connection lost"),
  ])(
    "exposes privacy, synthesis, parameter and connection errors without fallback",
    async (failure) => {
      const f = fixture(vi.fn().mockRejectedValue(failure));
      try {
        await expect(f.synthesize(request)).rejects.toBe(failure);
        expect(f.sendLocal).not.toHaveBeenCalled();
      } finally {
        f.clients.dispose();
      }
    },
  );

  it("reports local synthesis failure and permits a fresh manual retry", async () => {
    const sendLocal = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValue(result);
    const sendRemote = vi.fn().mockRejectedValue({ code: -32601 });
    const f = fixture(sendRemote, sendLocal);
    try {
      await expect(f.synthesize(request)).rejects.toThrow("HTTP 500");
      await expect(f.synthesize(request)).resolves.toEqual(result);
      expect(sendRemote).toHaveBeenCalledOnce();
      expect(sendLocal).toHaveBeenCalledTimes(2);
    } finally {
      f.clients.dispose();
    }
  });

  it("does not send a fallback request after the SSH connection is retired", async () => {
    const sendRemote = vi.fn(async () => {
      f.retire();
      throw { code: -32601 };
    });
    const f = fixture(sendRemote);
    try {
      await expect(f.synthesize(request)).rejects.toThrow("SSH 连接已变化");
      expect(f.sendLocal).not.toHaveBeenCalled();
    } finally {
      f.clients.dispose();
    }
  });

  it("discards local audio returned after its SSH connection was retired", async () => {
    const sendLocal = vi.fn(async () => {
      f.retire();
      return result;
    });
    const f = fixture(vi.fn().mockRejectedValue({ code: -32601 }), sendLocal);
    try {
      await expect(f.synthesize(request)).rejects.toThrow("SSH 连接已变化");
    } finally {
      f.clients.dispose();
    }
  });

  it("reports a disconnected local Host without sending the summary elsewhere", async () => {
    const f = fixture(vi.fn().mockRejectedValue({ code: -32601 }));
    f.disconnectLocal();
    try {
      await expect(f.synthesize(request)).rejects.toThrow("本机 SSH 执行服务不可用");
      expect(f.sendLocal).not.toHaveBeenCalled();
    } finally {
      f.clients.dispose();
    }
  });
});
