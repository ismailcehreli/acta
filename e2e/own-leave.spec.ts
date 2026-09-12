import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// A person's own "no activity expected" period and manager approval.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a person enters their own leave period and sees it in the list", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/absence");

  await page.getByLabel("Start").fill("2027-03-01");
  await page.getByLabel("End").fill("2027-03-05");
  // Keep the note unique: the record also appears in the manager's team list
  // (correct behavior), and must not collide with another spec's text filter.
  await page.getByLabel("Note (optional)").fill("My own leave period");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText(/Your request was submitted/)).toBeVisible();
  const row = page
    .locator('[data-test="own-period-row"]')
    .filter({ hasText: "03/01/2027" });
  await expect(row).toBeVisible();
  // The record shows who entered it: the person or their manager.
  await expect(row.getByText("Me")).toBeVisible();
});

test("a person can cancel their own record with a reason", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/absence");

  const row = page
    .locator('[data-test="own-period-row"]')
    .filter({ hasText: "03/01/2027" });
  await row.getByRole("button", { name: "Cancel" }).click();
  await row.getByLabel("Cancellation reason").fill("I entered the wrong dates");
  await row.getByRole("button", { name: "Cancel record" }).click();

  // The record is not deleted and remains struck through.
  await expect(page.getByText("I entered the wrong dates")).toBeVisible();
});

test("a long leave period is rejected and directed to the manager", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/absence");

  // The default limit is 30 days.
  await page.getByLabel("Start").fill("2027-05-01");
  await page.getByLabel("End").fill("2027-08-01");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText(/your manager can enter/)).toBeVisible();
});

test("the manager's team screen continues to work", async ({ page }) => {
  // The existing §12.1 flow must remain available: a manager can still enter
  // records for their team.
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/team/absence");

  await expect(
    page.getByRole("heading", { name: "Add leave period" }),
  ).toBeVisible();
});
