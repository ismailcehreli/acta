import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_PLANNER, E2E_WORKER, e2ePassword } from "./global-setup";

// Error and loading surfaces (Task 10.1).
//
// The main property is that the **404 surface does not distinguish cases**.
// "This record does not exist" and "you cannot see it" return the same response;
// otherwise the existence of an invisible record would be disclosed (§8.2,
// §18.4).

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a nonexistent address shows the 404 surface", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);

  const response = await resilientGoto(page, "/no-such-page");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
  // The user is not left at a dead end.
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
});

test("an invisible record has the same surface as a nonexistent record", async ({ page }) => {
  // An employee writes an activity and obtains its address.
  await signIn(page, E2E_WORKER.email);
  const suffix = String(Date.now()).slice(-6);
  const title = `Hidden record ${suffix}`;

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill("Another branch must not see this record.");
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?/);

  await page
    .locator('[data-test="activity-record"]')
    .filter({ hasText: title })
    .getByRole("link", { name: title })
    .click();
  await expect(page).toHaveURL(/\/activities\/[0-9a-f-]{36}$/);
  const recordUrl = page.url();

  // The Planning manager is on another branch and cannot see the record.
  await signIn(page, E2E_PLANNER.email);
  const response = await resilientGoto(page, recordUrl);

  expect(response?.status()).toBe(404);
  // **Same** surface: it does not say "not authorized" or leak the title.
  await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});
