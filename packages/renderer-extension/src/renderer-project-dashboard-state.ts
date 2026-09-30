export interface ProjectDashboardTurnSummary {
  id: string;
  status: "completed" | "failed" | "interrupted" | "running";
  prompt: string;
  summary: string;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  changedFiles: number;
  additions: number;
  deletions: number;
}

export interface ProjectDashboardThread {
  id: string;
  hostId: string;
  title: string;
  cwd: string | null;
  projectLabel: string;
  updatedAt: number | null;
  active: boolean;
  turns: ProjectDashboardTurnSummary[];
  error: string | null;
}

export interface ProjectDashboardProject {
  key: string;
  label: string;
  cwd: string | null;
  hostId: string;
  threads: ProjectDashboardThread[];
  activeCount: number;
  completedCount: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  latestAt: number | null;
}

export interface ProjectDashboardSnapshot {
  projects: ProjectDashboardProject[];
  threads: ProjectDashboardThread[];
  errors: string[];
  refreshedAt: number;
}

export type ProjectDashboardMethod = "thread/list" | "thread/turns/list";

export interface ProjectDashboardRequest {
  (method: ProjectDashboardMethod, params: unknown): Promise<unknown>;
}

export interface ProjectDashboardReadOptions {
  maxProjects?: number;
  maxThreadsPerProject?: number;
  maxTurnsPerThread?: number;
  now?: () => number;
}

