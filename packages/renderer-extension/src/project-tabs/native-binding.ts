import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";
import type { SidebarProject } from "./model.js";

export const PROJECT_ROW_SELECTOR =
  '[role="listitem"][data-sidebar-project-container-id][data-sidebar-project-kind]';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function ancestors(element: HTMLElement) {
  const key = Object.keys(element).find((key) => key.startsWith("__reactFiber$"));
  return key ? committedReactAncestors(Reflect.get(element, key)) : [];
}

function asProject(value: unknown): SidebarProject | null {
  const project = record(value);
  if (
    !project ||
    (project.projectKind !== "local" && project.projectKind !== "remote") ||
    typeof project.projectId !== "string" ||
    typeof project.label !== "string" ||
    (project.projectKind === "remote" && typeof project.hostId !== "string")
  ) {
    return null;
  }
  return project as unknown as SidebarProject;
}

export function rowProject(row: HTMLElement): SidebarProject | null {
  for (const fiber of ancestors(row)) {
    const props = record(fiber.memoizedProps);
    const project = asProject(props?.group) ?? asProject(props?.project);
    if (
      project &&
      row.getAttribute("data-sidebar-project-kind") === project.projectKind &&
      row.getAttribute("data-sidebar-project-container-id") === `project:${project.projectId}`
    ) {
      return project;
    }
  }
  return null;
}

// 只从原生“编辑项目”菜单项的已提交祖先读取目标，不依赖当前聊天或菜单显示文字。
export function projectMenu(
  anchor: HTMLElement,
): { project: SidebarProject; close(): void } | null {
  let isEdit = false;
  let close: (() => void) | null = null;
  for (const fiber of ancestors(anchor)) {
    const props = record(fiber.memoizedProps);
    isEdit ||= (record(props?.item)?.id ?? props?.id ?? fiber.key) === "edit-project";
    if (
      isEdit &&
      typeof props?.getContextMenuItems === "function" &&
      typeof props.onOpenChange === "function"
    ) {
      const onOpenChange = props.onOpenChange as (open: boolean) => void;
      close = () => onOpenChange(false);
    }
    const project = asProject(props?.project);
    if (isEdit && close && project) {
      return { project, close };
    }
  }
  return null;
}
