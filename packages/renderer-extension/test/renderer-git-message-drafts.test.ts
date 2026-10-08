import { expect, test } from "vitest";
import { GitMessageDrafts } from "../src/renderer-git-message-drafts.js";

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test("reuses generated content after reopening and scopes drafts by Host and repository", () => {
  const saved = storage();
  const drafts = new GitMessageDrafts(saved);
  const key = JSON.stringify(["host", "/repo"]);
  drafts.complete(key, "revision", "fix: cached", drafts.start(key, "revision"));
  drafts.finish(key);
  const reopened = new GitMessageDrafts(saved);
  expect(reopened.read(key, "revision")).toBe("fix: cached");
  expect(reopened.shouldGenerate(key, "revision")).toBe(false);
  expect(reopened.shouldGenerate(key, "changed")).toBe(true);
  expect(reopened.read(JSON.stringify(["other", "/repo"]), "revision")).toBe("");
});

test("preserves typing during generation and manual drafts when content changes", () => {
  const drafts = new GitMessageDrafts(storage());
  const version = drafts.start("repo", "revision");
  drafts.edit("repo", "revision", "my message");
  expect(drafts.complete("repo", "revision", "stale result", version)).toBe(false);
  drafts.finish("repo");
  expect(drafts.read("repo", "new revision")).toBe("my message");
  expect(drafts.shouldGenerate("repo", "new revision")).toBe(false);
  drafts.clear("repo");
  expect(drafts.shouldGenerate("repo", "new revision")).toBe(true);
});

test("coalesces automatic attempts, suppresses retry loops, and permits explicit retry", () => {
  const drafts = new GitMessageDrafts(storage());
  drafts.start("repo", "revision");
  expect(drafts.shouldGenerate("repo", "revision")).toBe(false);
  drafts.finish("repo");
  expect(drafts.shouldGenerate("repo", "revision")).toBe(false);
  const retry = drafts.start("repo", "revision");
  drafts.complete("repo", "revision", "fix: retry", retry);
  drafts.finish("repo");
  expect(drafts.read("repo", "revision")).toBe("fix: retry");
});
