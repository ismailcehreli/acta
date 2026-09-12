import { resilientGoto } from "./navigation";
import { expect, test, type Browser, type Page } from "./test-base";

import { E2E_PLANNER, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// In-app notifications (Task 10.4).
//
// The important behavior: when a worker submits an activity, does a notification
// appear on the **manager's open screen** without requiring a page refresh
// through the real-time stream from Task 7.3?

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

test("the empty notification menu explains its state", async ({ browser }) => {
  const page = await openAs(browser, E2E_PLANNER.email);

  try {
    await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
    await page.getByRole("button", { name: "Notifications" }).click();

    // The empty menu **does not stay silent**: it explains what it is and when
    // it will contain something.
    await expect(page.getByText("Your inbox is empty")).toBeVisible();
    await expect(page.getByText("No notifications yet.")).toBeVisible();
  } finally {
    await page.context().close();
  }
});

// 2026-08-21: the notification menu opened downward below the shell and went
// off-screen, so notifications existed but the user could not see them.
// The same issue had already been fixed in the account menu.
test("the notification menu opens within the viewport", async ({ browser }) => {
  const page = await openAs(browser, E2E_USER.email);

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await resilientGoto(page, "/");
    await page.getByRole("button", { name: "Notifications" }).first().click();

    const menu = page.getByRole("menu").first();
    await expect(menu).toBeVisible();

    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    // The menu must remain within the viewport; otherwise its content is hidden.
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
  } finally {
    await page.context().close();
  }
});

test("a notification appears on the manager's screen when an activity requires approval", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Notification test ${suffix}`;

  const admin = await openAs(browser, "e2e-admin@example.test");
  const worker = await openAs(browser, E2E_WORKER.email);
  const manager = await openAs(browser, E2E_USER.email);

  try {
    await setApprovalRequired(admin, true);

    // The manager stays on the home page; it must not be refreshed.
    await resilientGoto(manager, "/");
    await expect(manager.getByRole("button", { name: "Notifications" })).toBeVisible();

    await resilientGoto(worker, "/activities/new");
    await worker.getByLabel("Activity Title").fill(title);
    await worker.getByLabel("Description").fill("The manager should receive a notification.");
    await worker.getByRole("button", { name: "Submit" }).click();
    await expect(worker).toHaveURL(/\/activities\?record=added$/);

    // The real-time stream updates the manager's screen and shows a toast.
    await expect(manager.locator('[data-test="notification-toast"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(manager.locator('[data-test="notification-toast"]')).toContainText(
      "An activity is waiting for your approval.",
    );

    // The notification button also shows the item in the list.
    await manager.getByRole("button", { name: "Notifications" }).click();
    await expect(manager.locator('[data-test="notification-list"]')).toContainText(
      "An activity is waiting for your approval.",
    );
  } finally {
    await setApprovalRequired(admin, false).catch(() => undefined);
    for (const page of [admin, worker, manager]) await page.context().close();
  }
});

test("opening the notification menu marks notifications as read", async ({ browser }) => {
  test.setTimeout(120_000);
  const manager = await openAs(browser, E2E_USER.email);

  try {
    await resilientGoto(manager, "/");
    const notificationButton = manager.getByRole("button", { name: "Notifications" });

    // Notifications from the previous test remain; opening the menu should clear
    // the unread count.
    await notificationButton.click();
    await expect(manager.locator('[data-test="notification-list"]')).toBeVisible();

    await resilientGoto(manager, "/");
    await notificationButton.click();
    // The menu is not empty, but there are **no new** notifications. The heading
    // must distinguish those states instead of misleading the user with an
    // empty-menu message.
    await expect(manager.getByText(/notifications · none new/)).toBeVisible();
    await expect(manager.locator('[data-test="notification-list"]')).toBeVisible();
  } finally {
    await manager.context().close();
  }
});

test("another user's notification is not visible", async ({ browser }) => {
  const worker = await openAs(browser, E2E_WORKER.email);

  try {
    await resilientGoto(worker, "/");
    await worker.getByRole("button", { name: "Notifications" }).click();

    // A notification waiting for the manager's approval must not appear in the
    // worker's notification menu.
    await expect(worker.getByText(/awaiting approval/i)).toHaveCount(0);
  } finally {
    await worker.context().close();
  }
});

test("a user changes notification preferences from their own profile", async ({ browser }) => {
  const page = await openAs(browser, E2E_WORKER.email);

  try {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "My Profile" }).click();
    await expect(page).toHaveURL(/\/users\//);

    const form = page.locator('[data-test="notification-preference"]');
    await expect(form).toBeVisible();
    // Instant notifications are selected by default.
    await expect(form.getByRole("radio", { name: /Instant/ })).toBeChecked();

    await form.getByRole("radio", { name: /Only actions requiring my attention/ }).check();
    await form.getByRole("button", { name: "Save preference" }).click();
    await expect(form.getByText("Notification preference saved.")).toBeVisible();

    // The preference persists after reopening the page.
    await page.reload();
    await expect(
      page
        .locator('[data-test="notification-preference"]')
        .getByRole("radio", { name: /Only actions requiring my attention/ }),
    ).toBeChecked();
  } finally {
    await page.context().close();
  }
});

test("another user's notification preferences are not visible on their profile", async ({ browser }) => {
  test.setTimeout(120_000);
  const worker = await openAs(browser, E2E_WORKER.email);
  const manager = await openAs(browser, E2E_USER.email);

  try {
    // Get the worker's profile URL.
    await worker.getByRole("button", { name: "Account menu" }).click();
    await worker.getByRole("menuitem", { name: "My Profile" }).click();
    await expect(worker).toHaveURL(/\/users\//);
    const profileUrl = worker.url();

    // The manager can view the direct report's profile…
    await resilientGoto(manager, profileUrl);
    await expect(manager.getByRole("heading", { name: "Mold Shop Employee" })).toBeVisible();

    // …but cannot change that user's notification preferences. A screen that
    // silently disabled someone else's notifications would hide important work.
    await expect(manager.locator('[data-test="notification-preference"]')).toHaveCount(0);
    await expect(manager.locator('[data-test="push-toggle"]')).toHaveCount(0);
  } finally {
    for (const page of [worker, manager]) await page.context().close();
  }
});
