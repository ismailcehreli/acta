import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import {
  E2E_DYER,
  E2E_DYE_MANAGER,
  E2E_GM,
  E2E_PLANNER,
  E2E_USER,
  e2ePassword,
} from "./global-setup";
import { addDays } from "./date";

// Delegation — end to end (§4.5, product-owner decision 2026-08-21).
//
// The chain under test: a general manager enters leave for one department
// manager and delegates to another department manager; the deputy sees and
// approves that department's record, and the decision is recorded as "Y on
// behalf of X".
//
// **The main security property is scope isolation:** a deputy must never see a
// department for which they are not acting as deputy.
//
// The scenario uses **Paint Shop**, a unit that permanently requires approval
// and whose flag is not changed by any test (2026-08-21). Mold Shop was used
// previously and this spec changed its flag; when another spec ran at the same
// time and disabled it, the record was created without approval and the
// deputy's queue was empty. Each spec passed alone but the package failed — a
// classic sign of shared mutable state.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** A range covering today: the delegation must be active **now**. */
function todayRange(): { start: string; end: string } {
  // Days use **company time**; calculating in UTC shifted the range by one day
  // after midnight (see `e2e/date.ts`).
  return { start: addDays(-1), end: addDays(3) };
}

test("a deputy cannot be assigned for a non-manager", async ({ page }) => {
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/team/absence");

  const { start, end } = todayRange();

  // The Mold Shop manager tries to assign a deputy for their employee.
  await page.getByLabel("Person", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Start").fill(start);
  await page.getByLabel("End").fill(end);

  const deputyPicker = page.getByLabel("Deputy manager");
  const optionCount = await deputyPicker.locator("option").count();

  if (optionCount > 1) {
    await deputyPicker.selectOption({ index: 1 });
    await page.getByRole("button", { name: "Save" }).click();

    // Delegation is available only at manager level. Because this team has a
    // single subordinate, the selected deputy may be the person themselves;
    // whichever rule applies, it must be **rejected** with a visible reason.
    await expect(
      page.getByText(
        /only a unit manager|must be a unit manager|cannot be their own deputy/i,
      ),
    ).toBeVisible();
  }
});

test("a deputy can see and approve the delegated department's record", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Delegation test ${suffix}`;

  // Paint Shop permanently requires approval; no preparation step is needed.
  //
  // 1) The general manager enters leave for the Paint Shop manager and makes
  //    the Planning manager their deputy.
  const gm = await browser.newContext();
  try {
    const managerPage = await gm.newPage();
    await signIn(managerPage, E2E_GM.email);
    await resilientGoto(managerPage, "/team/absence");

    const { start, end } = todayRange();
    await managerPage
      .getByLabel("Person", { exact: true })
      .selectOption({ label: E2E_DYE_MANAGER.fullName });
    await managerPage.getByLabel("Start").fill(start);
    await managerPage.getByLabel("End").fill(end);
    await managerPage
      .getByLabel("Deputy manager")
      .selectOption({ label: E2E_PLANNER.fullName });
    await managerPage.getByRole("button", { name: "Save" }).click();

    await expect(managerPage.getByText("Saved. This person will not receive reminders on these dates", { exact: false })).toBeVisible();
  } finally {
    await gm.close();
  }

  // 2) A Paint Shop employee writes an activity; approval goes to the Paint
  //    Shop manager.
  const employeeContext = await browser.newContext();
  try {
    const employeePage = await employeeContext.newPage();
    await signIn(employeePage, E2E_DYER.email);
    await resilientGoto(employeePage, "/activities/new");
    await employeePage.getByLabel("Activity Title").fill(title);
    await employeePage.getByLabel("Description").fill("Written for the delegation test.");
    await employeePage.getByRole("checkbox", { name: /Company/ }).first().check();
    await employeePage.getByRole("button", { name: "Submit" }).click();
    await expect(employeePage).toHaveURL(/\/activities\?record=added$/);
  } finally {
    await employeeContext.close();
  }

  // 3) The Planning manager normally cannot see Paint Shop, but can see and
  //    approve the record during the delegation.
  const deputyContext = await browser.newContext();
  try {
    const deputyPage = await deputyContext.newPage();
    await signIn(deputyPage, E2E_PLANNER.email);

    await resilientGoto(deputyPage, "/deputy");
    await expect(deputyPage.locator('[data-test="active-delegation"]')).toBeVisible();
    await expect(deputyPage.locator('[data-test="active-delegation"]')).toContainText(
      E2E_DYE_MANAGER.fullName,
    );

    // The record must appear in the deputy's work queue.
    await resilientGoto(deputyPage, "/");
    const workQueue = deputyPage.locator('[data-test="assigned-work"]');
    await expect(workQueue.getByText(title)).toBeVisible();

    // The deputy makes the decision through the real detail-page flow.
    await workQueue.getByRole("link", { name: title }).click();
    await deputyPage.getByRole("button", { name: "Approve" }).click();
    await expect(deputyPage.locator('[data-test="approval-panel"]')).toHaveCount(0);

    // The decision should appear on the delegation page as "Y on behalf of X".
    await resilientGoto(deputyPage, "/deputy");
    const decision = deputyPage
      .locator('[data-test="delegation-decision"]')
      .filter({ hasText: title });
    await expect(decision).toBeVisible();
    await expect(decision).toContainText(`on behalf of ${E2E_DYE_MANAGER.fullName}`);
  } finally {
    await deputyContext.close();
  }

  // 4) The returning manager can see what happened during the absence.
  const returningManagerContext = await browser.newContext();
  try {
    const returningManagerPage = await returningManagerContext.newPage();
    await signIn(returningManagerPage, E2E_DYE_MANAGER.email);
    await resilientGoto(returningManagerPage, "/deputy");

    await expect(
      returningManagerPage.getByRole("heading", { name: "My deputies", exact: true }),
    ).toBeVisible();
    await expect(
      returningManagerPage
        .locator('[data-test="delegation-period"]')
        .filter({ hasText: E2E_PLANNER.fullName }),
    ).toBeVisible();
  } finally {
    await returningManagerContext.close();
  }
});

test("a person who is not a deputy cannot see the delegated scope", async ({ page }) => {
  // The Paint Shop employee is not a deputy; the delegation page must not even
  // link to the scope for them.
  await signIn(page, E2E_DYER.email);

  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: /Delegations/ })).toHaveCount(0);
});
