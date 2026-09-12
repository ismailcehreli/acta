import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Scores & recognition (Tasks 11.10 and 11.11).
//
// **Disabled by default.** Nothing should appear anywhere while disabled.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function setBooleanSetting(page: Page, label: string, enabled: boolean) {
  await resilientGoto(page, "/admin/settings/scoring");
  // Locate the checkbox by role: the description is part of its accessible name,
  // so `getByLabel` cannot use an exact match here.
  const checkbox = page.getByRole("checkbox", { name: new RegExp(label) });
  if (enabled) await checkbox.check();
  else await checkbox.uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/settings updated|no changes/i)).toBeVisible();
}

test("scores are hidden everywhere when scoring is disabled", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await setBooleanSetting(page, "Enable scoring", false);

  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/");

  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "Scores" })).toHaveCount(0);
});

test("team scores appear when scoring is enabled", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await setBooleanSetting(page, "Enable scoring", true);

  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/scores");

  await expect(page.getByRole("heading", { name: "Team scores" })).toBeVisible();
  // The list is within scope and includes someone from the manager's team.
  await expect(
    page.locator('[data-test="score-record"]').filter({ hasText: E2E_WORKER.fullName }),
  ).toBeVisible();
});

test("the profile shows the score breakdown", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My Profile" }).click();

  const scoreCard = page.locator('[data-test="score-card"]');
  await expect(scoreCard).toBeVisible();
  // Both the total and the breakdown are present so the test checks the right
  // decision dimensions.
  await expect(scoreCard.getByText("Reporting regularity")).toBeVisible();
  await expect(scoreCard.getByText("Follow-up discipline")).toBeVisible();
});

test("a person's score is not visible outside the viewer's scope", async ({ page }) => {
  // A score is an aggregate, so it could disclose an unseen record.
  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/scores");

  // The worker has no team scope: the list is empty even if the page is reachable.
  await expect(page.locator('[data-test="score-record"]')).toHaveCount(0);
});

test("appreciation is shown only to an authorized user", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await setBooleanSetting(page, "Enable appreciations", true);

  // The Mold Shop manager cannot give appreciation, so the button must not appear.
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/feed?period=all");
  const firstActivity = page.locator('a[href^="/activities/"]').first();
  if (await firstActivity.count()) {
    await firstActivity.click();
    await expect(page.getByRole("button", { name: /Appreciate/ })).toHaveCount(0);
  }
});

test("the ranking link is absent when disabled and works when enabled", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await setBooleanSetting(page, "Enable ranking tab", false);

  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/scores");
  await expect(page.getByRole("link", { name: /sort/i })).toHaveCount(0);

  await signIn(page, E2E_ADMIN.email);
  await setBooleanSetting(page, "Enable ranking tab", true);

  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/scores");

  // The default is **alphabetical**; sorting by score is one click away.
  const sortByScore = page.getByRole("link", { name: "Sort by score" });
  await expect(sortByScore).toBeVisible();
  await sortByScore.click();
  await expect(page).toHaveURL(/ranking=score/);
  await expect(page.getByRole("link", { name: "Sort alphabetically" })).toBeVisible();
});

// Weights are **settings** (audit 2026-08-23, finding 8): changing the formula
// should not require a deployment. This test verifies end to end that the panel
// is read and applied—the values saved in the UI affect the calculation.
async function writeWeights(page: Page, values: Record<string, string>) {
  await resilientGoto(page, "/admin/settings/scoring");
  for (const [name, value] of Object.entries(values)) {
    await page.locator(`input[name="${name}"]`).fill(value);
  }
  await page.getByRole("button", { name: "Save settings" }).click();
}

test("a weight combination that does not total 100 is rejected", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);

  await writeWeights(page, { scoring_weight_regularity: "70" });

  // The server rejects it and explains the reason using the profile's label.
  await expect(page.getByText(/sum of weights.*equal 100/i)).toBeVisible();

  // Nothing should have been written: mixing new and old values would produce a
  // score whose profile weights do not total 100.
  await resilientGoto(page, "/admin/settings/scoring");
  await expect(page.locator('input[name="scoring_weight_regularity"]')).toHaveValue("60");
});

test("changing weights in the panel changes the score breakdown", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await writeWeights(page, {
    scoring_weight_regularity: "60",
    scoring_weight_acceptance: "30",
    scoring_weight_approval: "30",
    scoring_weight_follow_up: "10",
  });

  // The manager profile is independent of the unit's approval flag: managers
  // always use the manager profile, which includes **approval time**.
  await signIn(page, E2E_USER.email);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My Profile" }).click();
  const scoreCard = page.locator('[data-test="score-card"]');
  await expect(scoreCard.getByText("Approval time")).toBeVisible();

  // Approval time is set to zero; the total remains 100 (90 + 0 + 10).
  await signIn(page, E2E_ADMIN.email);
  await writeWeights(page, {
    scoring_weight_regularity: "90",
    scoring_weight_acceptance: "0",
    scoring_weight_approval: "0",
    scoring_weight_follow_up: "10",
  });
  await expect(page.getByText(/settings updated/i)).toBeVisible();

  // A dimension with zero weight **disappears** from the breakdown; its weight
  // was added to regularity.
  await signIn(page, E2E_USER.email);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My Profile" }).click();
  await expect(scoreCard.getByText("Approval time")).toHaveCount(0);
  await expect(scoreCard.getByText("Reporting regularity")).toBeVisible();

  // Restore the defaults so other tests are not affected.
  await signIn(page, E2E_ADMIN.email);
  await writeWeights(page, {
    scoring_weight_regularity: "60",
    scoring_weight_acceptance: "30",
    scoring_weight_approval: "30",
    scoring_weight_follow_up: "10",
  });
  await expect(page.getByText(/settings updated/i)).toBeVisible();
});
