import { resilientGoto } from "./navigation";
import { expect, test, type Browser, type Page } from "./test-base";

import { E2E_PLANNER, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Follow-up items (§11).
//
// The tests verify that the keep-open flag creates a record, that a closing
// note is required, and that the item is **hidden from unauthorized users**.

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

async function writeActivity(page: Page, title: string, keepOpen: boolean) {
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill(`${title} description.`);
  if (keepOpen) {
    await page.getByRole("checkbox", { name: "Keep this topic open" }).check();
  }
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?record=added$/);
}

test("one click opens a follow-up that appears in the list", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Follow-up test ${suffix}`;

  const employee = await openAs(browser, E2E_WORKER.email);

  try {
    await writeActivity(employee, title, true);

    await resilientGoto(employee, "/follow-ups");
    const row = employee
      .locator('[data-test="follow-up-record"]')
      .filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText(E2E_WORKER.fullName);
  } finally {
    await employee.context().close();
  }
});

test("a closing note is required and remains on the record", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Follow-up to close ${suffix}`;

  const employee = await openAs(browser, E2E_WORKER.email);

  try {
    await writeActivity(employee, title, true);

    await resilientGoto(employee, "/follow-ups");
    await employee
      .locator('[data-test="follow-up-record"]')
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    await expect(employee).toHaveURL(/\/activities\/[0-9a-f-]{36}$/);

    const card = employee.locator('[data-test="follow-up-card"]');
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Close follow-up" }).click();

    const form = employee.locator('[data-test="close-follow-up-form"]');
    // The browser already blocks an empty note because the field is `required`.
    await expect(form.getByLabel("Closing Note")).toHaveAttribute("required", "");

    await form.getByLabel("Closing Note").fill("The part arrived and was installed.");
    await form.getByRole("button", { name: "Close" }).click();

    // The card is closed and the closing note remains on the record.
    await expect(employee.locator('[data-test="follow-up-card"]')).toHaveCount(0);
    await expect(employee.locator('[data-test="closed-follow-up"]')).toContainText(
      "The part arrived and was installed.",
    );

    // It leaves the open list.
    await resilientGoto(employee, "/follow-ups");
    await expect(
      employee.locator('[data-test="follow-up-record"]').filter({ hasText: title }),
    ).toHaveCount(0);
  } finally {
    await employee.context().close();
  }
});

test("a person outside the scope cannot see a follow-up item", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const title = `Hidden follow-up ${suffix}`;

  const employee = await openAs(browser, E2E_WORKER.email);
  const peer = await openAs(browser, E2E_PLANNER.email);
  const manager = await openAs(browser, E2E_USER.email);

  try {
    await writeActivity(employee, title, true);

    // A manager on another branch sees neither the title nor the "next step"
    // text.
    await resilientGoto(peer, "/follow-ups");
    await expect(peer.getByText(title)).toHaveCount(0);

    // The employee's own manager can see it.
    await resilientGoto(manager, "/follow-ups");
    await expect(
      manager.locator('[data-test="follow-up-record"]').filter({ hasText: title }),
    ).toBeVisible();
  } finally {
    for (const page of [employee, peer, manager]) await page.context().close();
  }
});
