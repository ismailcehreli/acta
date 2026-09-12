import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import {
  E2E_ADMIN,
  E2E_GM,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// Profile page (Task 9.4).
//
// Tree: Head Office → Mold Shop (test manager + Mold Shop Employee)
//                      → Planning (Planning manager)
//
// Test three properties: a user can reach their profile from the menu, a
// manager can see a subordinate's profile, and an out-of-scope manager cannot
// see it **even when they know the address**.

/** Enable or disable the unit flag required by the approval-flow test. */
async function setApprovalRequired(page: Page, enabled: boolean): Promise<void> {
  await resilientGoto(page, "/admin/org");
  const row = page.locator('[data-unit="Mold Shop"]');
  await row.getByRole("button", { name: "Edit" }).click();

  const form = row.locator("form[data-test^='organization-edit-']");
  const checkbox = form.getByRole("checkbox", {
    name: "Activities in this unit require approval",
  });
  if (enabled) await checkbox.check();
  else await checkbox.uncheck();
  await form.getByRole("button", { name: "Save changes" }).click();

  await resilientGoto(page, "/admin/org");
  const updatedRow = page.locator('[data-unit="Mold Shop"]');
  if (enabled) {
    await expect(updatedRow.locator('[data-test="approval-required"]')).toBeVisible();
  } else {
    await expect(updatedRow.locator('[data-test="approval-required"]')).toHaveCount(0);
  }
}

/** Sign in within a separate context without clearing its cookies. */
async function signInWithoutClearing(page: Page, email: string): Promise<void> {
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a user opens their own profile from the account menu", async ({ page }) => {
  await loginAs(page, E2E_WORKER.email);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My Profile" }).click();

  await expect(page).toHaveURL(/\/users\//);
  await expect(
    page.getByRole("heading", { name: E2E_WORKER.fullName }),
  ).toBeVisible();
  // Summary blocks use the user's own scope.
  await expect(page.getByText("Total", { exact: true })).toBeVisible();
});

test("a manager opens a subordinate's profile from an activity page", async ({ page }) => {
  await loginAs(page, E2E_WORKER.email);

  // The employee writes an activity.
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill("Profile test");
  await page.getByLabel("Description").fill("Example record for the profile page.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?record=added$/);

  // The manager opens the record from the scoped feed and clicks the author's
  // name.
  await loginAs(page, E2E_USER.email);
  await page.getByRole("link", { name: /Profile test/ }).first().click();
  await expect(page).toHaveURL(/\/activities\//);
  await page.getByRole("link", { name: E2E_WORKER.fullName }).click();

  await expect(
    page.getByRole("heading", { name: E2E_WORKER.fullName }),
  ).toBeVisible();
  // The subordinate's archive is visible to the manager.
  //
  // Scope the assertion to the link: after Next navigation, the page heading
  // is also written to a hidden route-announcement node for screen readers,
  // so a plain-text search found two results (2026-08-22, WebKit run).
  await expect(
    page.getByRole("link", { name: "Profile test" }).first(),
  ).toBeVisible();
});

test("an out-of-scope manager cannot open a profile even with its address", async ({ page }) => {
  // First obtain the address of the employee's own profile.
  await loginAs(page, E2E_WORKER.email);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My Profile" }).click();
  await expect(page).toHaveURL(/\/users\//);
  const profileUrl = page.url();

  // The Planning manager is on another branch; the employee is not their
  // subordinate.
  await loginAs(page, E2E_PLANNER.email);
  const response = await resilientGoto(page, profileUrl);

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: E2E_WORKER.fullName }),
  ).toHaveCount(0);
});


test("pending approvals never appear on a senior manager's profile", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Pending on profile ${suffix}`;

  const admin = await browser.newContext().then((context) => context.newPage());
  await signInWithoutClearing(admin, E2E_ADMIN.email);
  const employee = await browser.newContext().then((context) => context.newPage());
  await signInWithoutClearing(employee, E2E_WORKER.email);
  const generalManager = await browser.newContext().then((context) => context.newPage());
  await signInWithoutClearing(generalManager, E2E_GM.email);

  try {
    // Make Mold Shop require approval so the record remains pending.
    await setApprovalRequired(admin, true);

    await resilientGoto(employee, "/activities/new");
    await employee.getByLabel("Activity Title").fill(title);
    await employee.getByLabel("Description").fill("Record for the profile test.");
    await employee
      .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
      .check();
    await employee.getByRole("button", { name: "Submit" }).click();
    await expect(employee).toHaveURL(/\/activities\?/);

    // Obtain the employee's profile address.
    await employee.getByRole("button", { name: "Account menu" }).click();
    await employee.getByRole("menuitem", { name: "My Profile" }).click();
    await expect(employee).toHaveURL(/\/users\//);
    const profileUrl = employee.url();

    // §8.2: the senior chain sees only approved and cancelled records. The
    // pending record's title, status, and existence do not leak into the
    // profile archive.
    await resilientGoto(generalManager, profileUrl);
    await expect(
      generalManager.locator('[data-test="profile-activity"]').filter({ hasText: title }),
    ).toHaveCount(0);

    // It is absent from the feed as well; the filter remains available.
    await resilientGoto(generalManager, "/");
    await expect(generalManager.getByText(title)).toHaveCount(0);
  } finally {
    await setApprovalRequired(admin, false).catch(() => undefined);
    for (const page of [admin, employee, generalManager]) {
      await page.context().close();
    }
  }
});
