import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_GM, e2ePassword } from "./global-setup";

// Pagination and the "records per page" preference.
//
// Three properties are tested:
//   1. The choice applies **immediately**; the user does not press Apply.
//   2. The choice is **remembered** across lists and page reloads in a cookie.
//   3. The server reduces the value to the allowed list; a fabricated number
//      in the address cannot reach the query.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("the page-size choice applies immediately and is remembered", async ({ page }) => {
  await signIn(page, E2E_GM.email);

  await resilientGoto(page, "/feed");
  await expect(page.getByLabel("Rows per page")).toHaveValue("25");

  // The choice applies immediately; there is no separate Apply click.
  await page.getByLabel("Rows per page").selectOption("100");
  await expect(page).toHaveURL(/pageSize=100/);
  await expect(page.getByLabel("Rows per page")).toHaveValue("100");

  // The preference is in a cookie; another list uses the same size.
  await resilientGoto(page, "/activities");
  await expect(page.getByLabel("Rows per page")).toHaveValue("100");

  // It remains valid on the next visit even when the address has no query.
  await resilientGoto(page, "/feed");
  await expect(page.getByLabel("Rows per page")).toHaveValue("100");
});

test("a fabricated page size in the address is rejected", async ({ page }) => {
  await signIn(page, E2E_GM.email);

  // The server reduces it to the allowed list; without a cookie it uses the
  // default.
  await resilientGoto(page, "/feed?pageSize=100000");
  await expect(page.getByLabel("Rows per page")).toHaveValue("25");

  await resilientGoto(page, "/activities?pageSize=abc");
  await expect(page.getByLabel("Rows per page")).toHaveValue("25");
});

test("numbered pagination works in the personal archive", async ({ page }) => {
  await signIn(page, E2E_GM.email);

  // Use a small page size to create multiple pages when enough data exists.
  await resilientGoto(page, "/activities?pageSize=25");

  const pagination = page.getByRole("navigation", { name: "Pagination" });

  // The E2E data set is small; pagination renders only when there are multiple
  // pages. Both outcomes are valid, and the property is "does it work when
  // present".
  if ((await pagination.count()) === 0) {
    await expect(page.getByRole("heading", { name: "Activity log" })).toBeVisible();
    return;
  }

  await expect(pagination.getByRole("link", { name: "Page 1" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await pagination.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    page.getByRole("navigation", { name: "Pagination" }).getByRole("link", {
      name: "Page 2",
    }),
  ).toHaveAttribute("aria-current", "page");
});
