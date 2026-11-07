import { defineConfig, devices } from "@playwright/test";

const port = 3456;
const baseURL = process.env.FOUNDRY_E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "on-first-retry",
  },
  webServer: process.env.FOUNDRY_E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @foundry/web exec next dev --port ${port}`,
        url: `${baseURL}/signin`,
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          ...process.env,
          DATABASE_URL: "",
          FOUNDRY_SECRET: "",
          AUTH_SECRET: process.env.AUTH_SECRET ?? "playwright-auth-secret-at-least-32-chars",
          AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID ?? "Iv23playwright",
          AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET ?? "playwright-secret",
        },
      },
});
