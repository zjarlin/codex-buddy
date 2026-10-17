import { describe, expect, it } from "vitest";

import { createPendingFolderThreads } from "../src/thread-folders/pending-threads.js";

const existing = { key: "thread-a", draft: false };

describe("Pending folder thread classification", () => {
  it("files the draft that appears after the native new-conversation entry", () => {
    const pending = createPendingFolderThreads();
    pending.begin("project", "plan", [existing], 1_000);

    expect(pending.observe("project", [existing], 1_001)).toEqual({
      boundDraft: null,
      assigned: null,
      dropped: false,
    });
    expect(
      pending.observe("project", [existing, { key: "client-new-thread:one", draft: true }], 1_002),
    ).toEqual({ boundDraft: "client-new-thread:one", assigned: null, dropped: false });
    expect(pending.folderFor("project", "client-new-thread:one")).toBe("plan");
    expect(pending.state("project")).toEqual({
      draftKey: "client-new-thread:one",
      folderId: "plan",
    });
  });

  it("assigns the materialized conversation once the bound draft disappears", () => {
    const pending = createPendingFolderThreads();
    pending.begin("project", "plan", [], 1_000);
    pending.observe("project", [{ key: "client-new-thread:one", draft: true }], 1_001);

    expect(
      pending.observe(
        "project",
        [
          { key: "client-new-thread:one", draft: true },
          { key: "thread-b", draft: false },
        ],
        1_002,
      ),
    ).toEqual({ boundDraft: null, assigned: null, dropped: false });
    expect(
      pending.observe(
        "project",
        [
          { key: "thread-b", draft: false },
          { key: "thread-c", draft: false },
        ],
        1_003,
      ),
    ).toEqual({
      boundDraft: null,
      assigned: { folderId: "plan", threadId: "thread-c" },
      dropped: false,
    });
    expect(pending.state("project")).toBeNull();
  });

  it("assigns directly when the conversation materializes without a draft row", () => {
    const pending = createPendingFolderThreads();
    pending.begin("project", "plan", [existing], 1_000);

    expect(
      pending.observe("project", [existing, { key: "thread-b", draft: false }], 1_001),
    ).toEqual({
      boundDraft: null,
      assigned: { folderId: "plan", threadId: "thread-b" },
      dropped: false,
    });
  });

  it("keeps the intent while the project renders no rows", () => {
    const pending = createPendingFolderThreads();
    pending.begin("project", "plan", [existing], 1_000);
    pending.observe("project", [{ key: "client-new-thread:one", draft: true }], 1_001);

    expect(pending.observe("project", [], 1_002)).toEqual({
      boundDraft: null,
      assigned: null,
      dropped: false,
    });
    expect(pending.folderFor("project", "client-new-thread:one")).toBe("plan");
  });

  it("drops the intent when several candidates appear at once", () => {
    const pending = createPendingFolderThreads();
    pending.begin("project", "plan", [], 1_000);

    expect(
      pending.observe(
        "project",
        [
          { key: "thread-b", draft: false },
          { key: "thread-c", draft: false },
        ],
        1_001,
      ),
    ).toEqual({ boundDraft: null, assigned: null, dropped: true });
    expect(pending.state("project")).toBeNull();
  });

  it("matches the materialized conversation even when another draft is opened", () => {
    const pending = createPendingFolderThreads();
    pending.begin("project", "plan", [], 1_000);
    pending.observe("project", [{ key: "client-new-thread:one", draft: true }], 1_001);

    expect(
      pending.observe(
        "project",
        [
          { key: "client-new-thread:two", draft: true },
          { key: "thread-b", draft: false },
        ],
        1_002,
      ),
    ).toEqual({
      boundDraft: null,
      assigned: { folderId: "plan", threadId: "thread-b" },
      dropped: false,
    });
  });

  it("expires unbound and long-missing intents instead of guessing later", () => {
    const pending = createPendingFolderThreads();
    pending.begin("project", "plan", [], 0);
    expect(pending.observe("project", [], 600_001)).toEqual({
      boundDraft: null,
      assigned: null,
      dropped: true,
    });

    // 草稿消失后还没看到新会话时先等一段中间态；超时即放弃，避免把之后出现的
    // 无关会话误归入该文件夹。
    pending.begin("project", "plan", [], 0);
    pending.observe("project", [{ key: "client-new-thread:one", draft: true }], 1);
    expect(pending.observe("project", [], 30_000)).toEqual({
      boundDraft: null,
      assigned: null,
      dropped: false,
    });
    expect(pending.observe("project", [], 200_000)).toEqual({
      boundDraft: null,
      assigned: null,
      dropped: true,
    });
  });

  it("isolates intents per project and supports cancellation", () => {
    const pending = createPendingFolderThreads();
    pending.begin("one", "plan", [], 1_000);
    expect(pending.observe("two", [{ key: "thread-b", draft: false }], 1_001)).toEqual({
      boundDraft: null,
      assigned: null,
      dropped: false,
    });
    expect(pending.folderFor("two", "client-new-thread:one")).toBeNull();
    pending.cancel("one");
    expect(pending.state("one")).toBeNull();
  });
});
