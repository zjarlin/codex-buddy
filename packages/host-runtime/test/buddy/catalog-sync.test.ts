import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { syncCodexCatalog } from "../../src/buddy/catalog-sync.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "buddy-catalog-sync-"));
  homes.push(home);
  await mkdir(join(home, "model-sync"));
  await writeFile(join(home, "model-sync", "runtime.mjs"), "// fixture\n");
  return home;
}

it("returns validated provider IDs after the installed synchronizer writes its catalog", async () => {
  const home = await fixture();
  const run = vi.fn(async () => {
    await writeFile(
      join(home, "model-sync", "catalog.json"),
      JSON.stringify({ models: [{ slug: "gpt-a" }, { slug: "deepseek-b" }] }),
    );
    return {
      stdout: JSON.stringify({
        ok: true,
        provider: "fixture",
        visibleCount: 2,
        catalogPath: join(home, "model-sync", "catalog.json"),
      }),
      stderr: "",
    };
  });
  await expect(syncCodexCatalog({ CODEX_HOME: home }, run as never)).resolves.toEqual({
    provider: "fixture",
    returned: 2,
    ids: ["gpt-a", "deepseek-b"],
  });
  expect(run).toHaveBeenCalledWith(
    process.execPath,
    [join(home, "model-sync", "runtime.mjs"), "sync", "--home", home, "--json"],
    expect.objectContaining({ timeout: 60_000 }),
  );
});

it("rejects a failed sync or mismatched catalog without claiming success", async () => {
  const home = await fixture();
  const fail = vi.fn(async () => {
    throw Object.assign(new Error("sensitive command details"), {
      stderr: "codex-buddy: Model endpoint returned HTTP 502.\n",
    });
  });
  await expect(syncCodexCatalog({ CODEX_HOME: home }, fail as never)).rejects.toThrow(
    "Model endpoint returned HTTP 502",
  );
  const mismatch = vi.fn(async () => {
    await writeFile(
      join(home, "model-sync", "catalog.json"),
      JSON.stringify({ models: [{ slug: "gpt-a" }] }),
    );
    return {
      stdout: JSON.stringify({
        ok: true,
        provider: "fixture",
        visibleCount: 2,
        catalogPath: join(home, "model-sync", "catalog.json"),
      }),
      stderr: "",
    };
  });
  await expect(syncCodexCatalog({ CODEX_HOME: home }, mismatch as never)).rejects.toThrow(
    "数量不一致",
  );
});
