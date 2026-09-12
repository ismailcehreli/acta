import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";
import {
  E2E_ADMIN,
  E2E_CHAIRMAN,
  E2E_DYE_MANAGER,
  e2ePassword,
} from "./global-setup";
import { generateLoadData, type LoadSummary } from "../tests/helpers/acceptance-load-data";

// Acceptance run: page timings (Task 6.3).
//
// **Run separately from the normal end-to-end suite**: it generates tens of
// thousands of records and adds minutes to each run. Results belong in the
// acceptance report.
//
//   pnpm e2e:acceptance
//
// **The benchmark verifies what it measures** (audit 2026-08-23, finding 10).
// The old version only waited for any `main` element. Error and "not found"
// surfaces also render `main`, so an unauthorized redirect or unexpected
// error could be recorded as a **fast and successful** measurement. There was
// no assertion for the route, row count, or expected data — which meant that
// "everything is under two seconds" also included empty screens.
//
// Four conditions are verified before a timing is recorded:
//
//   1. Is the address the expected route?
//   2. Did the page avoid an error/status surface (`data-status-surface`)?
//   3. Does the route have its own marker (`main[data-page="…"]`)?
//   4. Were the expected rows actually rendered?
//
// **Who measures:** scope-reading screens use the **root-level board chair**.
// The general manager is not at the root, and load users are distributed
// across every unit including the root, so the general manager could not see
// the root users' records; the "widest scope" claim was false. The approval
// queue uses its actual owner (the manager of the unit that requires approval):
// the approval screen only returns records whose **active approver is that
// person**, so measuring it with another user would measure an empty screen.

test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

interface Expectation {
  label: string;
  path: string;
  /** The route's `data-page` marker. */
  marker: string;
  /** Element to count before timing and its minimum expected count. */
  content: { selector: string; minimum: number };
}

/** Verifies that the page is actually the **page being measured**. */
async function validate(page: Page, expectation: Expectation): Promise<void> {
  // Compare decoded values so the assertion tests the **route**, not URL
  // encoding.
  const currentUrl = new URL(page.url());
  expect(
    decodeURIComponent(`${currentUrl.pathname}${currentUrl.search}`),
    `${expectation.label}: not on the expected route`,
  ).toBe(decodeURIComponent(expectation.path));

  // Error, "not found", and loading surfaces render their own `main`.
  await expect(
    page.locator("[data-status-surface]"),
    `${expectation.label}: landed on an error/status surface`,
  ).toHaveCount(0);

  await expect(
    page.locator(`main[data-page="${expectation.marker}"]`),
    `${expectation.label}: route marker is missing`,
  ).toBeVisible();

  const count = await page.locator(expectation.content.selector).count();
  expect(
    count,
    `${expectation.label}: expected at least ${expectation.content.minimum} ` +
      `matches for ${expectation.content.selector}`,
  ).toBeGreaterThanOrEqual(expectation.content.minimum);
}

/** Opens a page six times; reports cold, median, and worst warm timings. */
async function measure(
  page: Page,
  expectation: Expectation,
): Promise<{ cold: number; median: number; worst: number }> {
  // **The first opening is measured separately.** Next prepares the route on
  // the first request and PostgreSQL builds its query plan on the first run.
  // Mixing that into the average hides both cold and warm behavior.
  const coldStart = Date.now();
  await resilientGoto(page, expectation.path, { waitUntil: "domcontentloaded" });
  await page
    .locator(`main[data-page="${expectation.marker}"]`)
    .waitFor({ state: "visible" });
  const cold = Date.now() - coldStart;
  await validate(page, expectation);

  const timings: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const start = Date.now();
    await resilientGoto(page, expectation.path, { waitUntil: "domcontentloaded" });
    // The route's own marker is rendered only after the server component is
    // ready; error surfaces never render this marker.
    await page
      .locator(`main[data-page="${expectation.marker}"]`)
      .waitFor({ state: "visible" });
    const duration = Date.now() - start;

    // The timing enters the list **after validation**.
    await validate(page, expectation);
    timings.push(duration);
  }

  timings.sort((a, b) => a - b);
  return { cold, median: timings[2] ?? 0, worst: timings[4] ?? 0 };
}

