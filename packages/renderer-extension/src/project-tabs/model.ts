import type { ProjectTab, ProjectTabsConfig } from "@codexhost/shared-contracts";

export type { ProjectTab, ProjectTabsConfig } from "@codexhost/shared-contracts";

export const PROJECT_TABS_STORAGE_KEY = "codexhost.project-tabs.v1";

export interface SidebarProject {
  projectId: string;
  projectKind: "local" | "remote";
  hostId?: string;
  label: string;
}

function infrequentProjectTab(): ProjectTab {
  return { id: "infrequent", name: "不常用", prefixes: [] };
}

export function defaultProjectTabs(): ProjectTabsConfig {
  return {
    version: 2,
    tabs: [
      { id: "company", name: "公司的项目", prefixes: ["remote_company"] },
      { id: "personal", name: "个人的项目", prefixes: ["remote_zjarlin"] },
      infrequentProjectTab(),
    ],
    assignments: {},
    selected: null,
  };
}

export function projectKey(project: SidebarProject): string {
  return JSON.stringify([project.projectKind, project.hostId ?? "local", project.projectId]);
}

export interface PendingProjectAssignment {
  current(): string | null;
  ensure(tab: string | null, now?: number): void;
  clear(): void;
  consume(
    projects: SidebarProject[],
    now?: number,
  ): { tab: string; project: SidebarProject } | null;
}

export function pendingProjectAssignment(ttlMs = 30 * 60 * 1000): PendingProjectAssignment {
  let tab: string | null = null;
  let startedAt = 0;
  const clear = (): void => {
    tab = null;
    startedAt = 0;
  };
  return {
    current: () => tab,
    ensure(next, now = Date.now()) {
      tab = next;
      startedAt = next ? now : 0;
    },
    clear,
    consume(projects, now = Date.now()) {
      if (!tab) return null;
      if (now - startedAt > ttlMs) {
        clear();
        return null;
      }
      const project = projects[0] ?? null;
      if (!project) return null;
      const result = { tab, project };
      clear();
      return result;
    },
  };
}

export function projectAssignment(
  config: ProjectTabsConfig,
  tab: string,
  project: SidebarProject,
): ProjectTabsConfig | null {
  if (!config.tabs.some((candidate) => candidate.id === tab)) {
    return null;
  }
  return {
    ...config,
    assignments: { ...config.assignments, [projectKey(project)]: tab },
  };
}

export function projectTab(config: ProjectTabsConfig, project: SidebarProject): string | null {
  const assigned = config.assignments[projectKey(project)];
  if (assigned && config.tabs.some((tab) => tab.id === assigned)) {
    return assigned;
  }
  return (
    config.tabs.find((tab) => tab.prefixes.some((prefix) => project.label.startsWith(prefix)))
      ?.id ?? null
  );
}

// 删除标签同时清理悬空的手动分类，避免以后意外恢复旧归属。
export function withProjectTabs(config: ProjectTabsConfig, tabs: ProjectTab[]): ProjectTabsConfig {
  const ids = new Set(tabs.map((tab) => tab.id));
  return {
    version: 2,
    tabs,
    assignments: Object.fromEntries(
      Object.entries(config.assignments).filter(([, id]) => ids.has(id)),
    ),
    selected: config.selected && ids.has(config.selected) ? config.selected : null,
  };
}

export function parseProjectTabs(raw: string | null): ProjectTabsConfig {
  if (raw === null) {
    return defaultProjectTabs();
  }
  const value = JSON.parse(raw) as Omit<ProjectTabsConfig, "version"> & { version: unknown };
  if (
    !value ||
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.tabs) ||
    !value.assignments ||
    typeof value.assignments !== "object" ||
    Array.isArray(value.assignments) ||
    !(value.selected === null || typeof value.selected === "string") ||
    !Object.values(value.assignments).every((id) => typeof id === "string") ||
    !value.tabs.every(
      (tab) =>
        tab &&
        typeof tab.id === "string" &&
        tab.id.length > 0 &&
        typeof tab.name === "string" &&
        tab.name.trim().length > 0 &&
        Array.isArray(tab.prefixes) &&
        tab.prefixes.every((prefix) => typeof prefix === "string" && prefix.length > 0),
    ) ||
    new Set(value.tabs.map((tab) => tab.id)).size !== value.tabs.length
  ) {
    throw new Error("Invalid project tab configuration");
  }
  const tabs = [...value.tabs];
  // 仅迁移旧版非空配置；保留同名自建标签和主动清空的配置，删除后不重复补回。
  if (
    value.version === 1 &&
    tabs.length > 0 &&
    !tabs.some((tab) => tab.id === "infrequent" || tab.name.trim() === "不常用")
  ) {
    tabs.push(infrequentProjectTab());
  }
  return withProjectTabs({ ...value, version: 2 }, tabs);
}
