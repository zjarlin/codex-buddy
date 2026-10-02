import { expect, it, vi } from "vitest";
import type { RemoteProject } from "@codexhost/shared-contracts";
import { restoreRemoteProject } from "../src/renderer-remote-project-restore.js";

const project: RemoteProject = {
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
};

it("imports a new project with its remote Threads", async () => {
  const request = vi.fn(async (method: string) => (method === "project/list" ? { data: [] } : {}));
  await restoreRemoteProject(request, project);
  expect(request).toHaveBeenNthCalledWith(1, "project/list", expect.any(Object));
  expect(request).toHaveBeenNthCalledWith(2, "project/import", {
    idempotencyKey: "codexhost-shared-fedcba9876543210",
    name: "Shared project",
    roots: [{ path: "/remote/project" }],
    threads: ["019ccb31-9520-7120-bc17-556e9a92d860"],
    metadata: { source: "codexhost-shared-project", key: "fedcba9876543210" },
  });
});

it("reuses an existing project by root and assigns imported Threads", async () => {
  const request = vi.fn(async (method: string) =>
    method === "project/list"
      ? { data: [{ id: "existing", roots: [{ path: "/remote/project" }] }] }
      : {},
  );
  await restoreRemoteProject(request, project);
  expect(request).toHaveBeenNthCalledWith(2, "thread/metadata/update", {
    threadId: "019ccb31-9520-7120-bc17-556e9a92d860",
    projectId: "existing",
  });
  expect(request.mock.calls.some(([method]) => method === "project/import")).toBe(false);
});

it("does not forward malformed Thread IDs", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<{ data: never[] }>>(
    async () => ({ data: [] }),
  );
  const thread = project.threads[0];
  if (!thread) throw new Error("fixture project must include a Thread");
  await restoreRemoteProject(request, {
    ...project,
    threads: [{ ...thread, id: "../../credentials" }],
  });
  expect(request.mock.calls.at(-1)?.[1]).toMatchObject({ threads: [] });
});
