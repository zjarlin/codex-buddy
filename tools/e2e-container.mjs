#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// CentOS 7 and other glibc < 2.25 hosts cannot start Playwright's bundled
// Chromium. Running the same suite inside the official Playwright image keeps
// the host's Node and OS untouched while providing a compatible browser.
const root = resolve(import.meta.dirname, "..");
const image =
  process.env.CODEXHOST_PLAYWRIGHT_IMAGE ?? "mcr.microsoft.com/playwright:v1.62.0-noble";
const forwarded = process.argv.slice(2);

const dockerArgs = ["run", "--rm", "--init", "--ipc=host", "-v", `${root}:${root}`, "-w", root];

for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith("CODEXHOST_PLAYWRIGHT_")) {
    dockerArgs.push("-e", `${name}=${value}`);
  }
}

dockerArgs.push(image, "npx", "playwright", "test", "--config", "tests/e2e/playwright.config.js");
dockerArgs.push(...forwarded);

const result = spawnSync("docker", dockerArgs, { stdio: "inherit" });
if (result.error) {
  console.error(`[e2e-container] Could not start Docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
