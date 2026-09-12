import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_PLANNER, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// §10: read status is collected automatically; the author sees who read the
// activity, while a manager cannot see what their team has read.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function writeActivity(page: Page, title: string): Promise<string> {
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill(`${title} description.`);
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const href = await page
    .locator('[data-test="activity-record"]')
    .filter({ hasText: title })
    .getByRole("link", { name: title, exact: false })
    .getAttribute("href");
  return href as string;
}

test("the author sees when a manager reads the activity", async ({ page, browser }) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `Read test ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  const detailUrl = await writeActivity(page, title);

  // The manager opens the detail page and stays on it.
  const readerContext = await browser.newContext();
  try {
    const readerPage = await readerContext.newPage();
    await loginAs(readerPage, E2E_USER.email);

    // The activity is initially unread on the home screen.
    const activityRow = readerPage
      .locator('[data-test="managed-area"] [data-test="feed-row"]')
      .filter({ hasText: title });
    await expect(activityRow).toHaveAttribute("data-read", "no");

    await resilientGoto(readerPage, detailUrl);
    // The dwell timer completes after two seconds (§10.2).
    await readerPage.waitForTimeout(3_000);
    await expect(readerPage.locator("#readers")).toContainText("You read this activity on");

    // Server Action refreshes must carry the updated state through client-side
    // navigation without a full page reload.
    await readerPage
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Dashboard", exact: true })
      .click();
    await expect(readerPage).toHaveURL(/\/$/);
    await expect(
      readerPage
        .locator('[data-test="managed-area"] [data-test="feed-row"]')
        .filter({ hasText: title }),
    ).toHaveAttribute("data-read", "yes");
  } finally {
    await readerContext.close();
  }

  // The author can see who read it.
  await resilientGoto(page, detailUrl);
  await expect(page.locator("#readers")).toContainText("Read by");
  await expect(page.locator("#readers")).toContainText(E2E_USER.fullName);
});

test("the unread activities queue opens the filtered feed", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `Unread queue test ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  await writeActivity(page, title);

  const managerContext = await browser.newContext();
  try {
    const managerPage = await managerContext.newPage();
    await loginAs(managerPage, E2E_USER.email);
    await resilientGoto(managerPage, "/");

    const queue = managerPage.locator('[data-test="unread-queue"]');
    await expect(queue).toBeVisible();
    await expect(
      managerPage
        .getByRole("navigation", { name: "Main menu" })
        .getByRole("link", { name: "Team Activities" }),
    ).toHaveAttribute("href", "/feed?period=all&unread=1");
    await queue
      .getByRole("link", { name: "View all unread activities" })
      .click();
    await expect(managerPage).toHaveURL(/\/feed\?period=all&unread=1/);
    await expect(
      managerPage.locator('[data-test="unread-filter"]'),
    ).toContainText("Only unread activities are shown.");

    const filteredRow = managerPage
      .locator('[data-test="feed-row"]')
      .filter({ hasText: title });
    await expect(filteredRow).toHaveAttribute("data-read", "no");
    await expect(
      filteredRow.locator("span.inline-flex").filter({ hasText: "Unread" }),
    ).toBeVisible();

    await managerPage
      .getByRole("link", { name: "Clear unread filter" })
      .click();
    await expect(managerPage).not.toHaveURL(/unread=1/);
  } finally {
    await managerContext.close();
  }
});

test("a person who cannot view an activity cannot view its read history", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `Read privacy ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  const detailUrl = await writeActivity(page, title);

  const peerContext = await browser.newContext();
  try {
    const peerPage = await peerContext.newPage();
    await loginAs(peerPage, E2E_PLANNER.email);
    const response = await resilientGoto(peerPage, detailUrl);

    expect(response?.status()).toBe(404);
    await expect(peerPage.locator("#readers")).toHaveCount(0);
  } finally {
    await peerContext.close();
  }
});
