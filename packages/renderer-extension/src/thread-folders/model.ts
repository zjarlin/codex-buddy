import type {
  ThreadFolder,
  ThreadFolderProject,
  ThreadFoldersConfig,
} from "@codexhost/shared-contracts";
import { UNASSIGNED_THREAD_FOLDER_ID } from "@codexhost/shared-contracts";

export const THREAD_FOLDERS_STORAGE_KEY = "codexhost.thread-folders.v1";
export { UNASSIGNED_THREAD_FOLDER_ID };

export function defaultThreadFolders(): ThreadFoldersConfig {
  return { version: 1, projects: {} };
}

export function emptyThreadFolderProject(): ThreadFolderProject {
  return { folders: [], assignments: {}, selected: null };
}

export function threadFolderProject(
  config: ThreadFoldersConfig,
  projectKey: string,
): ThreadFolderProject {
  return config.projects[projectKey] ?? emptyThreadFolderProject();
}

export function withThreadFolderProject(
  config: ThreadFoldersConfig,
  projectKey: string,
  project: ThreadFolderProject,
): ThreadFoldersConfig {
  return {
    ...config,
    projects: { ...config.projects, [projectKey]: project },
  };
}

export function withThreadFolders(
  config: ThreadFoldersConfig,
  projectKey: string,
  folders: ThreadFolder[],
): ThreadFoldersConfig {
  const current = threadFolderProject(config, projectKey);
  const ids = new Set(folders.map((folder) => folder.id));
  const selected =
    current.selected === null
      ? folders.length > 0
        ? UNASSIGNED_THREAD_FOLDER_ID
        : null
      : current.selected === UNASSIGNED_THREAD_FOLDER_ID
        ? current.selected
        : ids.has(current.selected)
          ? current.selected
          : UNASSIGNED_THREAD_FOLDER_ID;
  return withThreadFolderProject(config, projectKey, {
    folders,
    assignments: Object.fromEntries(
      Object.entries(current.assignments).filter(([, folderId]) => ids.has(folderId)),
    ),
    selected,
  });
}

export function withThreadFolderAssignment(
  config: ThreadFoldersConfig,
  projectKey: string,
  threadId: string,
  folderId: string | null,
): ThreadFoldersConfig {
  const current = threadFolderProject(config, projectKey);
  const assignments = { ...current.assignments };
  if (folderId === null) {
    Reflect.deleteProperty(assignments, threadId);
  } else if (current.folders.some((folder) => folder.id === folderId)) {
    assignments[threadId] = folderId;
  }
  return withThreadFolderProject(config, projectKey, { ...current, assignments });
}

export function selectedThreadFolder(project: ThreadFolderProject): string | null {
  if (project.selected === null) {
    return project.folders.length > 0 ? UNASSIGNED_THREAD_FOLDER_ID : null;
  }
  if (project.selected === UNASSIGNED_THREAD_FOLDER_ID) return project.selected;
  return project.folders.some((folder) => folder.id === project.selected)
    ? project.selected
    : UNASSIGNED_THREAD_FOLDER_ID;
}

export function parseThreadFolders(raw: string | null): ThreadFoldersConfig {
  if (raw === null) return defaultThreadFolders();
  const value = JSON.parse(raw) as unknown;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !== 1 ||
    !(value as { projects?: unknown }).projects ||
    typeof (value as { projects?: unknown }).projects !== "object" ||
    Array.isArray((value as { projects?: unknown }).projects)
  ) {
    throw new Error("Invalid Thread folder configuration");
  }
  const projects = (value as { projects: Record<string, unknown> }).projects;
  for (const project of Object.values(projects)) {
    if (
      !project ||
      typeof project !== "object" ||
      Array.isArray(project) ||
      !Array.isArray((project as { folders?: unknown }).folders) ||
      !(project as { assignments?: unknown }).assignments ||
      typeof (project as { assignments?: unknown }).assignments !== "object" ||
      Array.isArray((project as { assignments?: unknown }).assignments) ||
      !(
        (project as { selected?: unknown }).selected === null ||
        typeof (project as { selected?: unknown }).selected === "string"
      )
    ) {
      throw new Error("Invalid Thread folder project configuration");
    }
    const folders = (project as { folders: unknown[] }).folders;
    if (
      !folders.every(
        (folder) =>
          folder &&
          typeof folder === "object" &&
          !Array.isArray(folder) &&
          typeof (folder as { id?: unknown }).id === "string" &&
          (folder as { id: string }).id.length > 0 &&
          typeof (folder as { name?: unknown }).name === "string" &&
          (folder as { name: string }).name.trim().length > 0,
      ) ||
      new Set(folders.map((folder) => (folder as { id: string }).id)).size !== folders.length
    ) {
      throw new Error("Invalid Thread folder list");
    }
  }
  return value as ThreadFoldersConfig;
}
