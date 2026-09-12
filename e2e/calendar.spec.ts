import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Task 5.4a (§12.1): the work calendar belongs to the system administrator;
// the "no activity expected" marker belongs to the person's manager.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a system administrator edits the work calendar and adds a holiday", async ({
  page,
}) => {
  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/calendar");

  await expect(
    page.getByRole("heading", { name: "Work Calendar" }),
  ).toBeVisible();

  // Make Saturday a working day.
  await page.getByRole("checkbox", { name: "Saturday" }).check();
  await page.getByRole("button", { name: "Save calendar" }).click();
  await expect(page.getByText("Work calendar saved.")).toBeVisible();

  // The selection persists after reopening the page.
  await resilientGoto(page, "/admin/calendar");
  await expect(page.getByRole("checkbox", { name: "Saturday" })).toBeChecked();

  // Add a holiday and verify it appears in the list.
  const holidayDate = "2026-12-31";
  await resilientGoto(page, "/admin/calendar?tab=holidays");
  await page.getByLabel("Date").fill(holidayDate);
  await page.getByLabel("Description").fill("New Year's Eve");
  await page.getByRole("button", { name: "Add holiday" }).click();
  await expect(page.getByText("New Year's Eve")).toBeVisible();

  // An incorrectly entered holiday can be removed. Holidays moved to a table
  // in Task 7.2, so the row is now a `<tr>`.
  const row = page.getByRole("row").filter({ hasText: "New Year's Eve" });
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("New Year's Eve")).toHaveCount(0);

  // Restore the setup by unchecking Saturday.
  await resilientGoto(page, "/admin/calendar");
  await page.getByRole("checkbox", { name: "Saturday" }).uncheck();
  await page.getByRole("button", { name: "Save calendar" }).click();
  await expect(page.getByText("Work calendar saved.")).toBeVisible();
});

test("a non-system-administrator cannot edit the calendar", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/admin/calendar");

  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  // The form must not render.
  await expect(page.getByRole("button", { name: "Save calendar" })).toHaveCount(0);
});

test("a manager marks a team member's leave and can cancel it with a reason", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/team/absence");

  await expect(
    page.getByRole("heading", { name: "Team leave" }),
  ).toBeVisible();

  await page.getByLabel("Person").selectOption({ label: E2E_WORKER.fullName });
  await page.getByLabel("Start").fill("2026-12-21");
  await page.getByLabel("End").fill("2026-12-25");
  await page.getByLabel("Note (optional)").fill("Annual leave");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(
    page.getByText("Saved. This person will not receive reminders on these dates").first(),
  ).toBeVisible();
  // Markers returned to the record list in Design Phase 6: the row is now a
  // `<li>` (a labeled record instead of a five-column table on narrow screens).
  const row = page.getByRole("listitem").filter({ hasText: "Annual leave" });
  await expect(row).toBeVisible();

  // The record is **not deleted**; it is cancelled with a reason (finding 7).
  await row.getByRole("button", { name: `${E2E_WORKER.fullName} Cancel` }).click();
  await row.getByLabel("Cancellation reason").fill("Entered by mistake");
  await row.getByRole("button", { name: "Cancel record" }).click();

  // The row remains in the list with its cancellation reason.
  const cancelledRow = page.getByRole("listitem").filter({ hasText: "Annual leave" });
  await expect(cancelledRow).toBeVisible();
  await expect(cancelledRow).toContainText("Entered by mistake");
  // A cancelled record cannot be cancelled a second time.
  await expect(
    cancelledRow.getByRole("button", { name: `${E2E_WORKER.fullName} Cancel` }),
  ).toHaveCount(0);
});

test("a user without a team cannot mark leave for anyone", async ({ page }) => {
  await loginAs(page, E2E_WORKER.email);
  await resilientGoto(page, "/team/absence");

  await expect(page.getByText("There are no users on your team")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
});
