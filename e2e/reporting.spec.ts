import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import {
  E2E_ADMIN,
  E2E_CHAIRMAN,
  E2E_GM,
  E2E_USER,
  e2ePassword,
} from "./global-setup";

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("the reports page shows a meaningful scope to an authorized manager", async ({ page }) => {
  await loginAs(page, E2E_CHAIRMAN.email);

  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "Reports" })).toBeVisible();

  await resilientGoto(page, "/reports");
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Activity summary" })).toBeVisible();
  await expect(page.getByText(/Scope: Company and child units/)).toBeVisible();
  await expect(page.getByText("What does this mean?", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("combobox", { name: "Unit scope" })
      .getByRole("option", { name: /Mold Shop/ })
      .first(),
  ).toBeAttached();
});

test("the reports scope shows the branch assigned to an intermediate manager", async ({ page }) => {
  await loginAs(page, E2E_GM.email);
  await resilientGoto(page, "/reports");

  await expect(page.getByText(/Scope: General Management and child units/)).toBeVisible();
  await expect(page.getByRole("option", { name: /Planning/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Scores & recognition" })).toHaveCount(0);
});

test("unauthorized users and system administrators cannot open the reports page", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0);
  await resilientGoto(page, "/reports");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();

  await loginAs(page, E2E_ADMIN.email);
  await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0);
  await resilientGoto(page, "/reports");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
});
