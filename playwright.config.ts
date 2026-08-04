import { defineConfig } from "@playwright/test";

const useBundledChromium = process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1";

export default defineConfig({
  testDir: "./e2e/specs",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }]
  ],
  use: {
    baseURL: "http://127.0.0.1:4100",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ...(useBundledChromium ? {} : { channel: "msedge" as const })
  },
  webServer: {
    // Build once and serve the SPA and API from the same non-watching process.
    // This keeps Windows file watchers out of deterministic regression runs.
    command: "npm run build -w apps/web && node node_modules/tsx/dist/cli.mjs apps/server/src/index.ts",
    url: "http://127.0.0.1:4100/api/health",
    timeout: 120_000,
    reuseExistingServer: false
  }
});
