import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export async function buildAutoModelRoutesWorker(repositoryRoot) {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["packages/host-runtime/src/ssh-auto-model-routes-worker.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    packages: "bundle",
    sourcemap: false,
    minify: true,
    treeShaking: true,
    charset: "utf8",
    legalComments: "none",
    write: false,
    logLevel: "silent",
  });
  const source = result.outputFiles[0]?.text;
  if (!source) throw new Error("Auto route Worker build did not return source");
  return source;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) {
  const root = path.resolve(import.meta.dirname, "../../..");
  const output = path.join(
    root,
    "packages/host-runtime/dist/ssh-auto-model-routes-worker.bundle.mjs",
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, await buildAutoModelRoutesWorker(root));
}
