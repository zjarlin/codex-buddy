import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { localWorkspaceDirectories } from "../src/local-workspace-directories.js";

describe("local workspace folder picker", () => {
  it("opens the nearest existing parent for a missing default destination", async () => {
    const root = path.resolve("/");
    const parent = path.join(root, "projects");
    const git = {
      realpath: vi.fn(async (value: string) => {
        if (value === parent) return value;
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }),
      listDirectories: vi.fn(async () => ["公司的项目", ".git", "alpha"]),
    };
    const result = await localWorkspaceDirectories(git, path.join(parent, "missing", "repo"));
    expect(result.path).toBe(parent);
    expect(result.entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["公司的项目", "alpha"]),
    );
    expect(result.entries).toHaveLength(2);
    expect(git.listDirectories).toHaveBeenCalledWith(parent);
  });

  it("surfaces access errors without silently switching to another folder", async () => {
    const git = {
      realpath: vi.fn(async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      }),
      listDirectories: vi.fn(async () => []),
    };
    await expect(localWorkspaceDirectories(git, path.resolve("/private"))).rejects.toThrow(
      "denied",
    );
    expect(git.realpath).toHaveBeenCalledTimes(1);
    expect(git.listDirectories).not.toHaveBeenCalled();
    await expect(localWorkspaceDirectories(git, "relative")).rejects.toThrow("绝对路径");
  });
});
