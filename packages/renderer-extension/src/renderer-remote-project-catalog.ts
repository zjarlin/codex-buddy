import {
  normalizeProjectOrigin,
  type RemoteProject,
  type RemoteProjectAccount,
  type RemoteProjectsSnapshot,
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
    // 多个身份可能先看到同一仓库的不同目录；固定取最小 key，避免账号顺序
    // 改变恢复时的 idempotencyKey。
    key: left.key < right.key ? left.key : right.key,
    name: left.name,
    roots,
    origin: normalizeProjectOrigin(left.origin)
      ? left.origin
      : normalizeProjectOrigin(right.origin)
        ? right.origin
        : null,
    threads: [...threads.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    ),
  };
}

/**
 * 同一 Git 仓库跨身份合并；升级前没有 origin 的索引仍按项目 key 合并，
 * 并在根目录与已识别仓库唯一重叠时并入该仓库，避免面板出现重复项目。
 */
export function remoteProjectCatalog(
  snapshot: RemoteProjectsSnapshot,
): RemoteProjectCatalogEntry[] {
  const accounts: RemoteProjectAccount[] = snapshot.accounts.length
    ? snapshot.accounts
    : [snapshot.account];
  const byKey = new Map<string, { project: RemoteProject; accountLabels: Set<string> }>();
  for (const account of accounts) {
    for (const project of account.projects) {
      const current = byKey.get(project.key);
      if (current) {
        current.project = mergedProject(current.project, project);
        current.accountLabels.add(account.label);
      } else {
        byKey.set(project.key, { project, accountLabels: new Set([account.label]) });
      }
    }
  }

  const originRoots = new Map<string, Set<string>>();
  for (const { project } of byKey.values()) {
    const origin = normalizeProjectOrigin(project.origin);
    if (!origin) continue;
    const roots = originRoots.get(origin) ?? new Set<string>();
    for (const root of project.roots) roots.add(root);
    originRoots.set(origin, roots);
  }
  const catalog = new Map<string, { project: RemoteProject; accountLabels: Set<string> }>();
  for (const [key, entry] of byKey) {
    const origin = normalizeProjectOrigin(entry.project.origin);
    let target = origin ? `git:${origin}` : `project:${key}`;
    if (!origin) {
      const matches = [...originRoots.entries()].filter(([, roots]) =>
        entry.project.roots.some((root) => roots.has(root)),
      );
      if (matches.length === 1) target = `git:${matches[0]?.[0]}`;
    }
    const current = catalog.get(target);
    if (current) {
      current.project = mergedProject(current.project, entry.project);
      for (const label of entry.accountLabels) current.accountLabels.add(label);
    } else {
      catalog.set(target, {
        project: entry.project,
        accountLabels: new Set(entry.accountLabels),
      });
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
