import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_WORKER, e2ePassword } from "./global-setup";

// Browser notifications (Task 5.3b).
//
// Real push delivery cannot be tested with browser automation because the push
// service is external. This covers the **setup flow**: the message shown when
// keys are missing, key generation by a system administrator, and the control
// that appears afterwards. Real delivery remains a manual product-owner check.

test.describe.configure({ mode: "serial" });

// **Boundary:** Chromium in this environment always denies notification
// permission (`Notification.permission === "denied"`), and `grantPermissions`
// does not change it. Firefox and WebKit leave permission "not requested".
// Permission therefore varies by browser and the tests do not **depend on it**.
// The "granted" branch cannot run in any browser here; these tests do not
// pretend otherwise. As stated in the plan's "proof of completion", real
// delivery is a manual product-owner check.

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function openProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My Profile" }).click();
  await expect(page).toHaveURL(/\/users\//);
}

test("the user is told what to do before keys are configured", async ({
  page,
}) => {
  await signIn(page, E2E_WORKER.email);
  await openProfile(page);

  // Show an actionable warning rather than a silent empty space.
  await expect(
    page.getByText("Browser notifications are not configured yet."),
  ).toBeVisible();
  await expect(page.locator('[data-test="push-toggle"]')).toHaveCount(0);
});

test("a system administrator generates keys and the user-facing state changes", async ({
  page,
}) => {
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/settings/delivery");

  // The settings page has several forms; scope assertions to the push section.
  const form = page.locator('[data-test="push-setup"]');
  await expect(form.getByText("Not configured.")).toBeVisible();

  await form.getByLabel("Contact address", { exact: true }).fill("mailto:bt@example.test");
  await form.getByRole("button", { name: "Generate keys and configure" }).click();
  await expect(form.getByText(/A (new )?key pair was generated\./)).toBeVisible();

  // After setup the contact address must be **editable** without changing the
  // keys (2026-08-21). Previously Save rejected the change with "keys already
  // exist", leaving regeneration—which invalidates all subscriptions—as the
  // only way to change the address.
  await resilientGoto(page, "/admin/settings/delivery");
  const configuredForm = page.locator('[data-test="push-setup"]');
  await expect(configuredForm.getByText(/Configured\. \d+ devices are subscribed\./)).toBeVisible();

  await configuredForm.getByLabel("Contact address", { exact: true }).fill("mailto:new-bt@example.test");
  await configuredForm.getByRole("button", { name: "Save" }).click();
  await expect(configuredForm.getByText("Contact address saved.")).toBeVisible();

  // The address must be persisted and the system must remain configured.
  await resilientGoto(page, "/admin/settings/delivery");
  const finalForm = page.locator('[data-test="push-setup"]');
  await expect(finalForm.getByLabel("Contact address", { exact: true })).toHaveValue(
    "mailto:new-bt@example.test",
  );
  await expect(finalForm.getByText(/Configured\. \d+ devices are subscribed\./)).toBeVisible();

  // Setup must **change the user-facing state**: the "not configured" warning
  // is gone and the remaining decision belongs to browser permission.
  await signIn(page, E2E_WORKER.email);
  await openProfile(page);
  await expect(
    page.getByText("Browser notifications are not configured yet."),
  ).toHaveCount(0);

  // **Which** permission state remains depends on the browser, not the
  // application: Chromium denies it up front, while Firefox and WebKit report
  // "not requested" and show an enable control. The assertion must prove that
  // setup handed the remaining decision to the browser, not assume an
  // environment default (2026-08-22, found in the Firefox run).
  await expect(
    page.locator('[data-test="push-toggle"], [data-test="push-blocked"]'),
  ).toBeVisible();
});

test("an invalid contact address is rejected", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/settings/delivery");

  const form = page.locator('[data-test="push-setup"]');
  await form.getByLabel("Contact address", { exact: true }).fill("bt@example.test");
  await form.getByRole("button", { name: /Save|Generate keys and configure/ }).click();

  await expect(form.getByText(/mailto:/).first()).toBeVisible();
});
