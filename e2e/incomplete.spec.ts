import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_PLANNER, E2E_WORKER, e2ePassword } from "./global-setup";

// Protection for unfinished text (Task 10.2).
//
// Verify that text is not lost when a user leaves while typing, but is not
// offered again after the record is completed, which would create a duplicate
// activity.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a user can restore text after leaving while typing", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  const text = `Unfinished text ${String(Date.now()).slice(-6)}`;

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(text);
  await page.getByLabel("Description").fill("This text must not be lost.");
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();

  // Leave without saving: the phone rang, the tab closed, or the wrong link
  // was clicked.
  await resilientGoto(page, "/");
  await resilientGoto(page, "/activities/new");

  const banner = page.locator('[data-test="unfinished-draft"]');
  await expect(banner).toBeVisible();

  // It does not fill itself in **automatically**; the user chooses to restore.
  await expect(page.getByLabel("Activity Title")).toHaveValue("");

  await banner.getByRole("button", { name: "Restore" }).click();

  await expect(page.getByLabel("Activity Title")).toHaveValue(text);
  await expect(page.getByLabel("Description")).toHaveValue("This text must not be lost.");
  // The department selection is restored too.
  await expect(
    page.getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ }),
  ).toBeChecked();
  // The banner disappears once the draft is restored.
  await expect(banner).toHaveCount(0);
});

test("completed records are not offered for restoration again", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  const text = `Completed text ${String(Date.now()).slice(-6)}`;

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(text);
  await page.getByLabel("Description").fill("This record will be completed.");
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?record=added$/);

  await resilientGoto(page, "/activities/new");

  // If it were offered, the user could restore and write the same record twice.
  await expect(page.locator('[data-test="unfinished-draft"]')).toHaveCount(0);
});

test("deleted text is not offered for restoration again", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill("Deleted text");
  await page.getByLabel("Description").fill("I do not want this.");

  await resilientGoto(page, "/activities/new");
  const banner = page.locator('[data-test="unfinished-draft"]');
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Delete" }).click();

  await resilientGoto(page, "/activities/new");
  await expect(page.locator('[data-test="unfinished-draft"]')).toHaveCount(0);
});

test("another user's unfinished text is not offered", async ({ page }) => {
  // Showing one user's text to another in a shared browser would leak content.
  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill("Employee private text");
  await page.getByLabel("Description").fill("Nobody should see this.");
  await page.waitForTimeout(700);

  await signIn(page, E2E_PLANNER.email);
  await resilientGoto(page, "/activities/new");

  await expect(page.locator('[data-test="unfinished-draft"]')).toHaveCount(0);
  await expect(page.getByText("Employee private text")).toHaveCount(0);
});
