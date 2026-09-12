import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// System settings (§16.5): parameters can be changed from the UI without reading
// or changing code.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a system administrator changes a setting and the value persists", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/settings/approval");

  await expect(
    page.getByRole("heading", { name: "Approval and follow-up settings" }),
  ).toBeVisible();

  const field = page.getByLabel("No-activity reminder");
  await expect(field).toHaveValue("3");

  await field.fill("5");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/1 settings updated/i)).toBeVisible();

  // The new value remains after reopening the page.
  await resilientGoto(page, "/admin/settings/approval");
  await expect(page.getByLabel("No-activity reminder")).toHaveValue("5");

  // Restore the old value so other tests are not affected.
  await page.getByLabel("No-activity reminder").fill("3");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/1 settings updated/i)).toBeVisible();
});

test("the revision window can be configured from the UI", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/settings/general");

  const field = page.getByLabel("Revision window");
  await expect(field).toHaveValue("15");

  await field.fill("30");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/1 settings updated/i)).toBeVisible();
  await resilientGoto(page, "/admin/settings/general");
  await expect(page.getByLabel("Revision window")).toHaveValue("30");

  // Restore the product-approved default for other tests.
  await page.getByLabel("Revision window").fill("15");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/1 settings updated/i)).toBeVisible();
});

test("an out-of-range value is rejected and no setting is written", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/settings/approval");

  // Remove the field's min/max constraints to bypass browser validation: the
  // server is the actual authority, and hiding a value in the UI is not security.
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      'input[name="overdue_answer_business_days"]',
    );
    if (input) {
      input.removeAttribute("min");
      input.removeAttribute("max");
      input.value = "999";
    }
  });

  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/must be at most 30/i)).toBeVisible();

  // The invalid value must not be written.
  await resilientGoto(page, "/admin/settings/approval");
  await expect(page.getByLabel("No-activity reminder")).toHaveValue("3");
});

test("a non-system-administrator cannot view settings", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/admin/settings");

  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
});

test("SMTP settings can be saved from the UI without exposing the password", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/settings/delivery");

  await expect(
    page.getByRole("heading", { name: "Email delivery (SMTP)" }),
  ).toBeVisible();

  await page.getByLabel("Server address").fill("mail.end-to-end.test");
  await page.getByLabel("Port", { exact: true }).fill("2525");
  await page.getByLabel("From address").fill("activity@end-to-end.test");
  await page.locator('input[name="password"]').fill("secret-end-to-end");
  await page.getByRole("button", { name: "Save SMTP settings" }).click();

  await expect(page.getByText("SMTP settings saved")).toBeVisible();

  // Values remain after reopening the page, but the password field is **empty**.
  await resilientGoto(page, "/admin/settings/delivery");
  await expect(page.getByLabel("Server address")).toHaveValue("mail.end-to-end.test");
  await expect(page.getByLabel("Port", { exact: true })).toHaveValue("2525");
  await expect(page.locator('input[name="password"]')).toHaveValue("");
  await expect(
    page.getByText("Configured. Leave blank to keep the current password."),
  ).toBeVisible();

  // The password must never appear in the page source.
  const content = await page.content();
  expect(content).not.toContain("secret-end-to-end");

  // Keep the test environment clean by deleting the password. The button
  // disappears and the password field reports that it is not configured.
  await page.getByRole("button", { name: "Remove saved password" }).click();
  await expect(page.getByText("Not configured.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove saved password" }),
  ).toHaveCount(0);
});
