/**
 * 项目来源去重。
 *
 * 同一 Git 远程仓库在不同 Host 或本地克隆中共享身份；没有 origin 时退回项目名。
 * 这里只做纯决策，不读取 DOM 或 Host，便于按连接状态复用同一套保留规则。
 */

import { normalizeProjectOrigin } from "@codexhost/shared-contracts";

export { normalizeProjectOrigin };

export interface ProjectSource {
  /** 来源身份，必须在该组内稳定且唯一。 */
  id: string;
  /** 展示名称；没有 Git 来源时作为项目身份。 */
  name: string;
  /** 规范化前的 Git origin；空值表示没有 Git 来源。 */
  origin: string | null;
  /**
   * origin 是否已经确认。缺省视为已确认；false 表示读取失败或来源无效，
   * 此时不能按名称合并，否则会把同名但无关的项目误当成同一仓库。
   */
  originResolved?: boolean;
  /** 当前是否可用。离线下岗的来源不能阻止自动保留。 */
  available: boolean;
  /** 本地项目还是 SSH 工作区。远程来源优先于本地克隆。 */
  scope: "local" | "remote";
}

export interface ProjectSourceGroup<T extends ProjectSource = ProjectSource> {
  /** Git 仓库身份，或没有 origin 时的项目名。 */
  key: string;
  kind: "git" | "name";
  /** 组内全部来源，按传入顺序稳定保留。 */
  sources: T[];
  /** 当前可用来源。 */
  available: T[];
  /** 已保存且仍有效的保留来源。 */
  retained: T | null;
  /** 不询问即可确定的保留来源；需要询问时为 null。 */
  selected: T | null;
  /** 多个可用来源且没有有效保留选择时需要询问。 */
  needsChoice: boolean;
}

export interface ProjectSourceGrouping<T extends ProjectSource = ProjectSource> {
  groups: ProjectSourceGroup<T>[];
  /** 需要用户选择保留来源的分组。 */
  pending: ProjectSourceGroup<T>[];
}

/** 没有 Git origin 时才按项目名归类；大小写和首尾空白不产生不同项目。 */
export function projectSourceKey(
  source: Pick<ProjectSource, "name" | "origin"> &
    Partial<Pick<ProjectSource, "id" | "originResolved">>,
): {
  key: string;
  kind: "git" | "name";
} {
  const origin = normalizeProjectOrigin(source.origin);
  if (origin) return { key: `git:${origin}`, kind: "git" };
  if (source.originResolved === false) {
    return { key: `unresolved:${source.id ?? source.name}`, kind: "name" };
  }
  const name = source.name.trim().toLowerCase();
  return { key: `name:${name || "unnamed"}`, kind: "name" };
}

/**
 * 将项目来源分组并决定默认保留项。
 *
 * - 分组键优先用 Git 仓库身份；确认没有 Git 的副本按项目名归类，并在名字只
 *   命中一个仓库时并入该仓库。
 * - 只有一个可用来源：自动保留，不需要询问。
 * - 有多个可用来源：沿用仍可用的已保存选择；否则需要询问。
 * - 已保存选择失效时自动让位给唯一可用来源，不保留“下岗”来源。
 * - 多个远程同时在线才需要选择；只剩一个远程时本地克隆直接让位。
 */
export function groupProjectSources<T extends ProjectSource>(
  sources: readonly T[],
  retainedIds: Readonly<Record<string, string | null | undefined>> = {},
): ProjectSourceGrouping<T> {
  const byKey = new Map<string, { kind: "git" | "name"; sources: T[] }>();
  for (const source of sources) {
    const { key, kind } = projectSourceKey(source);
    const entry = byKey.get(key);
    if (entry) entry.sources.push(source);
    else byKey.set(key, { kind, sources: [source] });
  }
  // 确认没有 Git 的副本按项目名并回同名且唯一的 Git 仓库：这是“没有 Git 就用
  // 项目名”的落地方式，仓库在另一台机器上被复制成无 `.git` 目录时仍然只显示
  // 一个来源。名字同时命中多个仓库时无法判断归属，保持独立显示，宁可多一条
  // 项目行，也不隐藏能正常打开的项目。
  const namesByGit = new Map<string, Set<string>>();
  for (const [key, entry] of byKey) {
    if (entry.kind !== "git") continue;
    for (const source of entry.sources) {
      const name = source.name.trim().toLowerCase();
      if (!name) continue;
      const names = namesByGit.get(name) ?? new Set<string>();
      names.add(key);
      namesByGit.set(name, names);
    }
  }
  const merged = new Map<string, { kind: "git" | "name"; sources: T[] }>();
  for (const [key, entry] of byKey) {
    let target = key;
    // 在线却读不出 origin（`originResolved === false`）或配置了无法识别的地址
    // 都是“不确定”，不是“没有 Git”；它们继续独立显示，不能被同名仓库隐藏。
    const withoutGit = entry.sources.every(
      (source) => source.origin === null && source.originResolved !== false,
    );
    if (entry.kind === "name" && withoutGit) {
      const matches = namesByGit.get(entry.sources[0]?.name.trim().toLowerCase() ?? "");
      if (matches?.size === 1) target = matches.values().next().value as string;
    }
    const current = merged.get(target);
    if (current) current.sources.push(...entry.sources);
    else
      merged.set(target, {
        kind: target === key ? entry.kind : "git",
        sources: [...entry.sources],
      });
  }

  const groups: ProjectSourceGroup<T>[] = [];
  const pending: ProjectSourceGroup<T>[] = [];
  for (const [key, entry] of merged) {
    const available = entry.sources.filter((source) => source.available);
    const retainedId = retainedIds[key];
    const retained = retainedId
      ? (available.find((source) => source.id === retainedId) ?? null)
      : null;
    // 只剩一个来源可用时结论明确；只有一个远程工作区在线时，本地克隆
    // 只是副本，直接保留远程。多个远程同时在线才需要用户决定，避免每次
    // 连接变化都重复询问。
    const remote = available.filter((source) => source.scope === "remote");
    const automatic =
      available.length === 1
        ? (available[0] ?? null)
        : remote.length === 1
          ? (remote[0] ?? null)
          : null;
    const selected = retained ?? automatic;
    const group: ProjectSourceGroup<T> = {
      key,
      kind: entry.kind,
      sources: entry.sources,
      available,
      retained,
      selected,
      needsChoice: available.length > 1 && selected === null,
    };
    groups.push(group);
    if (group.needsChoice) pending.push(group);
  }
  return { groups, pending };
}

/** 组内应隐藏的来源：保留项以外的其他来源。没有保留项时不隐藏任何来源。 */
export function hiddenProjectSourceIds<T extends ProjectSource>(
  group: ProjectSourceGroup<T>,
): Set<string> {
  if (!group.selected) return new Set();
  return new Set(
    group.sources.filter((source) => source.id !== group.selected?.id).map((source) => source.id),
  );
}
