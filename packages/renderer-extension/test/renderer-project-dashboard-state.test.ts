import { describe, expect, it, vi } from "vitest";

import { readProjectDashboard } from "../src/renderer-project-dashboard-state.js";

function turn(input: {
  id: string;
  status?: string;
  startedAt?: number;
  question?: string;
  answer?: string;
  changes?: { path: string; additions: number; deletions: number }[];
}) {
  return {
    id: input.id,
    status: input.status ?? "completed",
    completedAt: 1_700_000_120,
    startedAt: input.startedAt ?? 1_700_000_000,
    durationMs: 120_000,
    items: [
      ...(input.question
        ? [
            {
              id: `${input.id}-user`,
              type: "userMessage",
              content: [{ type: "text", text: input.question }],
            },
          ]
        : []),
      ...(input.answer
        ? [{ id: `${input.id}-agent`, type: "agentMessage", text: input.answer }]
        : []),
      ...(input.changes?.length
        ? [
            {
              id: `${input.id}-files`,
              type: "fileChange",
              changes: input.changes.map((change) => ({
                path: change.path,
                kind: "update",
                unifiedDiff: "",
                additions: change.additions,
                deletions: change.deletions,
              })),
            },
          ]
        : []),
    ],
    itemsView: "summary",
  };
}

describe("project dashboard aggregation", () => {
  it("groups threads by Host project and exposes only result-facing Turn facts", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      const requestParams = params as Record<string, unknown>;
      if (method === "thread/list") {
        return {
          data: [
            {
              id: "thread-a",
              cwd: "/work/codex-host",
              name: "Fix dashboard",
              updatedAt: 1_700_000_500,
              status: { type: "active" },
            },
            {
              id: "thread-b",
              cwd: "/work/codex-host",
              name: "Update docs",
              updatedAt: 1_700_000_400,
              status: { type: "idle" },
            },
            {
              id: "thread-c",
              cwd: "/work/other",
              name: "Other project",
              updatedAt: 1_700_000_300,
              status: { type: "idle" },
            },
          ],
        };
      }
      if (method === "thread/turns/list" && requestParams.threadId === "thread-a") {
        return {
          data: [
            turn({
              id: "turn-2",
              status: "inProgress",
              question: "继续",
              answer: "已完成但仍在写文件",
              startedAt: 1_700_000_200,
            }),
            turn({
              id: "turn-1",
              question: "实现功能",
              answer: "功能已实现并验证。",
              changes: [{ path: "src/a.ts", additions: 12, deletions: 3 }],
            }),
          ],
        };
      }
      if (method === "thread/turns/list" && requestParams.threadId === "thread-b") {
        return {
          data: [
            turn({
              id: "turn-b",
              status: "failed",
              question: "更新说明",
              answer: "验证失败。",
              changes: [
                { path: "docs/a.md", additions: 4, deletions: 1 },
                { path: "docs/a.md", additions: 2, deletions: 0 },
              ],
            }),
          ],
        };
      }
      if (method === "thread/turns/list" && requestParams.threadId === "thread-c") {
        return { data: [turn({ id: "turn-c", answer: "完成 other。" })] };
      }
      throw new Error(`Unexpected request: ${method}`);
    });

    const snapshot = await readProjectDashboard(request, { now: () => 1_700_001_000 });

    expect(snapshot.projects.map((project) => project.label)).toEqual(["codex-host", "other"]);
    expect(snapshot.projects[0]).toMatchObject({
      activeCount: 1,
      completedCount: 1,
      changedFiles: 1,
      additions: 12,
      deletions: 3,
    });
    expect(snapshot.threads[0]).toMatchObject({
      id: "thread-a",
      active: true,
      turns: [
        { id: "turn-2", status: "running" },
        { id: "turn-1", summary: "功能已实现并验证。", changedFiles: 1 },
      ],
    });
    expect(request).toHaveBeenCalledWith(
      "thread/turns/list",
      expect.objectContaining({ itemsView: "full", limit: 6 }),
    );
  });

  it("keeps one project usable when another Thread history read fails", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      const requestParams = params as Record<string, unknown>;
      if (method === "thread/list") {
        return {
          data: [
            { id: "ok", cwd: "/repo/ok", name: "OK", updatedAt: 2 },
            { id: "bad", cwd: "/repo/bad", name: "Bad", updatedAt: 1 },
          ],
        };
      }
      if (requestParams.threadId === "bad") throw new Error("history unavailable");
      return { data: [turn({ id: "turn-ok", answer: "完成。" })] };
    });

    const snapshot = await readProjectDashboard(request);

    expect(snapshot.projects).toHaveLength(2);
    expect(
      snapshot.projects.find((project) => project.label === "ok")?.threads[0]?.turns,
    ).toHaveLength(1);
    expect(snapshot.projects.find((project) => project.label === "bad")?.threads[0]).toMatchObject({
      turns: [],
      error: "history unavailable",
    });
    expect(snapshot.errors).toContain("Bad: history unavailable");
  });
});
