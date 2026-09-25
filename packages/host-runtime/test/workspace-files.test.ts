import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../src/workspace-files.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "codexhost-files-"));
  cleanup.push(directory);
  await mkdir(path.join(directory, "src", "nested"), { recursive: true });
  await writeFile(path.join(directory, "README.md"), "# Fixture\n");
  await writeFile(path.join(directory, "src", "app.ts"), "export const app = true;\n");
  await writeFile(path.join(directory, "src", "nested", "data.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(path.join(directory, ".git"), "not a directory\n");
  return directory;
}

describe("workspace files", () => {
  it("lists one directory level with directories first and filters .git", async () => {
    const directory = await workspace();

    const result = await listWorkspaceFiles(directory, "");

    expect(result.workspace).toBe(await realpath(directory));
    expect(result.entries.map((entry) => entry.path)).toEqual(["src", "README.md"]);
    expect(result.entries[0]).toMatchObject({ kind: "directory", size: null });
    expect(result.entries[1]).toMatchObject({ kind: "file", size: 10 });
  });

  it("reads nested text files and reports binary content", async () => {
    const directory = await workspace();

    await expect(readWorkspaceFile(directory, "src/app.ts")).resolves.toMatchObject({
      path: "src/app.ts",
      content: "export const app = true;\n",
      binary: false,
      truncated: false,
    });
    await expect(readWorkspaceFile(directory, "src/nested/data.bin")).resolves.toMatchObject({
      path: "src/nested/data.bin",
      content: "",
      binary: true,
      truncated: false,
    });
  });

  it("rejects path traversal and reads files only inside the workspace", async () => {
    const directory = await workspace();
    const outside = path.join(directory, "..", "outside.txt");
    await writeFile(outside, "outside\n");
    cleanup.push(outside);

    await expect(listWorkspaceFiles(directory, "../")).rejects.toThrow("越级目录");
    await expect(readWorkspaceFile(directory, "../outside.txt")).rejects.toThrow("越级目录");
    await expect(readWorkspaceFile(directory, "src/nested/../../README.md")).rejects.toThrow(
      "越级目录",
    );
  });

  it("rejects symlinks that escape the workspace", async () => {
    const directory = await workspace();
    const outside = await mkdtemp(path.join(tmpdir(), "codexhost-outside-"));
    cleanup.push(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret\n");
    await symlink(outside, path.join(directory, "outside-link"));

    await expect(listWorkspaceFiles(directory, "outside-link")).rejects.toThrow("超出工作区范围");
  });

  it("truncates files larger than the read limit", async () => {
    const directory = await workspace();
    await writeFile(path.join(directory, "large.txt"), "x".repeat(1024 * 1024 + 32));

    const result = await readWorkspaceFile(directory, "large.txt");

    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(1024 * 1024);
    expect(result.size).toBe(1024 * 1024 + 32);
  });

  it("writes text with revision validation and returns the new revision", async () => {
    const directory = await workspace();
    const before = await readWorkspaceFile(directory, "src/app.ts");

    const saved = await writeWorkspaceFile(
      directory,
      "src/app.ts",
      "export const app = false;\n",
      before.revision,
    );

    expect(await readFile(path.join(directory, "src/app.ts"), "utf8")).toBe(
      "export const app = false;\n",
    );
    await expect(readWorkspaceFile(directory, "src/app.ts")).resolves.toMatchObject({
      content: "export const app = false;\n",
      revision: saved.revision,
      truncated: false,
    });
  });

  it("rejects stale revisions and binary writes", async () => {
    const directory = await workspace();
    const before = await readWorkspaceFile(directory, "src/app.ts");
    await writeFile(path.join(directory, "src/app.ts"), "external change\n");

    await expect(
      writeWorkspaceFile(directory, "src/app.ts", "editor change\n", before.revision),
    ).rejects.toThrow("其他程序修改");
    const binary = await readWorkspaceFile(directory, "src/nested/data.bin");
    await expect(
      writeWorkspaceFile(directory, "src/nested/data.bin", "text\n", binary.revision),
    ).rejects.toThrow("二进制文件");
  });
});
