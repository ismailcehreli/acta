import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// Scheduled-job monitoring (§12.4): if the worker stops, the system may look
// healthy while reminders silently die. This screen makes that state visible.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("jobs that have never run appear overdue", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/jobs");

  await expect(page.getByRole("heading", { name: "Scheduled Jobs" })).toBeVisible();

  // The worker process does not run during E2E tests, so all three jobs have
  // never run. They still render as rows so "not listed" is not confused with
  // "healthy".
  for (const jobName of [
    "notification_dispatch",
    "missing_activity_reminder",
    "overdue_answer_reminder",
  ]) {
    const row = page.locator(`[data-test="job-${jobName}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("never ran");
    await expect(row.getByText("overdue")).toBeVisible();
  }

  await expect(page.locator('[data-test="overdue-warning"]')).toBeVisible();
});

test("the health endpoint returns 503 for an overdue scheduler", async ({ request }) => {
  const response = await request.get("/api/health");

  // The scheduler is overdue because the worker did not run; the system must
  // not report it as healthy.
  expect(response.status()).toBe(503);

  const report = await response.json();
  expect(report.scheduler.source).toBe("live");
  expect(report.scheduler.status).toBe("down");
  expect(report.notificationQueue.source).toBe("live");
  expect(typeof report.notificationQueue.depth).toBe("number");
});

test("a non-system-administrator cannot see the jobs screen", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/admin/jobs");

  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  await expect(page.locator('[data-test="job-notification_dispatch"]')).toHaveCount(0);
});
