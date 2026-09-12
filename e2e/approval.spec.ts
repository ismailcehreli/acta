import { resilientGoto } from "./navigation";
import { expect, test, type Browser, type Page } from "./test-base";

import {
  E2E_ADMIN,
  E2E_GM,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

const PNG_CONTENT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Approval workflow (§5.4, §8.2), included in Version 1 by product-owner
// decision.
//
// Tree: Head Office → Mold Shop (test manager + Mold Shop worker). The worker's
// approver is the test manager; the general manager is above that manager and
// must not see the record until approval is complete.

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function openAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, email);
  return page;
}

/** Enable or disable the approval requirement for Mold Shop. */
async function setApprovalRequired(page: Page, enabled: boolean): Promise<void> {
  await resilientGoto(page, "/admin/org");
  // Select by row name: a text filter also matches names in the "Move…" list
  // and used to open the wrong unit for editing.
  const row = page.locator('[data-unit="Mold Shop"]');
  await row.getByRole("button", { name: "Edit" }).click();

  const form = row.locator("form[data-test^='organization-edit-']");
  const checkbox = form.getByRole("checkbox", {
    name: "Activities in this unit require approval",
  });

  if (enabled) await checkbox.check();
  else await checkbox.uncheck();

  await form.getByRole("button", { name: "Save changes" }).click();

  // Verify the persisted state from the **badge**. Previously the test only
  // waited for the form to close and swallowed errors, so it continued even
  // when the flag was not saved and failed much later in an unrelated place.
  await resilientGoto(page, "/admin/org");
  const updatedRow = page.locator('[data-unit="Mold Shop"]');
  if (enabled) {
    await expect(updatedRow.locator('[data-test="approval-required"]')).toBeVisible();
  } else {
    await expect(updatedRow.locator('[data-test="approval-required"]')).toHaveCount(0);
  }
}

async function writeActivity(page: Page, title: string): Promise<void> {
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill(`${title} description.`);
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?/);
}

