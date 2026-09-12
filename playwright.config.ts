import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Setup step and application server use E2E_DATABASE_URL; loaded from .env.
loadEnv();

const port = Number(process.env.E2E_PORT ?? 3100);
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;

// Acceptance benchmark is excluded from the normal test suite: it generates tens of thousands
// of records and adds minutes to every run. Run manually with its own project:
//
//   pnpm e2e:kabul
const BENCHMARK = "**/acceptance-benchmark.spec.ts";

// These spec files modify shared system state and must run sequentially with a single worker
// to avoid flaky race conditions across parallel runs.
const SHARED_STATE_MUTATORS = [
  // 1 — specs mutating the main system settings form
  "**/settings.spec.ts",
  "**/email-domain.spec.ts",
  "**/text-limits.spec.ts",
  "**/scores.spec.ts",
  // 2 — specs toggling unit approval flags
  "**/notification.spec.ts",
  "**/work-queue.spec.ts",
  "**/approval.spec.ts",
  "**/profile.spec.ts",
  "**/rejection.spec.ts",
  "**/bulk-approval.spec.ts",
];

/** Define two stages per browser: suite first, then shared-state mutators sequentially. */
function browserProjects() {
  const browsers = [
    { name: "chromium", device: "Desktop Chrome" },
    { name: "firefox", device: "Desktop Firefox" },
    { name: "webkit", device: "Desktop Safari" },
  ] as const;

  return browsers.flatMap(({ name, device }) => [
    {
      name,
      use: { ...devices[device] },
      testIgnore: [BENCHMARK, ...SHARED_STATE_MUTATORS],
    },
    {
      name: `${name}-ayar`,
      use: { ...devices[device] },
      testMatch: SHARED_STATE_MUTATORS,
    },
  ]);
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  workers: 2,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    ignoreHTTPSErrors: baseURL.startsWith("https://"),
    locale: "en-US",
    timezoneId: "Europe/Istanbul",
    trace: "on-first-retry",
  },
  projects: [
    ...browserProjects(),
    {
      name: "kabul",
      use: { ...devices["Desktop Chrome"] },
      testMatch: [BENCHMARK],
    },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command: `pnpm build && pnpm start --port ${port}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 300_000,
        env: {
          DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
        },
      },
});
