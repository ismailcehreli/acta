import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// Audit records (§15.2). The screen is available to system administrators but
// carries **no content** (§15.1): activity titles, descriptions, and message
// text are not shown.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("login and activity operations appear in the audit trail", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `Audit test ${suffix}`;

  // A Mold Shop employee writes an activity.
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill(`${title} secret description text.`);
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);

  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/audit");

  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.locator('[data-test="audit-record"]').first()).toBeVisible();

  // Login attempts are recorded (§15.3).
  await resilientGoto(page, "/admin/audit?action=login_succeeded");
  await expect(page.locator('[data-test="audit-record"]').first()).toBeVisible();

  // Activity creation is recorded but its **title is not visible**.
  await resilientGoto(page, "/admin/audit?action=activity_created");
  const firstRecord = page.locator('[data-test="audit-record"]').first();
  await expect(firstRecord).toBeVisible();

  const content = await page.content();
  expect(content).not.toContain(title);
  expect(content).not.toContain("secret description text");
});

test("a non-system-administrator cannot see the audit trail", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/admin/audit");

  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  await expect(page.locator('[data-test="audit-record"]')).toHaveCount(0);
});
