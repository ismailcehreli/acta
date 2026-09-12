import { resilientGoto } from "./navigation";
import { expect, test } from "./test-base";

test("the sign-in page opens", async ({ page }) => {
  await resilientGoto(page, "/login");
  await expect(
    page.getByRole("heading", { name: "Sign In" }),
  ).toBeVisible();
});

test("Tailwind styles are applied to the page", async ({ page }) => {
  await resilientGoto(page, "/login");
  const heading = page.getByRole("heading", { name: "Sign In" });

  // The sign-in heading uses the page-title scale (--text-2xl = 27px). Without
  // compiled styles, the browser default for h1 would be 32px.
  await expect(heading).toHaveCSS("font-size", "27px");
});

test("the health endpoint checks the database connection", async ({ request }) => {
  const response = await request.get("/api/health");

  const report = await response.json();

  // The database is running.
  expect(report.database.status).toBe("ok");
  expect(typeof report.database.latencyMs).toBe("number");

  // Overall health checks more than the database: during an end-to-end run the
  // worker process is not running, so its heartbeat is stale and reports "down"
  // (Task 5.6). Reporting "ok" while the scheduler is stopped would be the
  // silent failure §12.4 is designed to prevent.
  expect(report.scheduler.status).toBe("down");
  expect(report.status).toBe("down");
  expect(response.status()).toBe(503);

  // Detailed coverage is in `e2e/jobs.spec.ts`.
  expect(report.notificationQueue).toHaveProperty("depth");
});
