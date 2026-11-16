import { projectKey, type SidebarProject } from "./model.js";

export const PROJECT_SOURCE_RETENTION_KEY = "codexhost.project-sources.v1";
export const PROJECT_SOURCE_DEFERRED_KEY = "codexhost.project-source-deferred.v1";

export type ProjectSourceRetention = Record<string, string>;

/** 来源 id 复用项目 Tab 的项目键：kind、hostId、projectId 已足以唯一且稳定。 */
export function projectSourceId(project: SidebarProject): string {
  return projectKey(project);
}

/** 损坏或空镜像按“没有已保存选择”处理，绝不让解析失败阻断项目显示。 */
export function parseProjectSourceRetention(raw: string | null): ProjectSourceRetention {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" &&
          entry[0].length > 0 &&
          typeof entry[1] === "string" &&
          entry[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}

/** 来源集合签名：只有可用来源发生变化时才再次询问，避免每次启动重复弹窗。 */
export function projectSourceSignature(ids: readonly string[]): string {
  return [...ids].sort().join("\u0000");
}

export function parseProjectSourceDeferred(raw: string | null): Record<string, string> {
  return parseProjectSourceRetention(raw);
}
