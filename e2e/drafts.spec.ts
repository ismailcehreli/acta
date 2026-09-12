import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_PLANNER, E2E_WORKER, e2ePassword } from "./global-setup";

const PNG_CONTENT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Drafts — unsubmitted records (2026-08-21).
//
// The two situations described by the product owner:
//
//   1. **Intentional pause** — "I wrote it, but I want one last review".
//   2. **Accidental remainder** — the window closed, so the text should not be lost.
//
// Both appear in the same list; the user submits or deletes them.
//
// The main security property is that a draft is **visible to nobody else**:
// until submission, it is not an activity and must not appear in a manager's
// feed.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

const DRAFT_TITLE = `Draft test ${String(Date.now()).slice(-6)}`;

test("a user saves a draft and sees it in the list", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(DRAFT_TITLE);
  await page
    .getByLabel("Description")
    .fill("It is not finished yet; I will verify the figures and submit it.");

  await page.getByRole("button", { name: "Save as draft" }).click();

  await expect(page).toHaveURL(/\/drafts\?record=draft$/);
  await expect(page.locator("#draft-message")).toContainText("Draft saved");

  const row = page
    .locator('[data-test="draft-record"]')
    .filter({ hasText: DRAFT_TITLE });
  await expect(row).toBeVisible();
  // An intentionally paused draft is distinguished from an accidental one by
  // its badge.
  await expect(row).toContainText("Waiting");

  // A draft is **not an activity** and must not appear in the activity list.
  await resilientGoto(page, "/activities");
  await expect(page.getByText(DRAFT_TITLE)).toHaveCount(0);
});

test("drafts remain visible in navigation with their count", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);

  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: /Drafts/ })).toBeVisible();
});

// The menu item used to appear only for users with a draft (`draftCount > 0`).
// The product owner requested that it always remain visible on 2026-08-21:
// a disappearing menu item does not teach users about the feature and makes
// them search for it after finishing a draft.
test("draft navigation remains visible for a user without drafts", async ({ page }) => {
  await signIn(page, E2E_PLANNER.email);

  // Prove the precondition: this user really has no drafts.
  await resilientGoto(page, "/drafts");
  await expect(page.locator('[data-test="draft-record"]')).toHaveCount(0);

  const menu = page.getByRole("navigation", { name: "Main menu" });
  const link = menu.getByRole("link", { name: /Drafts/ });
  await expect(link).toBeVisible();

  // A zero count is omitted: a badge draws attention when there is work, while
  // an empty badge does not.
  await expect(link).not.toContainText("0");
});

test("a draft is not visible to a manager", async ({ page }) => {
  // The Planning manager must not see the Mold Shop employee's draft anywhere.
  await signIn(page, E2E_PLANNER.email);

  await resilientGoto(page, "/feed?period=all");
  await expect(page.getByText(DRAFT_TITLE)).toHaveCount(0);

  await resilientGoto(page, "/search?q=Draft");
  await expect(page.getByText(DRAFT_TITLE)).toHaveCount(0);

  // The drafts page exists for everyone but shows only their own drafts.
  await resilientGoto(page, "/drafts");
  await expect(page.getByText(DRAFT_TITLE)).toHaveCount(0);
});

test("a draft can be continued and submitted as an activity", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);

  await resilientGoto(page, "/drafts");
  await page
    .locator('[data-test="draft-record"]')
    .filter({ hasText: DRAFT_TITLE })
    .getByRole("link", { name: "Continue" })
    .click();

  // The form opens with the draft's contents.
  await expect(page.getByRole("heading", { name: "Continue draft" })).toBeVisible();
  await expect(page.getByLabel("Activity Title")).toHaveValue(DRAFT_TITLE);

  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page).toHaveURL(/\/activities\?record=added$/);
  await expect(
    page.locator('[data-test="activity-record"]').filter({ hasText: DRAFT_TITLE }),
  ).toBeVisible();

  // A submitted draft leaves the list; otherwise it could be submitted twice.
  await resilientGoto(page, "/drafts");
  await expect(page.getByText(DRAFT_TITLE)).toHaveCount(0);
});

test("files selected in two separate steps are preserved in a draft", async ({ page }) => {
  const title = `Draft with files ${String(Date.now()).slice(-6)}`;
  await signIn(page, E2E_WORKER.email);

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill("The draft attachment must survive until submission.");

  const attachments = page.getByLabel("Attachments (optional)");
  await attachments.setInputFiles({
    name: "draft-first.png",
    mimeType: "image/png",
    buffer: PNG_CONTENT,
  });
  await attachments.setInputFiles({
    name: "draft-second.png",
    mimeType: "image/png",
    buffer: PNG_CONTENT,
  });
  await expect(page.locator('[data-test="attachment-count"]')).toContainText("2/5");

  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page).toHaveURL(/\/drafts\?record=draft$/);

  const row = page
    .locator('[data-test="draft-record"]')
    .filter({ hasText: title });
  await row.getByRole("link", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Continue draft" })).toBeVisible();
  await expect(page.locator('[data-test="attachment-count"]')).toContainText("2/5");
  await expect(page.locator('[data-test="attachment-list"]')).toContainText("draft-first.png");
  await expect(page.locator('[data-test="attachment-list"]')).toContainText("draft-second.png");

  // Do not leave an open draft behind; submission also proves through the real
  // form that draft attachments become activity attachments.
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?record=added$/);
  await expect(
    page.locator('[data-test="activity-record"]').filter({ hasText: title }),
  ).toBeVisible();
});

test("a draft is deleted in two steps", async ({ page }) => {
  const draftToDelete = `Draft to delete ${String(Date.now()).slice(-6)}`;
  await signIn(page, E2E_WORKER.email);

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(draftToDelete);
  await page.getByLabel("Description").fill("This record will not be submitted.");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page).toHaveURL(/\/drafts/);

  const row = page
    .locator('[data-test="draft-record"]')
    .filter({ hasText: draftToDelete });

  // A single click does not delete it; confirmation is required first.
  await row.getByRole("button", { name: `${draftToDelete}: Delete` }).click();
  await expect(row.getByText("Delete this draft?")).toBeVisible();

  // Cancelling the confirmation must really cancel it.
  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: `${draftToDelete}: Delete` }).click();
  await row.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.locator("#draft-message")).toContainText("Draft deleted.");
  await expect(page.getByText(draftToDelete)).toHaveCount(0);
});

test("text from a window closed during entry remains in drafts", async ({ page }) => {
  const accidentalDraft = `Accidental draft ${String(Date.now()).slice(-6)}`;
  await signIn(page, E2E_WORKER.email);

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(accidentalDraft);
  await page
    .getByLabel("Description")
    .fill("I was about to review the window, but I closed the tab.");

  // Autosave runs after typing stops and reports its state on screen.
  await expect(page.locator('[data-test="draft-status"]')).toContainText(
    "Draft saved",
    { timeout: 15000 },
  );

  // The user leaves without pressing anything.
  await resilientGoto(page, "/drafts");

  const row = page
    .locator('[data-test="draft-record"]')
    .filter({ hasText: accidentalDraft });
  await expect(row).toBeVisible();
  // Accidental drafts are distinguished from intentionally paused drafts.
  await expect(row).toContainText("Saved automatically");
});
