import type {
  RemoteProject,
  RemoteProjectAccount,
  RemoteProjectsSnapshot,
} from "@codexhost/shared-contracts";

export interface RemoteProjectCatalogEntry {
  project: RemoteProject;
  accountLabels: string[];
}

function mergedProject(left: RemoteProject, right: RemoteProject): RemoteProject {
  const roots = [...new Set([...left.roots, ...right.roots])];
  const threads = new Map(left.threads.map((thread) => [thread.id, thread]));
  for (const thread of right.threads) {
    const current = threads.get(thread.id);
    if (!current || thread.updatedAt > current.updatedAt) threads.set(thread.id, thread);
  }
  return {
    key: left.key,
    name: left.name,
    roots,
    threads: [...threads.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    ),
  };
}

export function remoteProjectCatalog(
  snapshot: RemoteProjectsSnapshot,
): RemoteProjectCatalogEntry[] {
  const accounts: RemoteProjectAccount[] = snapshot.accounts.length
    ? snapshot.accounts
    : [snapshot.account];
  const catalog = new Map<string, { project: RemoteProject; accountLabels: Set<string> }>();
  for (const account of accounts) {
    for (const project of account.projects) {
      const current = catalog.get(project.key);
      if (current) {
        current.project = mergedProject(current.project, project);
        current.accountLabels.add(account.label);
      } else {
        catalog.set(project.key, {
          project,
          accountLabels: new Set([account.label]),
        });
      }
    }
  }
  return [...catalog.values()]
    .map(({ project, accountLabels }) => ({
      project,
      accountLabels: [...accountLabels].sort((a, b) => a.localeCompare(b, "en")),
    }))
    .sort(
      (a, b) =>
        (b.project.threads[0]?.updatedAt ?? 0) - (a.project.threads[0]?.updatedAt ?? 0) ||
        a.project.name.localeCompare(b.project.name, "zh-CN"),
    );
}
