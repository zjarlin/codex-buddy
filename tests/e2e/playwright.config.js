import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH,
    },
  },
});
