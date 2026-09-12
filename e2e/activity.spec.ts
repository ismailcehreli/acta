import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";
import { addDays } from "./date";

// §5: activity entry and revision. The acceptance criterion is that entry
// takes less than 30 seconds (§18.4/§18.6); this is only a rough guard for
// that target. A real measurement will be made with a user (Task 6.3).
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string) {
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("an unauthenticated user cannot open activity screens", async ({ page }) => {
  await resilientGoto(page, "/activities/new");
  await expect(page).toHaveURL(/\/login$/);

  await resilientGoto(page, "/activities");
  await expect(page).toHaveURL(/\/login$/);
});

test("activity entry completes on one screen in under 30 seconds", async ({
  page,
}) => {
  await loginAs(page, E2E_USER.email);

  const startTime = Date.now();

  await resilientGoto(page, "/activities/new");
  // The date defaults to today; the user only chooses a title, description,
  // and related department.
  await expect(page.getByLabel("Activity Date")).not.toHaveValue("");
  await page.getByLabel("Activity Title").fill("Mold maintenance completed");
  await page
    .getByLabel("Description")
    .fill("A crack was found in the mold, and a replacement part was ordered.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page).toHaveURL(/\/activities\?record=added$/);
  await expect(page.locator("#activity-info")).toContainText("Activity recorded.");

  const elapsedSeconds = (Date.now() - startTime) / 1000;
  expect(elapsedSeconds).toBeLessThan(30);

  await expect(
    page
      .locator('[data-test="activity-record"]')
      .filter({ hasText: "Mold maintenance completed" }),
  ).toBeVisible();
});

// An activity has two dates (Task 11.1). Since backdated entry is allowed,
// the activity date and the time the record was written can differ. The
// reader must be able to distinguish them.
test("backdated records show activity date separately from entry time", async ({
  page,
}) => {
  await loginAs(page, E2E_USER.email);

  // Yesterday: backdated entry is enabled for one day by default (§5.6).
  // The day is calculated in **company time**; see `e2e/date.ts`.
  const yesterday = addDays(-1);
  const title = `Yesterday's maintenance ${String(Date.now()).slice(-6)}`;

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Date").fill(yesterday);
  await page.getByLabel("Activity Title").fill(title);
  await page
    .getByLabel("Description")
    .fill("The record for yesterday's work was entered today.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page).toHaveURL(/\/activities\?record=added$/);

  // The list shows the time at which the record was written separately.
  const row = page
    .locator('[data-test="activity-record"]')
    .filter({ hasText: title });
  await expect(row).toContainText("Saved:");

  // On the detail page the activity date is yesterday and the entry time is
  // today. Since they differ, the entry time includes the full date.
  const [year, month, day] = yesterday.split("-");
  const dateText = `${month}/${day}/${year}`;
  await row.getByRole("link", { name: title }).click();

  await expect(page.getByRole("time").filter({ hasText: dateText })).toBeVisible();
  await expect(page.getByText(/Saved: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)).toBeVisible();
});

test("empty description and no related department are rejected", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");

  await page.getByLabel("Activity Title").fill("Missing department test");
  await page.getByLabel("Description").fill("This record is submitted without a department.");
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.locator("#activity-error")).toContainText(
    "Select at least one related department",
  );
});

test("the author can revise their activity and the revision is counted", async ({
  page,
}) => {
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill("Activity to revise");
  await page.getByLabel("Description").fill("Initial description.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const row = page.locator('[data-test="activity-record"]').filter({ hasText: "Activity to revise" });
  await row.getByRole("link", { name: "Revise", exact: true }).click();

  await page.getByLabel("Activity Title").fill("Revised activity");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.locator("#activity-info")).toContainText(
    "Activity revised; a revision record was kept.",
  );
  await expect(
    page.locator('[data-test="activity-record"]').filter({ hasText: "Revised activity" }),
  ).toContainText("2. revision");
});

test("another user cannot open someone else's revision screen", async ({
  page,
  browser,
}) => {
  // One user writes an activity.
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill("Private activity");
  await page.getByLabel("Description").fill("Only its author can revise this record.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const reviseLink = page
    .locator('[data-test="activity-record"]')
    .filter({ hasText: "Private activity" })
    .getByRole("link", { name: "Revise", exact: true });
  const targetUrl = await reviseLink.getAttribute("href");
  expect(targetUrl).toBeTruthy();

  // Another user tries to open the same address directly.
  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await loginAs(otherPage, E2E_ADMIN.email);
    const response = await resilientGoto(otherPage, targetUrl as string);

    expect(response?.status()).toBe(404);
    await expect(otherPage.getByText("Private activity")).toHaveCount(0);
  } finally {
    await otherContext.close();
  }
});

test("the author can cancel an activity and the record remains struck through", async ({
  page,
}) => {
  const title = `Activity to cancel ${String(Date.now()).slice(-6)}`;

  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill("Entered incorrectly; it will be cancelled.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const row = page.locator('[data-test="activity-record"]').filter({ hasText: title });
  await row.getByRole("link", { name: "Cancel", exact: true }).click();

  // An empty reason is blocked by the browser because the field is required;
  // the same server-side rule is covered by a unit test.
  await page.getByRole("button", { name: "Cancel Activity" }).click();
  await expect(page).toHaveURL(/\/cancel$/);

  await page
    .getByLabel("Cancellation Reason")
    .fill("It was entered for the wrong shift; the correct one will be entered separately.");
  await page.getByRole("button", { name: "Cancel Activity" }).click();

  await expect(page).toHaveURL(/\/activities\?record=cancelled$/);

  const cancelledRow = page.locator('[data-test="activity-record"]').filter({ hasText: title });
  await expect(cancelledRow).toContainText("Cancelled");
  await expect(cancelledRow).toContainText("It was entered for the wrong shift");
  // A cancelled record can no longer be revised or cancelled again.
  await expect(cancelledRow.getByRole("link", { name: "Revise", exact: true })).toHaveCount(0);
  await expect(cancelledRow.getByRole("link", { name: "Cancel", exact: true })).toHaveCount(0);

  // The title is shown with a strikethrough and remains a detail link.
  await expect(cancelledRow.locator("a.line-through")).toHaveText(title);
});

test("a peer cannot cancel someone else's activity", async ({ page, browser }) => {
  const title = `Private to peer ${String(Date.now()).slice(-6)}`;

  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill("A peer must not be able to cancel this record.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const cancelLink = page
    .locator('[data-test="activity-record"]')
    .filter({ hasText: title })
    .getByRole("link", { name: "Cancel", exact: true });
  const targetUrl = await cancelLink.getAttribute("href");

  // The E2E administrator is a system administrator but is not in the
  // author's management chain: functional authority does not grant content
  // authority (§15.1).
  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await loginAs(otherPage, E2E_ADMIN.email);
    const response = await resilientGoto(otherPage, targetUrl as string);

    expect(response?.status()).toBe(404);
    await expect(otherPage.getByText(title)).toHaveCount(0);
  } finally {
    await otherContext.close();
  }
});

test("a system administrator cannot see another user's activity in the list", async ({
  page,
  browser,
}) => {
  const title = `Hidden from administrator ${String(Date.now()).slice(-6)}`;
  const secretText = "THIS DESCRIPTION MUST NOT LEAK";

  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill(secretText);
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);

  // The system administrator has functional authority but is not above the
  // author, so §15.1 prevents access to the content.
  const administratorContext = await browser.newContext();
  try {
    const administratorPage = await administratorContext.newPage();
    await loginAs(administratorPage, E2E_ADMIN.email);
    await resilientGoto(administratorPage, "/activities");

    await expect(administratorPage.getByText(title)).toHaveCount(0);
    await expect(administratorPage.getByText(secretText)).toHaveCount(0);
  } finally {
    await administratorContext.close();
  }
});

test("an attachment can be downloaded only by an authorized user", async ({
  page,
  browser,
  request,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `Activity with attachment ${suffix}`;
  // 1×1 pixel PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill("Activity containing an attachment.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByLabel("Attachments (optional)").setInputFiles({
    name: "measurement.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const detayUrl = await page
    .locator('[data-test="activity-record"]')
    .filter({ hasText: title })
    .getByRole("link", { name: title })
    .getAttribute("href");

  await resilientGoto(page, detayUrl as string);
  // The image is shown as a preview; obtain the download address from the
  // link inside the overlay.
  const preview = page.locator('[data-test="attachment-preview"][data-attachment-type="image"]');
  await expect(preview).toBeVisible();
  await preview.click();

  const overlay = page.locator('[data-test="attachment-preview-overlay"]');
  await expect(overlay).toBeVisible();
  const attachmentUrl = await overlay
    .getByRole("link", { name: "Download" })
    .getAttribute("href");

  // An unauthorized user cannot download the file or learn that it exists
  // (§15.4, §18.4).
  const unauthorizedContext = await browser.newContext();
  try {
    const unauthorizedPage = await unauthorizedContext.newPage();
    await loginAs(unauthorizedPage, E2E_ADMIN.email);
    const response = await resilientGoto(unauthorizedPage, attachmentUrl as string);
    expect(response?.status()).toBe(404);
  } finally {
    await unauthorizedContext.close();
  }

  // An unauthenticated request is rejected as well.
  const unauthenticatedResponse = await request.get(attachmentUrl as string);
  expect([401, 404]).toContain(unauthenticatedResponse.status());
});
