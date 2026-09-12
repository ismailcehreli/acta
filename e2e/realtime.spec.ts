import { resilientGoto } from "./navigation";
import { expect, test, type Browser, type Page } from "./test-base";

import { E2E_GM, E2E_USER, e2ePassword } from "./global-setup";

// Real-time updates (Task 7.3).
//
// The required evidence is a screen change **without any reload**. The tests
// open each page once, never call `page.reload()`, and wait for the expected
// content to arrive on its own. A reload would verify only reloading, not
// real-time behavior.

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Separate browser context: two people remain open at the same time. */
async function openAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, email);
  return page;
}

async function writeActivity(page: Page, title: string): Promise<string> {
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill(`${title} description.`);
  // The relevant department is required; the form cannot be submitted without it.
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  // Saving returns to `/activities?record=added`. A loose pattern
  // (`/activities`) also matches the form page and started searching for the
  // row before navigation had completed.
  await expect(page).toHaveURL(/\/activities\?/);

  const link = page
    .locator('[data-test="activity-record"]')
    .filter({ hasText: title })
    .getByRole("link", { name: title, exact: false });
  return (await link.getAttribute("href")) as string;
}

test("the event stream cannot be opened without authentication", async ({ page }) => {
  await page.context().clearCookies();
  const response = await page.request.get("/api/events");

  expect(response.status()).toBe(401);
});

test("a question reaches the author's home screen without a reload", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Live stream ${suffix}`;

  const author = await openAs(browser, E2E_USER.email);
  const asker = await openAs(browser, E2E_GM.email);

  try {
    const detailUrl = await writeActivity(author, title);

    // Verify that the stream is actually established; otherwise the question
    // test would fail for the wrong reason. SSE never finishes and does not
    // appear in `performance` entries, so wait for its response headers.
    const streamReady = author.waitForResponse(
      (r) => r.url().includes("/api/events"),
      { timeout: 20_000 },
    );

    // The author waits on the home screen. **This record** is not in the queue yet.
    //
    // We do not claim the queue is completely empty: other tests may leave work
    // there, which should not make this test fail for an unrelated reason.
    await resilientGoto(author, "/");
    const assignedWorkBefore = author.locator('[data-test="assigned-work"]');
    await expect(
      author.getByRole("heading", { name: "Assigned to me" }),
    ).toBeVisible();
    await expect(assignedWorkBefore.getByText(title)).toHaveCount(0);

    const streamResponse = await streamReady;
    expect(streamResponse.status()).toBe(200);

    // The other person asks the question.
    await resilientGoto(asker, detailUrl);
    await asker.getByLabel("Ask a Question").fill("What was done in this mold?");
    await asker.getByRole("button", { name: "Submit question" }).click();
    await expect(asker.getByText("What was done in this mold?")).toBeVisible();

    // The author's screen changes **on its own**: no reload and no click.
    //
    // Scope the assertion to "Tasks Assigned to Me": the same title also appears
    // in the scope feed, so a page-wide assertion found two matches.
    const assignedWork = author.locator('[data-test="assigned-work"]');
    await expect(assignedWork.getByText(title)).toBeVisible({ timeout: 30_000 });
    // The queue also states what needs to be done.
    await expect(
      assignedWork
        .locator('[data-test="work-item"][data-type="answer"]')
        .filter({ hasText: title }),
    ).toBeVisible();
  } finally {
    await author.context().close();
    await asker.context().close();
  }
});

test("refresh is deferred while a user is typing and their text is preserved", async ({
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `While typing ${suffix}`;

  const author = await openAs(browser, E2E_USER.email);
  const asker = await openAs(browser, E2E_GM.email);

  try {
    const detailUrl = await writeActivity(author, title);

    const openedResponse = await resilientGoto(asker, detailUrl);
    expect(openedResponse?.status()).toBe(200);
    await asker.getByLabel("Ask a Question").fill("First question.");
    await asker.getByRole("button", { name: "Submit question" }).click();
    await expect(asker.getByText("First question.")).toBeVisible();

    // The author starts typing an answer and keeps the field focused.
    await resilientGoto(author, detailUrl);
    const answerField = author.getByPlaceholder("Write your answer");
    await answerField.click();
    await answerField.fill("My partially completed answer");

    // A second event occurs while the asker closes the conversation.
    await asker.getByRole("button", { name: "Close conversation" }).click();
    await expect(asker.getByText("Closed", { exact: true })).toBeVisible();

    // Because the author's field is focused, the refresh is deferred and the
    // text remains in place.
    await author.waitForTimeout(3_000);
    await expect(answerField).toHaveValue("My partially completed answer");
  } finally {
    await author.context().close();
    await asker.context().close();
  }
});
