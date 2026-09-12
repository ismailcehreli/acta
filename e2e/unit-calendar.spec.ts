import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// Unit-specific working windows (Task 11.9).

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function addUnit(
  page: Page,
  name: string,
  type: string,
  parent: string,
): Promise<void> {
  await resilientGoto(page, "/admin/org/new");
  await page.getByLabel("Unit name").fill(name);
  await page.getByLabel("Level", { exact: true }).fill(type);
  await page.getByLabel("Parent unit").selectOption({ label: parent });
  await page.getByRole("button", { name: "Add unit" }).click();
  await expect(page.locator("#organization-success")).toContainText(name);
  await resilientGoto(page, "/admin/org");
}

test("a system administrator defines a unit-specific working window", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/calendar?tab=units");

  await expect(
    page.getByRole("heading", { name: "Unit-specific working window" }),
  ).toBeVisible();

  // A unit without its own definition inherits and says so.
  await expect(page.getByText(/Inherited/).first()).toBeVisible();

  await page.getByLabel("Unit workday ends").fill("17:00");
  await page.getByLabel("Works on public holidays").check();
  await page.getByRole("button", { name: "Save calendar" }).click();

  await expect(page.getByText("The unit work window was saved.")).toBeVisible();
  // The selected unit now has its own definition.
  await expect(page.getByText("Own definition").first()).toBeVisible();
});

test("removing a unit definition makes it inherit again", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/calendar?tab=units");

  await page
    .getByLabel("Remove this unit's definition and inherit from its parent")
    .check();
  await page.getByRole("button", { name: "Save calendar" }).click();

  await expect(
    page.getByText("The unit now inherits its work window from its parent."),
  ).toBeVisible();
});

test("a department manager cannot edit the calendar", async ({ page }) => {
  // Product-owner decision (2026-08-21): calendar management belongs to system
  // administrators.
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/admin/calendar?tab=units");

  await expect(
    page.getByText(/Only system administrators can edit the work calendar/),
  ).toBeVisible();
});

// A unit move has an **easy-to-miss side effect** (audit 2026-08-23, finding 14;
// design Package H): moving a unit changes reminder times and score denominators
// for everyone in it. The UI used to move immediately after selecting a parent.
test("moving a unit with a different working window requires approval", async ({
  page,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const sourceUnit = `Early Shift ${suffix}`;
  const targetUnit = `Late Shift ${suffix}`;
  const movedUnit = `Moved Team ${suffix}`;

  await signIn(page, E2E_ADMIN.email);

  // Two parent units with different working windows.
  for (const name of [sourceUnit, targetUnit]) {
    await addUnit(page, name, "Department", "Company");
  }
  await addUnit(page, movedUnit, "Team", `— ${sourceUnit}`);

  // The source unit starts early and the target unit starts late.
  const setWorkWindow = async (unit: string, startTime: string) => {
    await resilientGoto(page, "/admin/calendar?tab=units");
    // Option labels include tree indentation ("— — Team"); select by value.
    const optionValue = await page
      .locator("#unit-calendar-unit option", { hasText: unit })
      .first()
      .getAttribute("value");
    await page.getByLabel("Unit", { exact: true }).selectOption(optionValue ?? "");
    await page.getByLabel("Unit workday starts").fill(startTime);
    await page.getByRole("button", { name: "Save calendar" }).click();
    await expect(
      page.getByText("The unit work window was saved."),
    ).toBeVisible();
  };

  await setWorkWindow(sourceUnit, "07:00");
  await setWorkWindow(targetUnit, "10:00");

  // Moving first shows a warning; the unit is not moved yet.
  await resilientGoto(page, "/admin/org");

  // **The parent-child relationship must change in the selector** (audit
  // 2026-08-24, P4-4). Indentation in the parent list encodes only depth; because
  // source and target have the same depth, checking indentation alone missed the
  // bug.
  const underSource = page.locator(
    `li[data-unit="${sourceUnit}"] li[data-unit="${movedUnit}"]`,
  );
  const underTarget = page.locator(
    `li[data-unit="${targetUnit}"] li[data-unit="${movedUnit}"]`,
  );

  await expect(underSource).toHaveCount(1);
  await expect(underTarget).toHaveCount(0);

  const row = page.locator(`li[data-unit="${movedUnit}"]`);
  await row.getByLabel(`New parent of ${movedUnit}`).selectOption({
    label: `— ${targetUnit}`,
  });
  await row.getByRole("button", { name: "Move", exact: true }).click();

  const warning = page.locator('[data-test="move-calendar-warning"]');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("07:00");
  await expect(warning).toContainText("10:00");

  // The warning appeared but the unit is **still** under the source: it was not
  // moved without approval.
  await expect(underSource).toHaveCount(1);
  await expect(underTarget).toHaveCount(0);

  // Confirmation completes the move and places the unit under the target.
  await warning.getByRole("button", { name: "Confirm move" }).click();

  await expect(underTarget).toHaveCount(1);
  await expect(underSource).toHaveCount(0);
});
