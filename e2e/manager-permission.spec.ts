import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import {
  E2E_ADMIN,
  E2E_DYE_MANAGER,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// Department manager functional permissions (Task 11.7).
//
// The important thing being tested is **the boundary itself**. Hiding a
// button is not security; these tests inspect the server's decision.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a manager can open user management", async ({ page }) => {
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/admin/users");

  await expect(
    page.getByRole("heading", { name: "Users" }).first(),
  ).toBeVisible();
});

test("a manager's list is limited to their own tree", async ({ page }) => {
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/admin/users");

  // Search for the user **link**: the system administrator's name also
  // appears as a role label, so a plain-text search cannot distinguish them.
  const userLink = (name: string) => page.getByRole("link", { name });

  // A user from the manager's own unit is visible.
  await expect(userLink(E2E_WORKER.fullName).first()).toBeVisible();

  // A manager from a sibling unit and the system administrator are hidden.
  await expect(userLink(E2E_PLANNER.fullName)).toHaveCount(0);
  await expect(userLink(E2E_ADMIN.fullName)).toHaveCount(0);
});

test("a manager does not see permission or password controls", async ({ page }) => {
  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/admin/users");

  await expect(page.getByRole("checkbox", { name: "System administrator" })).toHaveCount(0);

  await page.getByRole("link", { name: E2E_WORKER.fullName }).first().click();
  await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]{36}/);

  await expect(
    page.getByRole("button", { name: "Send reset link" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Change password", exact: true })).toHaveCount(0);

  const editForm = page.locator('[data-test="user-edit-form"]');
  await expect(
    editForm.getByText("Roles, scoring, and activity options can only be changed by a system administrator."),
  ).toBeVisible();
  await expect(editForm.getByLabel("Full name")).toBeVisible();
  await expect(editForm.getByLabel("Title")).toBeVisible();
  await expect(editForm.getByLabel("Email", { exact: true })).toHaveCount(0);
  await expect(editForm.getByLabel("Unit", { exact: true })).toHaveCount(0);
  await expect(
    editForm.getByRole("checkbox", { name: "Writes daily activities" }),
  ).toHaveCount(0);
});

test("a manager can add a user to their own tree", async ({ page }) => {
  const email = `new-${String(Date.now()).slice(-6)}@example.test`;

  await signIn(page, E2E_USER.email);
  await resilientGoto(page, "/admin/users/new");

  await page.getByLabel("Full name").fill("Manager's new user");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Title").fill("Mold technician");

  // **A manager cannot set a password** (Package F): the field is absent from
  // the screen and rejected by the server. The user sets it through a link
  // sent to their own address. A manager knowing the password would weaken
  // the audit trail's answer to "who created this record?".
  await expect(page.getByLabel("Initial password")).toHaveCount(0);

  // The unit picker is limited to the manager's tree.
  const unitPicker = page.getByLabel("Unit", { exact: true });
  const options = await unitPicker.locator("option").allTextContents();
  expect(options.join(" ")).toContain("Mold Shop");
  expect(options.join(" ")).not.toContain("Planning");

  // The first option is a placeholder; the real unit follows it.
  await unitPicker.selectOption({ index: 1 });

  await page.getByRole("button", { name: "Add user" }).click();

  await expect(page.locator("#user-success")).toContainText(
    "An email with a password setup link was sent to the user.",
  );
  await resilientGoto(page, "/admin/users?q=" + encodeURIComponent(email));
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  // The title must be persisted: it is one of the two fields available to a
  // manager.
  await expect(page.getByRole("cell", { name: "Mold technician" }).first()).toBeVisible();
});

test("a manager cannot edit a user in a sibling unit", async ({ page }) => {
  // The user is not shown at all; the **server's** decision is what matters.
  // Obtain the Planning manager's identity from the system administrator list.
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/users?q=" + encodeURIComponent(E2E_PLANNER.fullName));
  const link = page.locator('a[href^="/admin/users/"]').first();
  const href = await link.getAttribute("href");
  const foreignUserId = href?.split("/admin/users/")[1]?.split("?")[0] ?? "";
  expect(foreignUserId).not.toBe("");

  // As the Mold Shop manager, the user cannot access that profile.
  await signIn(page, E2E_USER.email);
  const response = await resilientGoto(page, `/users/${foreignUserId}`);
  expect(response?.status()).toBe(404);
});

test("the Dye Shop manager cannot see a Mold Shop worker", async ({ page }) => {
  await signIn(page, E2E_DYE_MANAGER.email);
  await resilientGoto(page, "/admin/users");

  await expect(page.getByRole("link", { name: E2E_WORKER.fullName })).toHaveCount(
    0,
  );
});

test("system administrator can manage permissions and passwords", async ({
  page,
}) => {
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/users");

  await page.getByRole("link", { name: E2E_WORKER.fullName }).first().click();
  await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]{36}/);

  const editForm = page.locator('[data-test="user-edit-form"]');
  await expect(
    editForm.getByRole("checkbox", { name: "System administrator" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change password", exact: true }).first(),
  ).toBeVisible();
});
