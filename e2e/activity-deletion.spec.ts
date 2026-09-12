import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// **Authorization gate** for the activity deletion screen (decision
// 2026-09-03, open question 25).
//
// Deletion is available only to the root system administrator. The claim is
// narrow but critical: being a system administrator is not enough. Since the
// gate also exists on the page itself, hiding the menu item is not sufficient;
// this test checks both surfaces.
//
// Deletion itself (code generation, period boundary, dependent records, and
// audit trail preservation) is covered end to end by service tests
// (`tests/activities/delete.test.ts`), including the real database gate.

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a non-root system administrator cannot open the deletion screen", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);

  await resilientGoto(page, "/admin/activity-deletion");

  await expect(
    page.getByText("Access denied"),
  ).toBeVisible();
  // No part of the deletion flow should render.
  await expect(page.getByRole("button", { name: "Send deletion code" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Permanently delete record" }),
  ).toHaveCount(0);
});

test("the administration navigation hides deletion from non-root users", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);

  await resilientGoto(page, "/admin/org");

  const navigation = page.getByRole("navigation", { name: "Administration sections" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Activity deletion" })).toHaveCount(0);
});

test("a non-system-administrator user cannot enter either", async ({ page }) => {
  await signIn(page, E2E_USER.email);

  await resilientGoto(page, "/admin/activity-deletion");

  await expect(
    page.getByText("Access denied"),
  ).toBeVisible();
});
