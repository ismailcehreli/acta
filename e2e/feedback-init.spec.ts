import { resilientGoto } from "./navigation";
import {
  E2E_ADMIN,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";
import { expect, test, type Page } from "./test-base";

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a non-manager cannot see feedback administration or the application reset", async ({
  page,
}) => {
  await loginAs(page, E2E_WORKER.email);

  await resilientGoto(page, "/feedback?tab=management");
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Feedback administration" })).toHaveCount(0);

  await resilientGoto(page, "/admin/settings/reset");
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveCount(0);
});

test("feedback administration works for an authorized manager through the real screen", async ({
  page,
  browser,
}) => {
  const workerContext = await browser.newContext();
  const workerPage = await workerContext.newPage();
  const title = `E2E feedback ${Date.now()}`;

  try {
    await loginAs(workerPage, E2E_WORKER.email);
    await resilientGoto(workerPage, "/feedback");
    await workerPage.getByLabel("Title", { exact: true }).fill(title);
    await workerPage.getByLabel("Description", { exact: true }).fill(
      "This record exercises the real administration flow.",
    );
    await workerPage.getByRole("button", { name: "Submit feedback" }).click();
    await expect(workerPage.getByText("Feedback saved.")).toBeVisible();

    // Even if the same user changes the URL to the administration tab, no
    // administration content appears; page authorization is more than hiding
    // navigation.
    await resilientGoto(workerPage, "/feedback?tab=management");
    await expect(workerPage.getByRole("heading", { name: "Feedback administration" })).toHaveCount(0);

    await loginAs(page, E2E_ADMIN.email);
    await resilientGoto(page, "/feedback?tab=management");
    const card = page
      .locator('[data-test="feedback-management-record"]')
      .filter({ hasText: title });
    await expect(card).toBeVisible();

    await card.getByLabel("Status").selectOption("RESOLVED");
    await card.getByLabel("Response").fill("The revision was published.");
    await card.getByRole("button", { name: "Update" }).click();
    await expect(page.getByText("Feedback updated.")).toBeVisible();

    await page.reload();
    const updatedCard = page
      .locator('[data-test="feedback-management-record"]')
      .filter({ hasText: title });
    await expect(updatedCard).toContainText("Resolved");
    await expect(updatedCard).toContainText("The revision was published.");
  } finally {
    await workerContext.close();
  }
});

test("the application reset form shows validation and a valid request flow", async ({
  page,
}) => {
  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/settings/reset");

  const fillResetForm = async (currentPassword: string): Promise<void> => {
    await page.getByLabel("Current password").fill(currentPassword);
    await page.getByLabel("Full name").fill("New E2E Reset Administrator");
    await page.getByLabel("Email", { exact: true }).fill("yeni-e2e-reset@example.test");
    await page.getByLabel("Initial password", { exact: true }).fill("new-e2e-initial-123");
    await page.getByLabel("Confirm initial password").fill("new-e2e-initial-123");
    await page.getByLabel("Confirm operation").fill("RESET APPLICATION");
  };

  await fillResetForm("wrong-password-123");
  await page.getByRole("button", { name: "Reset application" }).click();
  await expect(page.getByText("Your current password could not be verified.")).toBeVisible();

  await fillResetForm(e2ePassword());
  await page.getByRole("button", { name: "Reset application" }).click();
  await expect(page.getByText("Reset request pending")).toBeVisible();
  await expect(page.getByText("Status: Pending", { exact: true })).toBeVisible();
  await expect(page.getByText("yeni-e2e-reset@example.test")).toBeVisible();
});
