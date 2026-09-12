import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_GM, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Dashboard counters (Task 11.2).
//
// All five counters open **their own list**. Three previously navigated to
// `/?period=…#scope`, which only scrolled the same page while the user expected
// a filtered list. Clicking a count must show the records behind that count.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("the dashboard preserves the order of work sections", async ({ page }) => {
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/");

  const blocks = page.locator(
    '[data-test="assigned-work"], [data-test="personal-overview"], [data-test="managed-area"]',
  );

  await expect(blocks).toHaveCount(3);
  await expect(blocks.nth(0)).toHaveAttribute("data-test", "assigned-work");
  await expect(blocks.nth(1)).toHaveAttribute("data-test", "personal-overview");
  await expect(blocks.nth(2)).toHaveAttribute("data-test", "managed-area");
});

/** Return a dashboard metric's link. */
function metric(page: Page, label: string | RegExp) {
  return page
    .getByRole("link")
    .filter({ has: page.getByText(label, { exact: false }) })
    .first();
}

/** Select the managed metric when it appears in both metric strips. */
function managedMetric(page: Page, label: string | RegExp) {
  return page
    .locator('[data-test="managed-area"]')
    .getByRole("link")
    .filter({ has: page.getByText(label, { exact: false }) })
    .first();
}

test("the personal activities counter opens the user's archive", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill("Counter test");
  await page.getByLabel("Description").fill("Written to test dashboard counter links.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?record=added$/);

  await resilientGoto(page, "/");
  await metric(page, /This week activities/).click();

  // It does not open the management feed; it opens the personal archive with
  // the selected period.
  await expect(page).toHaveURL(/\/activities\?.*period=/);
  await expect(page.getByRole("heading", { name: "My Activities" })).toBeVisible();
});

test("the open follow-up counter opens the follow-up list", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/");

  await metric(page, "Open follow-up").click();
  await expect(page).toHaveURL(/\/follow-ups/);
});

test("a zero counter is still clickable and explains the empty state", async ({ page }) => {
  // Zero values used to have no link. An empty list is honest: it shows the
  // user where they are and how to broaden the filter.
  //
  // Read the counter value before making any claim: another parallel spec may
  // request changes, so assuming that it is zero could be wrong. The test is
  // about zero still having a link, not about the value itself.
  //
  // Use a manager account; the managed feed is rendered only for users with a
  // management scope.
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/");

  const changesRequested = managedMetric(page, "Changes requested");
  await expect(changesRequested).toBeVisible();
  const value = (await changesRequested.locator("dd").innerText()).trim();

  await changesRequested.click();
  await expect(page).toHaveURL(/\/feed\?.*status=changesRequested/);
  await expect(page.getByText("Only Changes requested are shown.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Clear filter" }),
  ).toBeVisible();

  if (value === "0") {
    // The reason for the empty state is explicit: the status filter, not the
    // period, produced the empty result.
    await expect(
      page.getByRole("heading", { name: /There are no Changes requested records/ }),
    ).toBeVisible();
  }
});

test("the clear-filter link actually removes the filter", async ({ page }) => {
  // The link used to preserve the narrowing query, so clicking it changed
  // nothing.
  await signIn(page, E2E_USER.email);

  await resilientGoto(page, "/feed?period=all&status=approval");
  const filterNotice = page.getByText("Only Awaiting approval are shown.");
  await expect(filterNotice).toBeVisible();

  await filterNotice.locator("..").getByRole("link", { name: "Clear filter" }).click();

  await expect(page).not.toHaveURL(/status=approval/);
  await expect(filterNotice).toHaveCount(0);
});

test("the pending-answer counter opens records with incoming questions", async ({ page }) => {
  const withQuestion = `Question pending ${String(Date.now()).slice(-6)}`;
  const withoutQuestion = `No question ${String(Date.now()).slice(-6)}`;

  await signIn(page, E2E_WORKER.email);
  for (const title of [withQuestion, withoutQuestion]) {
    await resilientGoto(page, "/activities/new");
    await page.getByLabel("Activity Title").fill(title);
    await page.getByLabel("Description").fill(`${title} description.`);
    await page.getByRole("checkbox", { name: /Company/ }).first().check();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page).toHaveURL(/\/activities\?record=added$/);
  }

  // The general manager asks a question on only one record. A manager's own
  // question must not appear in the pending-answer counter; the counter must
  // represent an incoming question from another person.
  await signIn(page, E2E_GM.email);
  await resilientGoto(page, "/feed?period=all");
  await page
    .locator("a")
    .filter({ hasText: withQuestion })
    .first()
    .click();
  await page.getByLabel("Ask a Question").fill("When will this work be finished?");
  await page.getByRole("button", { name: "Submit question" }).click();
  await expect(page.getByText("When will this work be finished?")).toBeVisible();

  // The list opened from the counter contains only the activity with an
  // incoming question from someone else.
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/");
  const pendingAnswers = managedMetric(page, "Awaiting Answer");
  await expect(pendingAnswers.locator("dd")).toHaveText("1");
  await pendingAnswers.click();
  await expect(page).toHaveURL(/\/feed\?.*period=all.*status=questions/);
  await expect(page.getByText(withQuestion)).toBeVisible();
  await expect(page.getByText(withoutQuestion)).toHaveCount(0);
});
