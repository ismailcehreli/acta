import { resilientGoto } from "./navigation";
import { expect, test, type Browser, type Page } from "./test-base";

import {
  E2E_ADMIN,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// Unified work queue (Task 10.5).
//
// Previously, "questions awaiting answers" and "approvals waiting for me" were
// separate boxes. The test verifies that three work types appear in **one list**
// and that every row states what to do and who it came from.

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

test("a user with no assigned work sees an empty queue", async ({ browser }) => {
  const page = await openAs(browser, E2E_PLANNER.email);

  try {
    const queue = page.locator('[data-test="assigned-work"]');
    await expect(queue).toContainText("You have no assigned work.");
  } finally {
    await page.context().close();
  }
});

test("approval and revision appear in the same queue for the correct person", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Queue test ${suffix}`;

  const admin = await openAs(browser, E2E_ADMIN.email);
  const worker = await openAs(browser, E2E_WORKER.email);
  const manager = await openAs(browser, E2E_USER.email);

  try {
    await setApprovalRequired(admin, true);

    await resilientGoto(worker, "/activities/new");
    await worker.getByLabel("Activity Title").fill(title);
    await worker.getByLabel("Description").fill("A record for the queue.");
    await worker.getByRole("button", { name: "Submit" }).click();
    await expect(worker).toHaveURL(/\/activities\?record=added$/);

    // The manager's queue contains an approval task.
    await resilientGoto(manager, "/");
    const managerQueue = manager.locator('[data-test="assigned-work"]');
    const approvalRow = managerQueue
      .locator('[data-test="work-item"][data-type="approve"]')
      .filter({ hasText: title });
    await expect(approvalRow).toBeVisible();
    await expect(approvalRow).toContainText("Approve");
    await expect(approvalRow).toContainText("submitted");

    // The worker's queue does **not** contain that item.
    await resilientGoto(worker, "/");
    await expect(
      worker.locator('[data-test="assigned-work"]').getByText(title),
    ).toHaveCount(0);

    // The manager requests changes.
    await approvalRow.getByRole("link", { name: title }).click();
    await manager.getByRole("button", { name: "Request changes" }).click();
    const form = manager.locator('[data-test="changes-form"]');
    await form
      .getByLabel("Reason for requesting changes")
      .selectOption({ label: "Insufficient information" });
    await form.getByRole("button", { name: "Request changes" }).click();
    await expect(
      manager.getByRole("heading", { name: "Changes requested", exact: true }),
    ).toBeVisible();

    // The turn moves to the author: it leaves the manager's queue and becomes a
    // revision task in the worker's queue.
    await resilientGoto(manager, "/");
    await expect(
      manager.locator('[data-test="assigned-work"]').getByText(title),
    ).toHaveCount(0);

    await resilientGoto(worker, "/");
    const revisionRow = worker
      .locator('[data-test="assigned-work"]')
      .locator('[data-test="work-item"][data-type="revise"]')
      .filter({ hasText: title });
    await expect(revisionRow).toBeVisible();
    await expect(revisionRow).toContainText("Revise");
    await expect(revisionRow).toContainText("requested changes");
  } finally {
    await setApprovalRequired(admin, false).catch(() => undefined);
    for (const page of [admin, worker, manager]) await page.context().close();
  }
});
