import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import {
  E2E_ADMIN,
  E2E_DYER,
  E2E_DYE_MANAGER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// Filtering and pagination standard for list pages (Task 11.3).
//
// Three properties are tested: filters actually narrow the list, pagination
// preserves filters, and an empty list explains why it is empty.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

const CANCELLED_TITLE = `To cancel ${String(Date.now()).slice(-6)}`;
const ACTIVE_TITLE = `Active record ${String(Date.now()).slice(-6)}`;

test("my activities: the status filter narrows the list", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);

  for (const title of [CANCELLED_TITLE, ACTIVE_TITLE]) {
    await resilientGoto(page, "/activities/new");
    await page.getByLabel("Activity Title").fill(title);
    await page.getByLabel("Description").fill(`${title} for a description.`);
    await page.getByRole("checkbox", { name: /Company/ }).first().check();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page).toHaveURL(/record=added/);
  }

  // Cancel one so the list contains two different statuses.
  const row = page
    .locator('[data-test="activity-record"]')
    .filter({ hasText: CANCELLED_TITLE });
  await row.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.getByLabel("Cancellation reason").fill("Entered incorrectly; cancelling it.");
  await page.getByRole("button", { name: "Cancel activity" }).click();
  await expect(page).toHaveURL(/record=cancelled/);

  // Filter: only cancelled records.
  await page.getByLabel("Status").selectOption("cancelled");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(/status=cancelled/);
  await expect(page.getByText(CANCELLED_TITLE)).toBeVisible();
  await expect(page.getByText(ACTIVE_TITLE)).toHaveCount(0);
});

test("my activities: the filter is preserved during pagination", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/activities?status=cancelled&pageSize=25");

  // Changing the page size must not drop the filter.
  await page.getByLabel("Rows per page").selectOption("50");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(/status=cancelled/);
  await expect(page).toHaveURL(/pageSize=50/);
});

test("my activities: an empty list explains why it is empty", async ({ page }) => {
  // The system administrator account does not write activities and no spec
  // creates one for it, so "my activities cancelled today" is reliably empty.
  //
  // Mold Shop accounts cannot be used here: other specs toggle that unit's
  // approval flag, making a "no pending approval" assumption unreliable when
  // tests run in parallel.
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/activities?status=cancelled&period=today");

  await expect(
    page.getByRole("heading", { name: "No records match the filter." }),
  ).toBeVisible();
  // "Write the first activity" would be misleading here.
  await expect(page.getByRole("link", { name: "Write the first activity" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Clear filter" }).first(),
  ).toBeVisible();
});

test("drafts: the record-type filter distinguishes draft modes", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);

  const intentionalDraft = `Intentional draft ${String(Date.now()).slice(-6)}`;
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(intentionalDraft);
  await page.getByLabel("Description").fill("I will complete this later.");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page).toHaveURL(/\/drafts\?record=draft$/);

  // Intentional drafts filter: the record is visible.
  await page.getByLabel("Record type").selectOption("manual");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/type=manual/);
  await expect(page.getByText(intentionalDraft)).toBeVisible();

  // Automatic drafts filter: the same record is hidden.
  await page.getByLabel("Record type").selectOption("automatic");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/type=automatic/);
  await expect(page.getByText(intentionalDraft)).toHaveCount(0);
});

test("search pagination links preserve filters", async ({ page }) => {
  // The link used to carry only the search term; moving to the second page
  // after applying filters lost all narrowing (Task 11.3).
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/search?q=records&period=all&pageSize=25");

  // The filter bar also carries the page-size selector.
  await expect(page.getByLabel("Rows per page")).toBeVisible();

  // If a next-page link exists, it must carry the filters.
  const nextPage = page.locator('[data-test="next-page"]');
  if (await nextPage.count()) {
    const href = await nextPage.getAttribute("href");
    expect(href).toContain("period=all");
    expect(href).toContain("pageSize=25");
  }
});

test("approvals: the person filter narrows the queue", async ({ page }) => {
  // Paint Shop permanently requires approval and no spec changes its flag, so
  // approval-queue scenarios are safe to create here.
  const title = `Approval queue ${String(Date.now()).slice(-6)}`;

  await signIn(page, E2E_DYER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill("Written to test the approval queue filter.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/record=added/);

  await signIn(page, E2E_DYE_MANAGER.email);
  await resilientGoto(page, "/approvals");
  await expect(page.getByText(title)).toBeVisible();

  // Person filter: selecting the author keeps the record.
  await page.getByLabel("Person").selectOption({ label: E2E_DYER.fullName });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/authorId=/);
  await expect(page.getByText(title)).toBeVisible();

  // The filter bar is consistent across lists, including page size.
  await expect(page.getByLabel("Rows per page")).toBeVisible();
});

test("follow-ups: one list, badges, and filters", async ({ page }) => {
  const title = `Follow-up record ${String(Date.now()).slice(-6)}`;

  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill("A follow-up record will be opened.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  // Open the follow-up while writing the record.
  await page.getByRole("checkbox", { name: "Keep this topic open" }).check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/record=added/);

  await resilientGoto(page, "/follow-ups");

  // Group headings are gone; there is one list and an ownership badge.
  await expect(page.getByText(title)).toBeVisible();
  const row = page.locator('[data-test="follow-up-record"]').filter({ hasText: title });
  await expect(row.getByText("assigned to you")).toBeVisible();

  // Closed-items filter: the open item disappears.
  await page.getByLabel("Status").selectOption("closed");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/status=closed/);
  await expect(page.getByText(title)).toHaveCount(0);

  // The filter bar is consistent here too, including page size.
  await expect(page.getByLabel("Rows per page")).toBeVisible();
});

test("user management: search and account-status filters", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/users");

  // Search narrows by name.
  await page.getByLabel("Name or email").fill("Mold Shop Employee");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByText(E2E_WORKER.fullName).first()).toBeVisible();

  // Account status and page size are in the same filter bar.
  await expect(page.getByLabel("Account status")).toBeVisible();
  await expect(page.getByLabel("Rows per page")).toBeVisible();
});

test("team leave: the person filter cannot open another person's record", async ({ page }) => {
  // The filter must not **override** the team-scope condition. Supplying the
  // same Prisma field twice made the last condition win in the original
  // implementation, allowing a non-subordinate's leave record to appear
  // (Task 11.4, found by a unit test). This checks the same property at the
  // route boundary: a foreign id must return no record.
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/team/absence");

  const optionCount = await page.getByLabel("Belongs to").locator("option").count();
  // Filter options come only from the scope: "Everyone" plus the team.
  expect(optionCount).toBeGreaterThan(1);

  // A query with an out-of-scope id leaves the list empty without an error.
  await resilientGoto(page, "/team/absence?person=00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: /No records match the filter/ })).toBeVisible();
});

test("audit trail: page-size selection preserves the filter", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/audit?objectType=user");

  await expect(page.getByLabel("Rows per page")).toBeVisible();
  await page.getByLabel("Rows per page").selectOption("50");
  await page.getByRole("button", { name: "Filter" }).click();

  await expect(page).toHaveURL(/objectType=user/);
  await expect(page).toHaveURL(/pageSize=50/);
});
