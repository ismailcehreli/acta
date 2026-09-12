import { resilientGoto } from "./navigation";
import { expect, test, type Browser, type Page } from "./test-base";

import { E2E_ADMIN, E2E_GM, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Rejection (product-owner decision, 2026-08-19).
//
// The manager's third option: close a record when revision would not resolve
// the problem. A rejected record is **not deleted** and does not move upward.

test.describe.configure({ mode: "serial" });

async function openAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

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
  const current = page.locator('[data-unit="Mold Shop"]');
  if (enabled) {
    await expect(current.locator('[data-test="approval-required"]')).toBeVisible();
  } else {
    await expect(current.locator('[data-test="approval-required"]')).toHaveCount(0);
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

test("a manager rejects a record; it closes, does not move upward, and cannot be revised", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Rejected record ${suffix}`;

  const admin = await openAs(browser, E2E_ADMIN.email);
  const worker = await openAs(browser, E2E_WORKER.email);
  const manager = await openAs(browser, E2E_USER.email);
  const generalManager = await openAs(browser, E2E_GM.email);

  try {
    await setApprovalRequired(admin, true);
    await writeActivity(worker, title);

    // The manager opens and rejects the record.
    await resilientGoto(manager, "/");
    const assignedWork = manager.locator('[data-test="assigned-work"]');
    await expect(assignedWork).toContainText(title);
    await assignedWork.getByRole("link", { name: title }).click();

    await manager.getByRole("button", { name: "Reject" }).click();
    const rejectionForm = manager.locator('[data-test="reject-form"]');
    await rejectionForm
      .getByLabel("Reason for rejection")
      .selectOption({ label: "Duplicate record" });
    await rejectionForm
      .getByLabel("Note (optional)")
      .fill("The same activity was entered yesterday.");
    await rejectionForm.getByRole("button", { name: "Reject" }).click();

    await expect(
      manager.getByRole("heading", { name: "Rejected", exact: true }),
    ).toBeVisible();

    // It leaves the approval queue. We do not expect the whole queue to vanish:
    // other tests may leave pending records there.
    await resilientGoto(manager, "/");
    await expect(
      manager.locator('[data-test="assigned-work"]').getByText(title),
    ).toHaveCount(0);

    // The author can see the reason.
    await resilientGoto(worker, "/activities");
    const activityRow = worker
      .locator('[data-test="activity-record"]')
      .filter({ hasText: title });
    await expect(activityRow).toContainText("Rejected");
    await activityRow.getByRole("link", { name: title }).click();
    const rejectionCard = worker.locator('[data-test="rejection-reason"]');
    await expect(rejectionCard).toContainText("Duplicate record");
    await expect(rejectionCard).toContainText("The same activity was entered yesterday.");
    const detailUrl = worker.url();

    // The general manager cannot see it: rejected content does not move upward.
    await resilientGoto(generalManager, `/search?q=${encodeURIComponent(String(suffix))}`);
    await expect(generalManager.getByText(title)).toHaveCount(0);
    const response = await resilientGoto(generalManager, detailUrl);
    expect(response?.status()).toBe(404);

    // The author cannot revise it: rejection is final. The old link does not
    // return 404; it explains why the record closed and how to return to it.
    const editResponse = await resilientGoto(worker, `${detailUrl}/edit`);
    expect(editResponse?.status()).toBe(200);
    await expect(
      worker.getByText(
        "A rejected activity cannot be revised. Write a new activity if necessary.",
      ),
    ).toBeVisible();
    await expect(
      worker.getByRole("link", { name: "Back", exact: true }),
    ).toBeVisible();
  } finally {
    await setApprovalRequired(admin, false).catch(() => undefined);
    for (const page of [admin, worker, manager, generalManager]) {
      await page.context().close();
    }
  }
});

test("a system administrator manages the reason catalog", async ({ browser }) => {
  const admin = await openAs(browser, E2E_ADMIN.email);
  const suffix = String(Date.now()).slice(-6);
  const reasonName = `Test reason ${suffix}`;

  try {
    await resilientGoto(admin, "/admin/approval-reasons");

    // The edit rows also contain a Reason name field, so scope the selectors to
    // the add form.
    const addForm = admin.locator('[data-test="reason-add"]');
    await addForm.getByLabel("Decision").selectOption("REJECTED");
    await addForm.getByLabel("Reason name").fill(reasonName);
    await addForm.getByRole("button", { name: "Add reason" }).click();
    await expect(admin.getByText(`Reason "${reasonName}" was added.`)).toBeVisible();

    // A deactivated reason disappears from decision forms but remains in the
    // catalog.
    const reasonRow = admin.locator(`[data-reason="${reasonName}"]`);
    await reasonRow.getByRole("button", { name: "Deactivate" }).click();
    await expect(
      admin.locator(`[data-reason="${reasonName}"]`).getByText(/inactive/i),
    ).toBeVisible();
  } finally {
    await admin.context().close();
  }
});
