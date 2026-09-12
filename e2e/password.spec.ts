import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, e2ePassword } from "./global-setup";

// Password-change flow (§15.3). Use a temporary account created during the run
// rather than a shared test account; changing its password would break other
// tests.
test.describe.configure({ mode: "serial" });

/** Try to sign in without waiting for success (used by error scenarios). */
async function tryLogin(page: Page, email: string, password: string) {
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

/** Sign in and verify that the dashboard is reached. */
async function loginAs(page: Page, email: string, password: string) {
  await tryLogin(page, email, password);
  await expect(page).toHaveURL(/\/$/);
}

test("a user changes their password and the old password becomes invalid", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `password-${suffix}@example.test`;
  const oldPassword = `old-password-${suffix}`;
  const newPassword = `new-password-${suffix}`;

  // The administrator creates a temporary account.
  await loginAs(page, E2E_ADMIN.email, e2ePassword());
  await resilientGoto(page, "/admin/users/new");
  await page.getByLabel("Full name").fill(`Password test ${suffix}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Unit", { exact: true }).selectOption({ label: "Company" });
  await page.getByLabel("Initial password").fill(oldPassword);
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.locator("#user-success")).toBeVisible();
  await resilientGoto(page, `/admin/users?q=${encodeURIComponent(email)}`);
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  const context = await browser.newContext();
  try {
    const userPage = await context.newPage();
    await loginAs(userPage, email, oldPassword);

    // An incorrect current password is rejected.
    await resilientGoto(userPage, "/password");
    await userPage.getByLabel("Current password").fill("definitely-wrong");
    await userPage.getByLabel("New Password", { exact: true }).fill(newPassword);
    await userPage.getByLabel("Confirm New Password").fill(newPassword);
    await userPage.getByRole("button", { name: "Change password" }).click();
    await expect(userPage.locator("#password-error")).toContainText(
      "Your current password is incorrect.",
    );

    // A mismatched confirmation is rejected too.
    await userPage.getByLabel("Current password").fill(oldPassword);
    await userPage.getByLabel("New Password", { exact: true }).fill(newPassword);
    await userPage.getByLabel("Confirm New Password").fill("another-password");
    await userPage.getByRole("button", { name: "Change password" }).click();
    await expect(userPage.locator("#password-error")).toContainText(
      "Passwords do not match",
    );

    // With correct details the password changes, the session closes, and the
    // user is returned to the sign-in screen.
    await userPage.getByLabel("Current password").fill(oldPassword);
    await userPage.getByLabel("New Password", { exact: true }).fill(newPassword);
    await userPage.getByLabel("Confirm New Password").fill(newPassword);
    await userPage.getByRole("button", { name: "Change password" }).click();

    await expect(userPage).toHaveURL(/\/login/);
    await expect(userPage.locator("#password-changed")).toBeVisible();

    // The old password no longer works.
    await tryLogin(userPage, email, oldPassword);
    await expect(userPage.locator("#login-error")).toContainText(
      "The email address or password entered is incorrect.",
    );

    // The new password works.
    await loginAs(userPage, email, newPassword);
  } finally {
    await context.close();
  }
});

test("an unauthenticated user cannot open the password screen", async ({ page }) => {
  await resilientGoto(page, "/password");

  await expect(page).toHaveURL(/\/login$/);
});
