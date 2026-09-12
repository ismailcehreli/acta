import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import {
  E2E_ADMIN,
  E2E_CHAIRMAN,
  E2E_GM,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// §13: the screen layout is the same at every level; only the scope expands.
// This file visits all three levels with real users and proves that the list is
// supplied by the visibility module.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string) {
  // Change levels on the same page; if an old session remains, /login redirects
  // to the dashboard and the form never appears.
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function writeActivity(page: Page, title: string) {
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill(`${title} for a description.`);
  // Use an exact match: organization tests running in parallel create and
  // deactivate units such as "Mold Shop 1234". A fuzzy match could select one
  // of them and make the record fail with an inactive-unit error.
  // A user's own unit gets the "(your unit)" suffix; this pattern includes it
  // while excluding test units such as "Mold Shop 1234".
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);
  // Prove that the record really exists; later steps depend on it.
  await expect(page.locator('[data-test="activity-record"]').filter({ hasText: title })).toBeVisible();
}

test("each level sees its own scope heading", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await expect(
    page.getByRole("heading", { name: "My department", exact: true }),
  ).toBeVisible();

  await loginAs(page, E2E_GM.email);
  await expect(
    page.getByRole("heading", { name: "My departments", exact: true }),
  ).toBeVisible();

  await loginAs(page, E2E_CHAIRMAN.email);
  await expect(
    page.getByRole("heading", { name: "Entire company", exact: true }),
  ).toBeVisible();
});

test("a user without subordinates does not see the scoped list", async ({ page }) => {
  await loginAs(page, E2E_WORKER.email);

  await expect(
    page.getByText(/Activities of others only appear/, { exact: false }),
  ).toBeVisible();
  // The key assertion: the scoped feed and its filters are not rendered.
  await expect(page.getByLabel("Person")).toHaveCount(0);
  await expect(page.getByLabel("Related department")).toHaveCount(0);
});

test("the scoped list is supplied by the visibility module", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const moldShopTitle = `Mold Shop activity ${suffix}`;
  const planningTitle = `Planning activity ${suffix}`;

  // A Mold Shop employee and a Planning manager each write an activity.
  await loginAs(page, E2E_WORKER.email);
  await writeActivity(page, moldShopTitle);

  const planningContext = await browser.newContext();
  try {
    const planningPage = await planningContext.newPage();
    await loginAs(planningPage, E2E_PLANNER.email);
    await writeActivity(planningPage, planningTitle);
  } finally {
    await planningContext.close();
  }

  // The Mold Shop manager sees only their own department.
  await loginAs(page, E2E_USER.email);
  await expect(page.getByText(moldShopTitle).first()).toBeVisible();
  await expect(page.getByText(planningTitle)).toHaveCount(0);

  // The general manager sees both departments.
  await loginAs(page, E2E_GM.email);
  await expect(page.getByText(moldShopTitle).first()).toBeVisible();
  await expect(page.getByText(planningTitle).first()).toBeVisible();

  // The system administrator is not above anyone in the tree and sees neither.
  await loginAs(page, E2E_ADMIN.email);
  await expect(page.getByText(moldShopTitle)).toHaveCount(0);
  await expect(page.getByText(planningTitle)).toHaveCount(0);
});

// Filters moved to the feed page on 2026-08-20; the dashboard is now a summary.
test("filters narrow the list on the feed page", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `Filter test ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  await writeActivity(page, title);

  await loginAs(page, E2E_GM.email);
  await resilientGoto(page, "/feed");
  await expect(page.getByText(title)).toBeVisible();

  // Filter for the Planning manager; the Mold Shop employee's record should
  // disappear.
  await page.getByLabel("Person").selectOption({ label: E2E_PLANNER.fullName });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(title)).toHaveCount(0);

  // The person filter cannot escape the scope; its options contain only people
  // in that scope.
  await expect(page.getByLabel("Person")).not.toContainText(E2E_ADMIN.fullName);
});

test("only the system administrator sees the operations block", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);

  // The operations block covers §12.4: if the scheduler stops, the system must
  // not appear healthy. Scope the assertions to the block because the
  // administration navigation also contains "Scheduled jobs".
  const operationsBlock = page.locator('[data-test="system-status"]');
  await expect(page.getByRole("heading", { name: "System status" })).toBeVisible();
  await expect(operationsBlock.getByText("Scheduled job", { exact: true })).toBeVisible();
  await expect(operationsBlock.getByText("Latest backup")).toBeVisible();

  // The block carries no activity content (§15.1), only counts and status.
  await expect(
    page.getByText("Visible only to system administrators", { exact: false }),
  ).toBeVisible();

  await loginAs(page, E2E_USER.email);
  await expect(page.getByRole("heading", { name: "System status" })).toHaveCount(0);
});

test("the team participation block is hidden by default", async ({ page }) => {
  await loginAs(page, E2E_GM.email);

  // §12.1: the participation summary is **disabled** by default; forcing it
  // into the visibility scope could create empty activity entries.
  await expect(page.getByRole("heading", { name: "Team participation" })).toHaveCount(0);
});

test("navigation changes according to the user's level", async ({ page }) => {
  const menu = page.getByRole("navigation", { name: "Main menu" });

  // System administration is a separate, explicit "workspace" group in the main
  // navigation; system operations are not mixed with activity content.
  await loginAs(page, E2E_ADMIN.email);
  await expect(menu.getByText("System Administration", { exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "User Management" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Audit Logs" })).toBeVisible();

  // For non-administrators the administration group is not rendered, so a
  // hidden link cannot lead users to an unauthorized screen.
  await loginAs(page, E2E_WORKER.email);
  await expect(menu.getByText("System Administration", { exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Audit Logs" })).toHaveCount(0);
  // A user without subordinates also has no Team link.
  await expect(menu.getByRole("link", { name: "Team" })).toHaveCount(0);

  await loginAs(page, E2E_USER.email);
  await expect(menu.getByRole("link", { name: /^Team Activities/ })).toBeVisible();
});

test("a manager with multiple departments sees the department summary", async ({
  page,
}) => {
  // The general manager has Mold Shop and Planning below them (global setup).
  await loginAs(page, E2E_GM.email);

  const summary = page.locator('[data-test="department-summary"]');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Mold Shop");
  await expect(summary).toContainText("Planning");

  // Clicking a row opens the **feed page** narrowed to that department, with
  // the filter control synchronized with the address (2026-08-20).
  await summary.getByRole("link", { name: /Mold Shop/ }).click();
  await expect(page).toHaveURL(/\/feed\?.*authorOrgUnitId=/);
  await expect(page.getByLabel("Author's department")).not.toHaveValue("");
});

test("a manager with one department does not see the department summary", async ({ page }) => {
  // The test manager manages only Mold Shop; the block would duplicate the
  // feed.
  await loginAs(page, E2E_USER.email);

  await expect(page.locator('[data-test="department-summary"]')).toHaveCount(0);
});
