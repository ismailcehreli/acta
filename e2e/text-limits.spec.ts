import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_WORKER, e2ePassword } from "./global-setup";

// Configurable text limits (Task 11.6).
//
// The limit is enforced **on the server**; the form's `minLength` is a
// convenience. The test changes the setting and proves that the form and server
// use the same value.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function setSetting(page: Page, label: string, value: string) {
  await resilientGoto(page, "/admin/settings/general");
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Save settings" }).click();
}

test("cross-validation rejects a minimum greater than its maximum", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/settings/general");

  // Both values are individually valid but contradict each other.
  await page.getByLabel("Minimum title length", { exact: true }).fill("80");
  await page.getByLabel("Maximum title length", { exact: true }).fill("50");
  await page.getByRole("button", { name: "Save settings" }).click();

  await expect(page.getByText(/minimum character count.*maximum/i)).toBeVisible();
});

test("the form and server use the same increased limit", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await setSetting(page, "Minimum title length", "15");

  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/activities/new");

  // The form displays the limit.
  await expect(page.getByText("At least 15 characters")).toBeVisible();

  // The field has the same `minLength`, proving there is one source of truth.
  await expect(page.getByLabel("Activity Title")).toHaveAttribute("minlength", "15");

  // The server enforces the same limit and rejects a short title.
  await page.getByLabel("Activity Title").fill("Short");
  await page.getByLabel("Description").fill("A sufficiently long description for the activity.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.evaluate(() => {
    // Bypass browser validation: the **server's** decision is being tested.
    document.querySelector("form")?.setAttribute("novalidate", "true");
  });
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByText(/Title must be at least 15 characters/)).toBeVisible();
});

test("a short title becomes valid again after restoring the limit", async ({ page }) => {
  await signIn(page, E2E_ADMIN.email);
  await setSetting(page, "Minimum title length", "1");

  await signIn(page, E2E_WORKER.email);
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill("HR");
  await page.getByLabel("Description").fill("The short title is valid again.");
  await page.getByRole("checkbox", { name: /Company/ }).first().check();
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page).toHaveURL(/record=added/);
});
