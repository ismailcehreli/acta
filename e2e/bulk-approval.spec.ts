import { resilientGoto } from "./navigation";
import { expect, test, type Browser, type Page } from "./test-base";

import {
  E2E_ADMIN,
  E2E_GM,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// Bulk approval grouped by person and day (Task 10.6).

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
  await page.getByLabel("Description").fill(`${title} for a description.`);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?record=added$/);
}

test("a person without approval work sees an empty screen", async ({ browser }) => {
  const page = await openAs(browser, E2E_PLANNER.email);

  try {
    await resilientGoto(page, "/approvals");
    await expect(page.getByRole("heading", { name: "No records are waiting for your approval." })).toBeVisible();
    // Another person's record must not leak.
    await expect(page.locator('[data-test="approval-group"]')).toHaveCount(0);
  } finally {
    await page.context().close();
  }
});

test("a manager approves one person's day in a single operation", async ({ browser }) => {
  test.setTimeout(150_000);
  const suffix = String(Date.now()).slice(-6);
  const firstTitle = `Bulk one ${suffix}`;
  const secondTitle = `Bulk two ${suffix}`;
  const thirdTitle = `Bulk three ${suffix}`;

  const admin = await openAs(browser, E2E_ADMIN.email);
  const worker = await openAs(browser, E2E_WORKER.email);
  const manager = await openAs(browser, E2E_USER.email);
  const generalManager = await openAs(browser, E2E_GM.email);

  try {
    await setApprovalRequired(admin, true);

    for (const title of [firstTitle, secondTitle, thirdTitle]) await writeActivity(worker, title);

    // The work queue provides a shortcut to the bulk screen.
    await resilientGoto(manager, "/");
    await manager.getByRole("link", { name: "Approve all" }).click();
    await expect(manager).toHaveURL(/\/approvals$/);

    const group = manager
      .locator('[data-test="approval-group"]')
      .filter({ hasText: "Mold Shop Employee" });
    await expect(group).toBeVisible();

    // All three are in the **same group**: same person, same day. We do not
    // assert the group's total because other pending records could share the
    // day and make the test fail for an unrelated reason.
    for (const title of [firstTitle, secondTitle, thirdTitle]) {
      await expect(
        group.locator('[data-test="approval-record"]').filter({ hasText: title }),
      ).toHaveCount(1);
    }

    // Descriptions are visible too; the manager should read them before
    // approving.
    await expect(group).toContainText("for a description.");

    const visibleCount = await group.locator('[data-test="approval-record"]').count();
    await group
      .getByRole("button", { name: new RegExp(`Approve the ${visibleCount} visible records`) })
      .click();

    await expect(manager).toHaveURL(
      new RegExp(`/approvals\\?approved=${visibleCount}$`),
    );
    await expect(manager.locator("#approval-message")).toContainText(
      `${visibleCount} records approved.`,
    );

    // Senior management can see them after approval.
    await resilientGoto(generalManager, `/search?q=${encodeURIComponent(String(suffix))}`);
    for (const title of [firstTitle, secondTitle, thirdTitle]) {
      await expect(generalManager.getByText(title).first()).toBeVisible();
    }

    // The queue is empty.
    await resilientGoto(manager, "/approvals");
    await expect(
      manager.locator('[data-test="approval-group"]').filter({ hasText: "Mold Shop Employee" }),
    ).toHaveCount(0);
  } finally {
    await setApprovalRequired(admin, false).catch(() => undefined);
    for (const page of [admin, worker, manager, generalManager]) {
      await page.context().close();
    }
  }
});
