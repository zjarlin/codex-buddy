import { build } from "esbuild";
import path from "node:path";

import { tailwindEsbuildPlugin } from "./tailwind-esbuild-plugin.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const entries = [
  { entry: "src/index.ts", format: "esm", outfile: "dist/index.js" },
  { entry: "src/production-entry.ts", format: "iife", outfile: "dist/production.js" },
  { entry: "src/probe-entry.ts", format: "iife", outfile: "dist/renderer-binding-probe.js" },
  { entry: "src/audit-entry.ts", format: "iife", outfile: "dist/contract-audit.js" },
  { entry: "src/console-entry.ts", format: "iife", outfile: "dist/console.js" },
  { entry: "src/mobile-entry.ts", format: "iife", outfile: "dist/mobile.js" },
];

for (const { entry, format, outfile } of entries) {
  await build({
    absWorkingDir: packageRoot,
    entryPoints: [entry],
    bundle: true,
    platform: "browser",
    format,
    target: "es2024",
    loader: { ".png": "dataurl", ".svg": "dataurl", ".css": "text" },
    plugins: [tailwindEsbuildPlugin()],
    outfile,
  });
}

// The phone page links its stylesheet; it is not imported into the script bundle.
await build({
  absWorkingDir: packageRoot,
  entryPoints: ["src/mobile/mobile.css"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2024",
  outfile: "dist/mobile.css",
});
