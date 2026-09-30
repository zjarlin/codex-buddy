import { expect, it, vi } from "vitest";
import {
  REMOTE_PROJECTS_INSPECT_METHOD,
  REMOTE_PROJECTS_SYNC_METHOD,
} from "@codexhost/shared-contracts";
import { createRendererSshRemoteProjectsSender } from "../src/renderer-ssh-remote-projects.js";

const snapshot = {
  account: {
    id: "0123456789abcdef",
    label: "API Key 01234567",
    current: true,
    projects: [
      {
        key: "fedcba9876543210",
        name: "Shared project",
        roots: ["/remote/project"],
        threads: [
          {
            id: "019ccb31-9520-7120-bc17-556e9a92d860",
            name: "Shared conversation",
            updatedAt: 42,
          },
        ],
      },
    ],
  },
  accounts: [],
};

it("always reads through the saved local Host without changing ownership", async () => {
  const send = vi.fn();
  const sendLocal = vi.fn(async () => snapshot);
  const request = createRendererSshRemoteProjectsSender({
    hostId: "remote:fixture",
    send,
    sendLocal,
    isCurrent: () => true,
  });
  await expect(request(REMOTE_PROJECTS_INSPECT_METHOD, {})).resolves.toEqual(snapshot);
  expect(send).not.toHaveBeenCalled();
  expect(sendLocal.mock.calls[0]?.slice(0, 2)).toEqual([
    REMOTE_PROJECTS_INSPECT_METHOD,
    { hostId: "remote:fixture" },
  ]);
});

it("injects the saved host into sync and never reads after the connection changes", async () => {
  let current = true;
  const send = vi.fn();
  const sendLocal = vi.fn(async () => {
    current = false;
    return snapshot;
  });
  const request = createRendererSshRemoteProjectsSender({
    hostId: "remote:fixture",
    send,
    sendLocal,
    isCurrent: () => current,
  });
  await expect(request(REMOTE_PROJECTS_SYNC_METHOD, {})).rejects.toThrow("SSH 连接已变化");
  expect(sendLocal).toHaveBeenCalledTimes(1);
});

it("overrides the target host while syncing the current remote identity", async () => {
  const send = vi.fn();
  const sendLocal = vi.fn(async () => snapshot);
  const request = createRendererSshRemoteProjectsSender({
    hostId: "remote:fixture",
    send,
    sendLocal,
    isCurrent: () => true,
  });
  await expect(request(REMOTE_PROJECTS_SYNC_METHOD, { hostId: "untrusted" })).resolves.toEqual(
    snapshot,
  );
  expect(sendLocal.mock.calls[0]?.slice(0, 2)).toEqual([
    REMOTE_PROJECTS_SYNC_METHOD,
    { hostId: "remote:fixture" },
  ]);
});
