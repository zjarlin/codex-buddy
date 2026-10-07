import { expect, test } from "vitest";
import type { GitLogCommit } from "@codexhost/shared-contracts";
import { gitHistoryGraph } from "../src/renderer-git-history.js";

const commit = (id: string, parents: string[]): GitLogCommit => ({
  commit: id,
  parents,
  shortCommit: id,
  subject: id,
  authorName: "author",
  authorEmail: "test@example.test",
  authoredAt: "2026-10-07",
  refs: [],
});

test("keeps diverging heads separate until their common parent", () => {
  const graph = gitHistoryGraph([
    commit("local", ["base"]),
    commit("remote", ["base"]),
    commit("base", []),
  ]);
  expect(graph.map(({ column }) => column)).toEqual([0, 1, 0]);
  expect(graph[1]?.lines).toContainEqual({ from: 1, to: 0, half: "bottom" });
  expect(graph[2]?.lines).toEqual([{ from: 0, to: 0, half: "top" }]);
});

test("renders merge parents and continuation beyond the history limit", () => {
  const graph = gitHistoryGraph([
    commit("merge", ["a", "b"]),
    commit("a", ["base"]),
    commit("b", ["base"]),
  ]);
  expect(graph[0]?.width).toBe(2);
  expect(graph[0]?.lines.filter(({ half }) => half === "bottom")).toHaveLength(2);
  expect(graph[2]?.lines).toContainEqual(expect.objectContaining({ half: "bottom" }));
});
