import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Related department picker (Task 10.3).
//
// Tree: Company → Head Office → Mold Shop (test manager + Mold Shop Employee)
//                         → Planning (Planning manager)

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("an employee's own unit is preselected", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/activities/new");

  // §5.4: on most days an employee should not need to touch this field.
  await expect(
    page.locator('[data-test="selected-departments"]'),
  ).toContainText("Mold Shop");
  await expect(
    page.getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ }),
  ).toBeChecked();
});

test("no department is preselected for a manager", async ({ page }) => {
  // Selecting every unit below the coordinator would be wrong: a record about
  // IT would also be associated with Logistics.
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");

  await expect(page.locator('[data-test="selected-departments"]')).toHaveCount(0);
  await expect(
    page.locator('[data-test="department-picker"]').getByText("0/5"),
  ).toBeVisible();
});

test("search filters the list without affecting the selection", async ({ page }) => {
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");

  const picker = page.locator('[data-test="department-picker"]');

  await picker.getByLabel("Search departments").fill("plan");
  await expect(picker.getByRole("checkbox", { name: /Planning/ })).toBeVisible();
  await expect(picker.getByRole("checkbox", { name: /Mold Shop/ })).toHaveCount(0);

  await picker.getByRole("checkbox", { name: /Planning/ }).check();
  await expect(picker).toContainText("1/5");

  // Changing the filter does not lose the selection; the hidden checkbox stays
  // checked.
  await picker.getByLabel("Search departments").fill("mold");
  await expect(
    page.locator('[data-test="selected-departments"]'),
  ).toContainText("Planning");
  await expect(picker).toContainText("1/5");
});

test("the empty search result is stated explicitly", async ({ page }) => {
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");

  await page
    .locator('[data-test="department-picker"]')
    .getByLabel("Search departments")
    .fill("no-such-department");

  await expect(page.getByText(/No departments match/)).toBeVisible();
});

test("removing a department from its tag clears the selection", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/activities/new");

  const tags = page.locator('[data-test="selected-departments"]');
  await expect(tags).toContainText("Mold Shop");

  await tags.getByRole("button", { name: "Remove Mold Shop from selection" }).click();

  await expect(page.locator('[data-test="selected-departments"]')).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ }),
  ).not.toBeChecked();
});

test("a department selected through search is saved", async ({ page }) => {
  await signIn(page, E2E_USER.email);
  const title = `Picker test ${String(Date.now()).slice(-6)}`;

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill("Selected through department search.");

  const picker = page.locator('[data-test="department-picker"]');
  await picker.getByLabel("Search departments").fill("plan");
  await picker.getByRole("checkbox", { name: /Planning/ }).check();

  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?record=added$/);

  // Confirm that the record was really written with that department; a
  // "saved" message alone is not evidence.
  await expect(
    page.locator('[data-test="activity-record"]').filter({ hasText: title }),
  ).toContainText("Planning");
});
