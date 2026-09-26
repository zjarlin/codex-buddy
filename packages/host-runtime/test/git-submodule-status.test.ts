import { expect, it, vi } from "vitest";
import { readGitSubmoduleStatus } from "../src/git-submodule-status.js";

it("preserves unrelated Git errors instead of reporting a successful read", async () => {
  const failure = new Error("fatal: bad object HEAD");
  const git = vi.fn().mockRejectedValue(failure);
  await expect(readGitSubmoduleStatus("/repo", git)).rejects.toBe(failure);
  expect(git).toHaveBeenCalledTimes(1);
});
