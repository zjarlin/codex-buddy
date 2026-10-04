import { describe, expect, it } from "vitest";

import {
  defaultThreadFolders,
  selectedThreadFolder,
  threadFolderProject,
  UNASSIGNED_THREAD_FOLDER_ID,
  withThreadFolderAssignment,
  withThreadFolders,
  withThreadFolderProject,
} from "../src/thread-folders/model.js";

describe("Thread folder model", () => {
  it("keeps folders and assignments isolated by project key", () => {
    const first = withThreadFolders(defaultThreadFolders(), "project-a", [
      { id: "todo", name: "待办" },
    ]);
    const second = withThreadFolders(first, "project-b", [{ id: "done", name: "完成" }]);
    const assignedA = withThreadFolderAssignment(second, "project-a", "thread-a", "todo");
    const assignedB = withThreadFolderAssignment(assignedA, "project-b", "thread-a", "done");

    expect(threadFolderProject(assignedB, "project-a").assignments).toEqual({
      "thread-a": "todo",
    });
    expect(threadFolderProject(assignedB, "project-b").assignments).toEqual({
      "thread-a": "done",
    });
  });

  it("clears deleted folder assignments and invalid selections", () => {
    const config = withThreadFolderProject(
      withThreadFolders(defaultThreadFolders(), "project", [{ id: "todo", name: "待办" }]),
      "project",
      {
        folders: [{ id: "todo", name: "待办" }],
        assignments: { "thread-a": "todo" },
        selected: "todo",
      },
    );
    const updated = withThreadFolders(config, "project", [{ id: "done", name: "完成" }]);

    expect(threadFolderProject(updated, "project")).toEqual({
      folders: [{ id: "done", name: "完成" }],
      assignments: {},
      selected: null,
    });
    expect(selectedThreadFolder(threadFolderProject(updated, "project"))).toBeNull();
  });

  it("supports the unassigned filter and manual removal from a folder", () => {
    const withFolder = withThreadFolders(defaultThreadFolders(), "project", [
      { id: "todo", name: "待办" },
    ]);
    const assigned = withThreadFolderAssignment(withFolder, "project", "thread-a", "todo");
    const selected = withThreadFolderProject(assigned, "project", {
      ...threadFolderProject(assigned, "project"),
      selected: UNASSIGNED_THREAD_FOLDER_ID,
    });

    expect(selectedThreadFolder(threadFolderProject(selected, "project"))).toBe(
      UNASSIGNED_THREAD_FOLDER_ID,
    );
    expect(
      threadFolderProject(
        withThreadFolderAssignment(selected, "project", "thread-a", null),
        "project",
      ).assignments,
    ).toEqual({});
  });
});
