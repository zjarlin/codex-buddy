import { PROJECT_ROW_SELECTOR, rowProject } from "./project-tabs/native-binding.js";

/** 远程项目迁移后，Git 使用聊天所属项目的当前目录，不沿用会话创建时的旧目录。 */
export function nativeGitProjectWorkspace(
  document: Document,
  hostId: string,
  threadId: string,
): string | undefined {
  if (hostId === "local" || hostId.startsWith("remote-control:")) return undefined;
  const paths = new Set<string>();
  for (const row of document.querySelectorAll<HTMLElement>(PROJECT_ROW_SELECTOR)) {
    const project = rowProject(row);
    if (project?.projectKind !== "remote" || project.hostId !== hostId) continue;
    const path: unknown = Reflect.get(project, "path");
    const threadKeys: unknown = Reflect.get(project, "threadKeys");
    if (
      typeof path === "string" &&
      path.startsWith("/") &&
      Array.isArray(threadKeys) &&
      threadKeys.includes(`local:${threadId}`)
    ) {
      paths.add(path);
    }
  }
  // 不依赖项目名称、侧栏高亮或另一台 Host 的同名聊天；绑定冲突时保留原会话归属。
  return paths.size === 1 ? paths.values().next().value : undefined;
}
