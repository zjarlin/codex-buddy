import { z } from "zod";

export const THREAD_FOLDERS_GET_METHOD = "codexhost/settings/thread-folders/get";
export const THREAD_FOLDERS_SET_METHOD = "codexhost/settings/thread-folders/set";
export const UNASSIGNED_THREAD_FOLDER_ID = "__unfiled__";

export const threadFolderSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(80),
  })
  .strict();
export type ThreadFolder = z.infer<typeof threadFolderSchema>;

export const threadFolderProjectSchema = z
  .object({
    folders: z.array(threadFolderSchema).max(100),
    assignments: z.record(z.string(), z.string().min(1).max(128)),
    selected: z.string().min(1).max(128).nullable(),
  })
  .strict()
  .superRefine((project, context) => {
    const ids = new Set(project.folders.map((folder) => folder.id));
    if (ids.size !== project.folders.length) {
      context.addIssue({
        code: "custom",
        path: ["folders"],
        message: "Folder IDs must be unique",
      });
    }
    if (
      project.selected !== null &&
      project.selected !== UNASSIGNED_THREAD_FOLDER_ID &&
      !ids.has(project.selected)
    ) {
      context.addIssue({
        code: "custom",
        path: ["selected"],
        message: "Selected folder is missing",
      });
    }
    for (const [thread, folderId] of Object.entries(project.assignments)) {
      if (!ids.has(folderId)) {
        context.addIssue({
          code: "custom",
          path: ["assignments", thread],
          message: "Assigned folder is missing",
        });
      }
    }
  });
export type ThreadFolderProject = z.infer<typeof threadFolderProjectSchema>;

export const threadFoldersConfigSchema = z
  .object({
    version: z.literal(1),
    projects: z.record(z.string(), threadFolderProjectSchema),
  })
  .strict();
export type ThreadFoldersConfig = z.infer<typeof threadFoldersConfigSchema>;

export const threadFoldersGetParamsSchema = z.object({}).strict();
export const threadFoldersStateSchema = z
  .object({
    config: threadFoldersConfigSchema.nullable(),
  })
  .strict();
export type ThreadFoldersState = z.infer<typeof threadFoldersStateSchema>;