test("page timings are measured with twelve months of data", async ({ page }) => {
  // **Data is generated inside the test.** The first attempt wrote load data
  // with a separate script, but E2E setup truncates the database on every run,
  // so the benchmark measured an empty database and proved nothing.
  const summary: LoadSummary = await generateLoadData();
  console.log(`LOAD|${JSON.stringify(summary)}`);

  // The generated volume is a prerequisite: without data the benchmark says
  // nothing useful.
  expect(summary.personCount, "total active people").toBe(40);
  expect(summary.activityCount, "activity volume").toBeGreaterThan(5_000);
  expect(summary.pendingApproval, "approval queue").toBeGreaterThan(50);
  expect(summary.followUpItem, "follow-up items").toBeGreaterThan(100);
  expect(summary.draft, "drafts").toBeGreaterThan(20);
  expect(summary.leavePeriod, "leave periods").toBeGreaterThan(20);
  expect(summary.notification, "notifications").toBeGreaterThan(100);
  expect(summary.auditRecord, "audit records").toBeGreaterThan(1_000);
  expect(summary.scorePeriod, "score periods").toBeGreaterThan(100);

  const results: string[] = [];

  async function measureAndRecord(expectation: Expectation): Promise<void> {
    const { cold, median, worst } = await measure(page, expectation);
    results.push(
      `| ${expectation.label} | \`${expectation.path}\` | ${cold} ms | ` +
        `${median} ms | ${worst} ms |`,
    );
    console.log(
      `TIMING|${expectation.label}|${cold}|${median}|${worst}`,
    );
  }

  // ---- Scope-reading screens: root-level board chair ---------------------
  await signIn(page, E2E_CHAIRMAN.email);

  for (const expectation of [
    {
      label: "Dashboard",
      path: "/",
      marker: "dashboard",
      content: { selector: '[data-test="department-summary"]', minimum: 1 },
    },
    {
      label: "Activity feed",
      path: "/feed?period=all",
      marker: "feed",
      content: { selector: '[data-test="feed-row"]', minimum: 10 },
    },
    {
      label: "My activities",
      path: "/activities?period=all",
      marker: "my-activities",
      content: { selector: '[data-test="activity-record"]', minimum: 10 },
    },
    {
      label: "Search",
      path: "/search?q=work&period=all",
      marker: "search",
      content: { selector: '[data-test="search-result"]', minimum: 10 },
    },
    {
      label: "Follow-ups",
      path: "/follow-ups",
      marker: "follow-ups",
      content: { selector: '[data-test="follow-up-record"]', minimum: 5 },
    },
    {
      label: "Drafts",
      path: "/drafts",
      marker: "drafts",
      content: { selector: '[data-test="draft-record"]', minimum: 10 },
    },
    {
      label: "Team leave",
      path: "/team/absence",
      marker: "team-leave",
      content: { selector: '[data-test="leave-record"]', minimum: 5 },
    },
    {
      label: "Team scores",
      path: "/scores",
      marker: "scores",
      content: { selector: '[data-test="score-record"]', minimum: 10 },
    },
  ] satisfies Expectation[]) {
    await measureAndRecord(expectation);
  }

  // ---- Approval queue: its actual owner -----------------------------------
  // The approval screen only returns records whose **active approver is this
  // person**; even the broadest-scope user cannot see another person's queue.
  // That is why the benchmark signs in as the manager of the approval unit.
  await signIn(page, E2E_DYE_MANAGER.email);
  await measureAndRecord({
    label: "Approvals",
    path: "/approvals",
    marker: "approvals",
    content: { selector: '[data-test="approval-group"]', minimum: 5 },
  });
  // The filtered feed is measured here as well. `status=approval` finds
  // **pending approval** records and only the active approver can see them.
  // Measuring with the broadest-scope user would measure an empty list; the
  // benchmark previously exposed that mistake when the chair produced zero
  // rows and the old code recorded it as a "fast page".
  await measureAndRecord({
    label: "Activity feed (filtered)",
    path: "/feed?period=all&status=approval",
    marker: "feed",
    content: { selector: '[data-test="feed-row"]', minimum: 10 },
  });

  // ---- Administration screens: system administrator ----------------------
  await signIn(page, E2E_ADMIN.email);

  for (const expectation of [
    {
      label: "User management",
      path: "/admin/users",
      marker: "user-management",
      content: { selector: '[data-test="user-row"]', minimum: 20 },
    },
    {
      label: "Audit log",
      path: "/admin/audit",
      marker: "audit-log",
      content: { selector: '[data-test="audit-record"]', minimum: 10 },
    },
    {
      label: "Work calendar",
      path: "/admin/calendar?tab=units",
      marker: "work-calendar",
      // This screen is a form, not a list; populated unit options prove that
      // the page actually initialized.
      content: { selector: "#unit-calendar-unit option", minimum: 3 },
    },
  ] satisfies Expectation[]) {
    await measureAndRecord(expectation);
  }

  // Table rows are printed to the log and collected into the acceptance report.
  console.log(results.join("\n"));
});
