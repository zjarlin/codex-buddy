import type { RemoteProject } from "@codexhost/shared-contracts";

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Request = (method: string, params: unknown) => Promise<unknown>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function projectRoots(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((root) => {
    const candidate = record(root);
    return typeof candidate?.path === "string" ? [candidate.path] : [];
  });
}

export async function restoreRemoteProject(
  request: Request,
  project: RemoteProject,
): Promise<void> {
  const threadIds = project.threads
    .map((thread) => thread.id)
    .filter((threadId) => THREAD_ID.test(threadId));
  const listed = record(
    await request("project/list", {
      limit: 1_000,
      sortKey: "position",
      sortDirection: "asc",
    }),
  );
  const existing = (Array.isArray(listed?.data) ? listed.data : [])
    .map(record)
    .find((candidate) => {
      if (!candidate || typeof candidate.id !== "string") return false;
      const roots = new Set(projectRoots(candidate.roots));
      return project.roots.some((root) => roots.has(root));
    });
  if (existing && typeof existing.id === "string") {
    for (const threadId of threadIds) {
      await request("thread/metadata/update", { threadId, projectId: existing.id });
    }
    return;
  }
  await request("project/import", {
    idempotencyKey: `codexhost-shared-${project.key}`,
    name: project.name,
    roots: project.roots.map((root) => ({ path: root })),
    threads: threadIds,
    metadata: { source: "codexhost-shared-project", key: project.key },
  });
}