const DEFAULT_MAX_PROJECTS = 16;
const DEFAULT_MAX_THREADS_PER_PROJECT = 8;
const DEFAULT_MAX_TURNS_PER_THREAD = 6;
const THREAD_LIST_LIMIT = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function timestamp(value: unknown): number | null {
  const direct = numeric(value);
  if (direct !== null) return direct < 10_000_000_000 ? direct * 1000 : direct;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function basename(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized.split("/").at(-1) || value || "未命名项目";
}

function turnStatus(value: unknown): ProjectDashboardTurnSummary["status"] {
  if (value === "inProgress" || value === "running") return "running";
  if (value === "failed") return "failed";
  if (value === "interrupted" || value === "cancelled") return "interrupted";
  return "completed";
}

function itemText(item: Record<string, unknown>): string {
  if (item.type === "agentMessage") return text(item.text).trim();
  if (item.type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    return content
      .map((entry) => (isRecord(entry) && entry.type === "text" ? text(entry.text) : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function compact(value: string, limit = 240): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function fileChangeSummary(items: unknown[]): {
  changedFiles: number;
  additions: number;
  deletions: number;
} {
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  const diffLineCounts = (diff: string): { additions: number; deletions: number } => {
    let added = 0;
    let deleted = 0;
    for (const line of diff.split(/\r?\n/u)) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) added += 1;
      else if (line.startsWith("-")) deleted += 1;
    }
    return { additions: added, deletions: deleted };
  };
  const visit = (value: unknown): void => {
    if (!isRecord(value)) return;
    if (value.type === "fileChange" && Array.isArray(value.changes)) {
      for (const change of value.changes) {
        if (!isRecord(change)) continue;
        const path = text(change.path) || text(change.originalPath);
        if (path) files.add(path);
        const explicitAdditions = numeric(change.additions ?? change.added);
        const explicitDeletions = numeric(change.deletions ?? change.deleted);
        const diff = text(change.unifiedDiff) || text(change.diff);
        const counted = diffLineCounts(diff);
        additions += explicitAdditions ?? counted.additions;
        deletions += explicitDeletions ?? counted.deletions;
      }
    }
    for (const nested of Object.values(value)) {
      if (Array.isArray(nested)) nested.forEach(visit);
      else if (isRecord(nested)) visit(nested);
    }
  };
  items.forEach(visit);
  return { changedFiles: files.size, additions, deletions };
}

function summaryFromTurn(value: unknown): ProjectDashboardTurnSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null;
  const items = Array.isArray(value.items) ? value.items.filter(isRecord) : [];
  const user = items.find((item) => item.type === "userMessage");
  const agent = items.findLast((item) => item.type === "agentMessage");
  const files = fileChangeSummary(items);
  const status = turnStatus(value.status);
  return {
    id: value.id,
    status,
    prompt: compact(user ? itemText(user) : "", 180),
    summary: compact(agent ? itemText(agent) : "", 320),
    startedAt: timestamp(value.startedAt),
    completedAt: timestamp(value.completedAt),
    durationMs: numeric(value.durationMs),
    ...files,
  };
}

function threadTitle(value: Record<string, unknown>): string {
  return compact(text(value.name) || text(value.title) || text(value.preview) || "未命名会话", 120);
}

function projectKey(hostId: string, cwd: string | null, fallback: string): string {
  return `${hostId}\u0000${cwd ?? fallback}`;
}

function pageData(value: unknown): Record<string, unknown>[] {
  const page = isRecord(value) ? value : {};
  const data = Array.isArray(page.data) ? page.data : [];
  return data.filter(isRecord);
}

async function safePage(
  request: ProjectDashboardRequest,
  method: ProjectDashboardMethod,
  params: unknown,
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  try {
    return { rows: pageData(await request(method, params)), error: null };
  } catch (error) {
    return {
      rows: [],
      error: `${method}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function readProjectDashboard(
  request: ProjectDashboardRequest,
  options: ProjectDashboardReadOptions = {},
): Promise<ProjectDashboardSnapshot> {
  const maxProjects = Math.max(1, options.maxProjects ?? DEFAULT_MAX_PROJECTS);
  const maxThreadsPerProject = Math.max(
    1,
    options.maxThreadsPerProject ?? DEFAULT_MAX_THREADS_PER_PROJECT,
  );
  const maxTurnsPerThread = Math.max(1, options.maxTurnsPerThread ?? DEFAULT_MAX_TURNS_PER_THREAD);
  const errors: string[] = [];
  const list = await safePage(request, "thread/list", {
    limit: THREAD_LIST_LIMIT,
    archived: false,
    sortKey: "updated_at",
    sortDirection: "desc",
  });
  if (list.error) errors.push(list.error);

  const rows = list.rows.filter((row) => text(row.cwd).trim());
  const projects = new Map<string, ProjectDashboardProject>();
  const selected: { row: Record<string, unknown>; project: ProjectDashboardProject }[] = [];
  for (const row of rows) {
    const id = text(row.id);
    if (!id) continue;
    const cwd = text(row.cwd);
    const hostId = text(row.hostId) || "local";
    const key = projectKey(hostId, cwd, id);
    let project = projects.get(key);
    if (!project) {
      project = {
        key,
        label: basename(cwd),
        cwd,
        hostId,
        threads: [],
        activeCount: 0,
        completedCount: 0,
        changedFiles: 0,
        additions: 0,
        deletions: 0,
        latestAt: null,
      };
      projects.set(key, project);
    }
    if (selected.filter((entry) => entry.project === project).length >= maxThreadsPerProject)
      continue;
    selected.push({ row, project });
  }

  const loaded = await Promise.all(
    selected.map(async ({ row, project }): Promise<ProjectDashboardThread> => {
      const id = text(row.id);
      const cwd = text(row.cwd) || null;
      const hostId = text(row.hostId) || "local";
      const active = isRecord(row.status) && row.status.type === "active";
      let historyError: string | null = null;
      let turnRows: Record<string, unknown>[] = [];
      try {
        // Full Items are required for file-change facts; the summary view only
        // preserves the user and final agent message. Keep the page tiny.
        const response = await request("thread/turns/list", {
          threadId: id,
          limit: maxTurnsPerThread,
          sortDirection: "desc",
          itemsView: "full",
        });
        turnRows = pageData(response);
      } catch (error) {
        historyError = error instanceof Error ? error.message : String(error);
      }
      const turns = turnRows
        .map(summaryFromTurn)
        .filter((turn): turn is ProjectDashboardTurnSummary => turn !== null)
        .sort((left, right) => {
          const leftAt = left.completedAt ?? left.startedAt ?? 0;
          const rightAt = right.completedAt ?? right.startedAt ?? 0;
          return rightAt - leftAt;
        });
      const updatedAt = timestamp(row.updatedAt);
      const thread: ProjectDashboardThread = {
        id,
        hostId,
        title: threadTitle(row),
        cwd,
        projectLabel: project.label,
        updatedAt,
        active,
        turns,
        error: historyError,
      };
      project.threads.push(thread);
      if (updatedAt !== null) project.latestAt = Math.max(project.latestAt ?? 0, updatedAt);
      if (active) project.activeCount += 1;
      // Project totals are the latest completed Turn per Thread, not a cumulative
      // sum: unrelated Turns can touch the same paths and failed Turns are not results.
      const latestResult = turns.find((turn) => turn.status === "completed");
      if (latestResult) project.completedCount += 1;
      project.changedFiles += latestResult?.changedFiles ?? 0;
      project.additions += latestResult?.additions ?? 0;
      project.deletions += latestResult?.deletions ?? 0;
      return thread;
    }),
  );

  const allProjects = [...projects.values()]
    .filter((project) => project.threads.length > 0)
    .sort(
      (left, right) =>
        right.activeCount - left.activeCount ||
        (right.latestAt ?? 0) - (left.latestAt ?? 0) ||
        left.label.localeCompare(right.label),
    )
    .slice(0, maxProjects);
  const visible = new Set(allProjects.map((project) => project.key));
  const threads = loaded.filter((thread) =>
    visible.has(projectKey(thread.hostId, thread.cwd, thread.id)),
  );
  errors.push(
    ...threads.flatMap((thread) => (thread.error ? [`${thread.title}: ${thread.error}`] : [])),
  );
  return {
    projects: allProjects,
    threads,
    errors,
    refreshedAt: options.now?.() ?? Date.now(),
  };
}
