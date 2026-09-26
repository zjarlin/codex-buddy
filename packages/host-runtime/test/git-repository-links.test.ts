import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { GitRepositoryLinks } from "../src/git-repository-links.js";
import { GitWorkspace } from "../src/git-workspace.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "codexhost-git-links-")));
  directories.push(directory);
  const repository = async (name: string) => {
    const target = path.join(directory, name);
    execFileSync("git", ["init", "-q", target]);
    await mkdir(path.join(target, "src"));
    await writeFile(path.join(target, "src", "app.txt"), name);
    return target;
  };
  const workspace = new GitWorkspace();
  const home = path.join(directory, "home");
  const create = () => new GitRepositoryLinks(home, (cwd) => workspace.root(cwd));
  return { directory, repository, create, links: create() };
}

test("persists links across sessions, canonicalizes subdirectories and aliases, and isolates projects", async () => {
  const { directory, repository, links, create } = await fixture();
  const backend = await repository("backend");
  const frontend = await repository("frontend");
  const other = await repository("other");
  const alias = path.join(directory, "frontend-alias");
  await symlink(frontend, alias, "dir");
  await links.link(path.join(backend, "src"), path.join(alias, "src"));
  await links.link(backend, frontend);
  await links.link(backend, backend);
  expect(await create().list(backend)).toEqual({
    project: backend,
    repositories: [
      { path: backend, primary: true },
      { path: frontend, primary: false },
    ],
  });
  expect((await links.list(other)).repositories).toEqual([{ path: other, primary: true }]);
  expect(await create().resolve(path.join(backend, "src"), frontend)).toBe(frontend);
  expect(await links.resolve(path.join(backend, "src"))).toBe(backend);
  await expect(links.resolve(other, frontend)).rejects.toThrow("尚未关联");
});

test("concurrent Host connections retain separate links and unlink leaves repository contents intact", async () => {
  const { repository, links, create } = await fixture();
  const backend = await repository("backend");
  const frontend = await repository("frontend");
  const mobile = await repository("mobile");
  await Promise.all([links.link(backend, frontend), create().link(backend, mobile)]);
  expect((await links.list(backend)).repositories).toHaveLength(3);
  await links.unlink(backend, frontend);
  await links.unlink(backend, frontend);
  await expect(links.resolve(backend, frontend)).rejects.toThrow("尚未关联");
  expect(await readFile(path.join(frontend, "src", "app.txt"), "utf8")).toBe("frontend");
  await expect(links.unlink(backend, backend)).rejects.toThrow("主项目");
  await rm(mobile, { recursive: true });
  expect((await links.unlink(backend, mobile)).repositories).toHaveLength(1);
});

test("rejects invalid targets and does not authorize a linked path retargeted to another repository", async () => {
  const { directory, repository, links } = await fixture();
  const backend = await repository("backend");
  const frontend = await repository("frontend");
  const other = await repository("other");
  await expect(links.link(backend, "../frontend")).rejects.toThrow("绝对路径");
  await expect(links.link(backend, directory)).rejects.toThrow("不是 Git 仓库");
  await expect(links.resolve(backend, frontend)).rejects.toThrow("尚未关联");
  await links.link(backend, frontend);
  await rename(frontend, path.join(directory, "frontend-moved"));
  await symlink(other, frontend, "dir");
  await expect(links.resolve(backend, frontend)).rejects.toThrow("位置已变化");
  expect((await links.unlink(backend, frontend)).repositories).toHaveLength(1);
});
