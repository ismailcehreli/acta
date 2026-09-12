import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_PLANNER, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Task 5.2 (§16.2): search is limited to the visibility scope. The real UI
// proves that an out-of-scope record does not appear in search results.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  // A signed-in user is redirected from /login to the home screen; clear cookies
  // so the same page can switch users safely.
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function writeActivity(page: Page, title: string, description: string) {
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill(description);
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);
}

test("a manager finds a record by searching within their scope", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  // Keep Turkish content here to verify PostgreSQL's Turkish stemming behavior.
  const title = `Kalıp sökümü ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  await writeActivity(
    page,
    title,
    `Presteki kalıplar söküldü ve temizlendi. Kod ${suffix}.`,
  );

  // The manager searches for an inflected Turkish word; stemming must match it.
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/search");
  await page.getByLabel("Search").fill(`kalıp ${suffix}`);
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByRole("link", { name: title })).toBeVisible();
  // The matching location is highlighted in the summary.
  await expect(page.locator("mark").first()).toBeVisible();
});

test("a peer's record never appears in search results", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `Planning note ${suffix}`;

  // The Planning manager writes a record in their own department.
  await loginAs(page, E2E_PLANNER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page
    .getByLabel("Description")
    .fill(`The weekly production plan was reviewed. Code ${suffix}.`);
  await page
    .getByRole("checkbox", { name: /^Planning( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);

  // First prove that the record is actually searchable; otherwise the negative
  // assertion below could pass because the record was never created.
  await resilientGoto(page, "/search");
  await page.getByLabel("Search").fill(suffix);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // The Mold Shop manager is a peer and cannot find it (§8.1).
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, "/search");
  await page.getByLabel("Search").fill(suffix);
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByText("No results found")).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
});

test("an unauthenticated user cannot open the search page", async ({ page }) => {
  await resilientGoto(page, "/search?q=work");

  await expect(page).toHaveURL(/\/login$/);
});

test("a search filter narrows results without losing the query", async ({ page }) => {
  await loginAs(page, E2E_USER.email);

  const suffix = String(Date.now()).slice(-6);
  const title = `Filter test ${suffix}`;

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill("An example record for filter testing.");
  // The manager has no department selected by default (§5.4); at least one is required.
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?record=added$/);

  await resilientGoto(page, `/search?q=${encodeURIComponent(suffix)}`);
  await expect(page.getByText(title).first()).toBeVisible();

  // The same scope-feed filter is available here (Task 10.9).
  await page.getByLabel("Author's department").selectOption({ label: "Planning" });
  await page.getByRole("button", { name: "Search" }).click();

  // Did the query disappear? If it had, the user would land on an empty page
  // without knowing why.
  await expect(page.getByLabel("Search")).toHaveValue(suffix);
  await expect(page.getByText(title)).toHaveCount(0);

  // Clearing the filter brings the record back.
  await page.getByRole("link", { name: "Clear filter" }).click();
  await expect(page.getByText(title).first()).toBeVisible();
});
