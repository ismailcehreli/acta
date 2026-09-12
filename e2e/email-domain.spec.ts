import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, e2ePassword } from "./global-setup";

// Email-domain restriction: enable it in settings, observe it on the user
// creation screen, and verify that disabling it removes the restriction.
//
// The setting is **shared state**; always clear it at the end or later tests
// that create users will fail.

test.describe.configure({ mode: "serial" });

const ALLOWED_DOMAINS_LABEL = "Allowed email domains";

async function loginAsAdmin(page: Page): Promise<void> {
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(E2E_ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function setRestriction(page: Page, value: string): Promise<void> {
  await resilientGoto(page, "/admin/settings/accounts");
  await page.getByLabel(ALLOWED_DOMAINS_LABEL).fill(value);
  await page.getByRole("button", { name: "Save settings" }).click();
  // If the value was already the same, the screen says "No changes"; both
  // outcomes prove that the save was processed.
  await expect(page.getByText(/settings updated|No changes/)).toBeVisible();
  await expect(page.getByLabel(ALLOWED_DOMAINS_LABEL)).toHaveValue(value);
}

test("an account outside the restriction is rejected and accepted after clearing it", async ({
  page,
}) => {
  await loginAsAdmin(page);

  try {
    await setRestriction(page, "acme.com");

    const suffix = String(Date.now()).slice(-6);

    await resilientGoto(page, "/admin/users/new");
    await page.getByLabel("Full name").fill(`Wrong domain ${suffix}`);
    await page.getByLabel("Email", { exact: true }).fill(`person-${suffix}@other.test`);
    await page
      .getByLabel("Unit", { exact: true })
      .selectOption({ label: "Company" });
    await page.getByLabel("Initial password").fill("initial-password-1");
    await page.getByRole("button", { name: "Add user" }).click();

    // The error must state which domains are accepted.
    await expect(page.locator("#user-error")).toContainText(
      "acme.com",
    );
    await expect(page.getByRole("cell", { name: `person-${suffix}@other.test` })).toHaveCount(
      0,
    );
  } finally {
    // Always clear the restriction.
    await setRestriction(page, "");
  }

  // After clearing the restriction, the same type of address is accepted.
  const suffix = String(Date.now()).slice(-6);
  await resilientGoto(page, "/admin/users/new");
  await page.getByLabel("Full name").fill(`Unrestricted domain ${suffix}`);
  await page.getByLabel("Email", { exact: true }).fill(`free-${suffix}@other.test`);
  await page.getByLabel("Unit", { exact: true }).selectOption({ label: "Company" });
  await page.getByLabel("Initial password").fill("initial-password-2");
  await page.getByRole("button", { name: "Add user" }).click();

  await expect(page.locator("#user-success")).toContainText(`Unrestricted domain ${suffix}`);
});
