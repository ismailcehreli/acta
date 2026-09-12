import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// Organization-tree flow (§4) and authorization separation (§15.1). The tests
// share a database, so they run serially and each run uses unique unit names.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * A unit row in the tree.
 *
 * Filtering by text was fragile: each row contains a "new parent" select with
 * **all unit names**. A searched name could appear in another unit's options
 * and select the wrong row (failed in a parallel run on 2026-08-22). The tree
 * writes `data-unit` on every node; use that as the address.
 */
function unitRow(page: Page, name: string) {
  return page.locator(`li[data-unit="${name}"]`);
}

async function addUnit(
  page: Page,
  {
    name,
    type,
    parent,
    attentionGroup,
    requiresApproval = false,
  }: {
    name: string;
    type: string;
    parent: string;
    attentionGroup?: string;
    requiresApproval?: boolean;
  },
): Promise<void> {
  await resilientGoto(page, "/admin/org/new");
  await page.getByLabel("Unit name").fill(name);
  await page.getByLabel("Level", { exact: true }).fill(type);
  await page.getByLabel("Parent unit").selectOption({ label: parent });
  if (attentionGroup) {
    await page.getByLabel("Attention group (optional)").fill(attentionGroup);
  }
  if (requiresApproval) {
    await page
      .getByRole("checkbox", { name: "Activities in this unit require approval" })
      .check();
  }
  await page.getByRole("button", { name: "Add unit" }).click();
  await expect(page.locator("#organization-success")).toContainText(name);
  await resilientGoto(page, "/admin/org");
}

test("an unauthenticated user cannot enter organization management", async ({ page }) => {
  await resilientGoto(page, "/admin/org");

  await expect(page).toHaveURL(/\/login$/);
});

test("a non-system-administrator cannot see the organization tree", async ({
  page,
}) => {
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/admin/org");

  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  // The tree and editing tools must not render.
  await expect(
    page.getByRole("heading", { name: "Organization tree" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add unit" })).toHaveCount(0);
});

test("a system administrator adds, moves, and deactivates a unit", async ({
  page,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const department = `Mold Shop ${suffix}`;
  const childUnit = `Mold Maintenance ${suffix}`;

  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/org");
  await expect(
    page.getByRole("heading", { name: "Organization tree" }),
  ).toBeVisible();

  // The root unit was created during setup; add a new department below it.
  await addUnit(page, { name: department, type: "Department", parent: "Company" });
  // Verify that it appears in the tree, not only as an option in a select.
  await expect(
    unitRow(page, department),
  ).toBeVisible();

  // Add a child unit below the new department to prove the tree is real.
  await addUnit(page, {
    name: childUnit,
    type: "Team",
    parent: `— ${department}`,
  });
  await expect(page.getByRole("link", { name: "New unit" })).toBeVisible();

  // Deactivate the child unit; the record is retained with an "Inactive" badge.
  // Checking row text alone is misleading because the Deactivate button also
  // contains the word "inactive" and could make the test pass without acting.
  const childRow = unitRow(page, childUnit);
  await childRow.getByRole("button", { name: "Deactivate" }).click();

  const inactiveRow = unitRow(page, childUnit);
  await expect(inactiveRow.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(
    inactiveRow.getByRole("button", { name: "Deactivate" }),
  ).toHaveCount(0);

  // An inactive unit can be reactivated (product-owner decision, 2026-08-19).
  await inactiveRow.getByRole("button", { name: "Reactivate" }).click();

  const reactivatedRow = unitRow(page, childUnit);
  await expect(reactivatedRow.getByText("Inactive", { exact: true })).toHaveCount(0);
  await expect(
    reactivatedRow.getByRole("button", { name: "Deactivate" }),
  ).toBeVisible();

  // The operation appears in the audit trail and is found by its unit name.
  await resilientGoto(page, "/admin/audit?objectType=org_unit&action=org_unit_reactivated");
  await expect(
    page.locator('[data-test="audit-record"]').filter({ hasText: childUnit }),
  ).toContainText("unit reactivated");
});

test("a system administrator edits a unit's name, level, and flags", async ({
  page,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const oldName = `Wrong Name ${suffix}`;
  const newName = `Mold Shop ${suffix}`;

  await loginAs(page, E2E_ADMIN.email);
  await addUnit(page, { name: oldName, type: "Team", parent: "Company" });

  // The editing form opens below the row.
  const row = unitRow(page, oldName);
  await row.getByRole("button", { name: "Edit" }).click();

  const form = row.locator("form[data-test^='organization-edit-']");
  await expect(form).toBeVisible();

  await form.getByLabel("Unit name").fill(newName);
  // `exact` is required because "Level" also appears in the approval
  // checkbox's explanatory text.
  await form.getByLabel("Level", { exact: true }).fill("Department");
  await form.getByLabel("Attention group (optional)").fill("executive-board");
  await form
    .getByRole("checkbox", { name: "Activities in this unit require approval" })
    .check();
  await form.getByRole("button", { name: "Save changes" }).click();

  // The tree reflects the new name, level, and two badges.
  const updatedRow = unitRow(page, newName);
  await expect(updatedRow).toContainText("Department");
  await expect(updatedRow.locator('[data-test="approval-required"]')).toBeVisible();
  await expect(
    updatedRow.getByText("attention group: executive-board", { exact: true }),
  ).toBeVisible();
  // The old name must disappear; a "saved" message alone is not evidence.
  await expect(unitRow(page, oldName)).toHaveCount(0);

  // The edit appears in the audit trail (§15.2).
  //
  // Find the record by **its own name**, not `.first()`: other tests also edit
  // units and the newest record in the shared database need not belong to this
  // test. The `.first()` version inspected another test's record in parallel.
  await resilientGoto(page, "/admin/audit?objectType=org_unit&action=org_unit_updated");
  const record = page
    .locator('[data-test="audit-record"]')
    .filter({ hasText: newName });
  await expect(record).toContainText("unit updated");
  await expect(record).toContainText(E2E_ADMIN.fullName);
});

test("a unit with an active child unit cannot be deactivated", async ({ page }) => {
  const parentUnit = `Directorate ${String(Date.now()).slice(-6)}`;
  const childUnit = `Child ${String(Date.now()).slice(-6)}`;

  await loginAs(page, E2E_ADMIN.email);
  await addUnit(page, { name: parentUnit, type: "Directorate", parent: "Company" });
  await addUnit(page, {
    name: childUnit,
    type: "Department",
    parent: `— ${parentUnit}`,
  });

  const parentRow = unitRow(page, parentUnit);
  await parentRow.getByRole("button", { name: "Deactivate" }).first().click();

  await expect(page.getByText(/active child units/i)).toBeVisible();
});

// Audit Phase 2, finding 5: `attentionGroupId` existed in the schema but was
// never saved by the management screen. A unit test calling the service
// directly did not catch it. This follows the form → server action → database
// path.
test("an attention group is saved and preserved after reload", async ({
  page,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const unit = `Administration Board ${suffix}`;
  const group = `board-${suffix}`;

  await loginAs(page, E2E_ADMIN.email);
  await addUnit(page, {
    name: unit,
    type: "Board",
    parent: "Company",
    attentionGroup: group,
  });

  // The value must come from the database after a page reload.
  await page.reload();
  await expect(
    unitRow(page, unit),
  ).toContainText(`attention group: ${group}`);
});