test("an activity requiring approval reaches its manager but not senior management", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Approval workflow ${suffix}`;

  const admin = await openAs(browser, E2E_ADMIN.email);
  const worker = await openAs(browser, E2E_WORKER.email);
  const manager = await openAs(browser, E2E_USER.email);
  const generalManager = await openAs(browser, E2E_GM.email);

  try {
    await setApprovalRequired(admin, true);

    await writeActivity(worker, title);

    // The author sees their own record and its status.
    await resilientGoto(worker, "/activities");
    const row = worker
      .locator('[data-test="activity-record"]')
      .filter({ hasText: title });
    await expect(row).toContainText("Pending Approval");

    // Before the approver reads the record, the author returns to the same
    // activity. Attachment upload through the real form is tested too.
    await expect(
      row.getByRole("link", { name: "Revise", exact: true }),
    ).toBeVisible();
    await row.getByRole("link", { name: "Revise", exact: true }).click();
    await expect(worker.getByRole("heading", { name: "Edit Activity" })).toBeVisible();
    await worker
      .getByLabel("Description")
      .fill("A photo was added before approval.");
    await worker.getByLabel("Attachments (optional)").setInputFiles({
      name: "before-approval-photo.png",
      mimeType: "image/png",
      buffer: PNG_CONTENT,
    });
    await expect(worker.locator('[data-test="attachment-count"]')).toContainText("1/5");
    await worker.getByRole("button", { name: "Save" }).click();
    await expect(worker).toHaveURL(/\/activities\?record=revised$/);

    // The manager's dashboard contains the approval item.
    await resilientGoto(manager, "/");
    const workQueue = manager.locator('[data-test="assigned-work"]');
    await expect(workQueue).toBeVisible();
    await expect(workQueue).toContainText(title);

    // The general manager cannot see it: unfiltered content does not flow
    // upward (§8.2).
    await resilientGoto(generalManager, "/");
    await expect(generalManager.getByText(title)).toHaveCount(0);
    await resilientGoto(generalManager, `/search?q=${encodeURIComponent(String(suffix))}`);
    await expect(generalManager.getByText(title)).toHaveCount(0);

    // The manager requests changes.
    await workQueue.getByRole("link", { name: title }).click();
    await expect(manager.locator('[data-test="approval-panel"]')).toBeVisible();
    await manager.getByRole("button", { name: "Request changes" }).click();
    const changesForm = manager.locator('[data-test="changes-form"]');
    // The reason is selected as a **category**; the description is optional
    // (product-owner decision, 2026-08-19).
    await changesForm
      .getByLabel("Reason for requesting changes")
      .selectOption({ index: 1 });
    await changesForm
      .getByLabel("Note (optional)")
      .fill("Please specify which molds were involved.");
    await changesForm.getByRole("button", { name: "Request changes" }).click();
    // `exact`: the card heading also contains a related phrase; this targets
    // the status badge.
    await expect(
      manager.getByRole("heading", { name: "Changes requested", exact: true }),
    ).toBeVisible();

    // The author sees the reason on their screen.
    await resilientGoto(worker, "/activities");
    await worker
      .locator('[data-test="activity-record"]')
      .filter({ hasText: title })
      .getByRole("link", { name: title })
      .click();
    const reason = worker.locator('[data-test="changes-requested-reason"]');
    await expect(reason).toContainText("Insufficient information");
    await expect(reason).toContainText("Please specify which molds were involved.");

    // The author revises and saves; the item returns to the manager.
    await reason.getByRole("link", { name: "Revise" }).click();
    await worker
      .getByLabel("Description")
      .fill("Early wear was found on mold number three.");
    await worker.getByRole("button", { name: "Save" }).click();
    await expect(worker).toHaveURL(/\/activities\?/);

    // The manager approves it.
    await resilientGoto(manager, "/");
    await manager
      .locator('[data-test="assigned-work"]')
      .getByRole("link", { name: title })
      .click();
    await manager.getByRole("button", { name: "Approve" }).click();
    await expect(manager.getByText("Awaiting approval")).toHaveCount(0);

    // The general manager can see it now.
    await resilientGoto(generalManager, `/search?q=${encodeURIComponent(String(suffix))}`);
    await expect(generalManager.getByText(title).first()).toBeVisible();
  } finally {
    // Restore the setup so later tests are not affected.
    await setApprovalRequired(admin, false).catch(() => undefined);
    for (const page of [admin, worker, manager, generalManager]) {
      await page.context().close();
    }
  }
});

test("a person who is not the approver cannot see the approval panel", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Hidden approval panel ${suffix}`;

  const admin = await openAs(browser, E2E_ADMIN.email);
  const worker = await openAs(browser, E2E_WORKER.email);
  const generalManager = await openAs(browser, E2E_GM.email);

  try {
    await setApprovalRequired(admin, true);
    await writeActivity(worker, title);

    // First verify that the setup actually worked: the record must be waiting
    // for approval. Without this assertion, the claims below could pass for
    // an already-approved record and prove nothing.
    await resilientGoto(worker, "/activities");
    const row = worker
      .locator('[data-test="activity-record"]')
      .filter({ hasText: title });
    await expect(row).toContainText("Pending Approval");

    // The author opens their own record; the panel is absent because they are
    // not the approver.
    await row.getByRole("link", { name: title }).click();
    await expect(worker.locator('[data-test="approval-panel"]')).toHaveCount(0);

    // Verify that the address is really the detail page: if the click had not
    // navigated, the 404 assertion below would inspect the list page and
    // misleadingly see a 200 response.
    await expect(worker).toHaveURL(/\/activities\/[0-9a-f-]{36}$/);
    const targetUrl = worker.url();

    // Even a direct request by the general manager cannot see the record.
    const response = await resilientGoto(generalManager, targetUrl);
    expect(response?.status()).toBe(404);
  } finally {
    await setApprovalRequired(admin, false).catch(() => undefined);
    for (const page of [admin, worker, generalManager]) {
      await page.context().close();
    }
  }
});
