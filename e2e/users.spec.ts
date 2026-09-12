import { gotoExpectingRedirect, resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createUser(
  page: Page,
  {
    fullName,
    email,
    password,
    writesActivities = true,
    isScored = true,
    canAppreciate = false,
  }: {
    fullName: string;
    email: string;
    password: string;
    writesActivities?: boolean;
    isScored?: boolean;
    canAppreciate?: boolean;
  },
) {
  await resilientGoto(page, "/admin/users/new");
  await page.getByLabel("Full name").fill(fullName);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Unit", { exact: true }).selectOption({ label: "Company" });
  await page.getByLabel("Initial password").fill(password);

  const writes = page.getByRole("checkbox", { name: "Writes daily activities" });
  if (!writesActivities) await writes.uncheck();

  const scored = page.getByRole("checkbox", { name: "Include in scoring" });
  if (!isScored) await scored.uncheck();

  const appreciate = page.getByRole("checkbox", { name: "Can give recognition" });
  if (canAppreciate) await appreciate.check();

  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.locator("#user-success")).toContainText(
    "Share the initial password with the user through a secure channel.",
  );

  await resilientGoto(page, `/admin/users?q=${encodeURIComponent(email)}`);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  return row;
}

async function openUserDetail(page: Page, email: string): Promise<void> {
  await resilientGoto(page, `/admin/users?q=${encodeURIComponent(email)}`);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Open details" }).click();
  await expect(page).toHaveURL(/\/admin\/users\/[^/]+/);
}

test("an unauthenticated user cannot enter user management", async ({ page }) => {
  await resilientGoto(page, "/admin/users");

  await expect(page).toHaveURL(/\/login$/);
});

test("a non-manager cannot view the user list", async ({ page }) => {
  await loginAs(page, E2E_WORKER.email);
  await resilientGoto(page, "/admin/users");

  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(page.getByText(E2E_ADMIN.email)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New user" })).toHaveCount(0);
});

test("a system administrator adds a user and the new user can sign in", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `new-${suffix}@example.test`;
  const password = `initial-${suffix}-password`;

  await loginAs(page, E2E_ADMIN.email);
  await expect(
    await createUser(page, {
      fullName: `Test Person ${suffix}`,
      email,
      password,
    }),
  ).toContainText(email);

  const newUserContext = await browser.newContext();
  try {
    const newUserPage = await newUserContext.newPage();
    await resilientGoto(newUserPage, "/login");
    await newUserPage.getByLabel("Email", { exact: true }).fill(email);
    await newUserPage.getByLabel("Password", { exact: true }).fill(password);
    await newUserPage.getByRole("button", { name: "Sign In" }).click();

    await expect(newUserPage).toHaveURL(/\/$/);
    await expect(
      newUserPage.getByRole("banner").getByText(`Test Person ${suffix}`),
    ).toBeVisible();
  } finally {
    await newUserContext.close();
  }
});

test("the same email cannot be added twice", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/users/new");

  await page.getByLabel("Full name").fill("Duplicate Record");
  await page.getByLabel("Email", { exact: true }).fill(E2E_USER.email);
  await page.getByLabel("Unit", { exact: true }).selectOption({ label: "Company" });
  await page.getByLabel("Initial password").fill("initial-password-1");
  await page.getByRole("button", { name: "Add user" }).click();

  await expect(page.locator("#user-error")).toContainText("already registered");
});

test("an added user is deactivated and their session is dropped", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `inactive-${suffix}@example.test`;
  const password = `initial-${suffix}-password`;

  await loginAs(page, E2E_ADMIN.email);
  await createUser(page, {
    fullName: `Soon Inactive ${suffix}`,
    email,
    password,
  });

  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  try {
    await resilientGoto(userPage, "/login");
    await userPage.getByLabel("Email", { exact: true }).fill(email);
    await userPage.getByLabel("Password", { exact: true }).fill(password);
    await userPage.getByRole("button", { name: "Sign In" }).click();
    await expect(userPage).toHaveURL(/\/$/);

    await openUserDetail(page, email);
    await page.getByRole("button", { name: "Deactivate account" }).click();
    await page.reload();
    await expect(
      page.getByText("The user cannot sign in; historical records are preserved."),
    ).toBeVisible();

    await resilientGoto(userPage, "/");
    await expect(userPage).toHaveURL(/\/login$/);

    await page.getByRole("button", { name: "Activate account" }).click();
    await page.reload();
    await expect(page.getByText("The user can sign in.")).toBeVisible();

    await resilientGoto(page, "/admin/audit?objectType=user&action=user_reactivated");
    await expect(
      page.locator('[data-test="audit-record"]').first(),
    ).toContainText("user reactivated");
  } finally {
    await userContext.close();
  }
});

test("a system administrator edits a user's information", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `to-edit-${suffix}@example.test`;
  const updatedEmail = `edited-${suffix}@example.test`;

  await loginAs(page, E2E_ADMIN.email);
  await createUser(page, {
    fullName: `To Edit ${suffix}`,
    email,
    password: `initial-${suffix}-password`,
  });
  await openUserDetail(page, email);

  await page.getByLabel("Full name").fill(`New Name ${suffix}`);
  await page.getByLabel("Email", { exact: true }).fill(updatedEmail);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`"New Name ${suffix}" was updated.`)).toBeVisible();
  await page.reload();

  await expect(
    page.getByRole("heading", { level: 1, name: `New Name ${suffix}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(updatedEmail, { exact: false })).toBeVisible();
});

test("a system administrator sets a password and the user signs in with it", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `password-${suffix}@example.test`;
  const initialPassword = `initial-${suffix}-password`;
  const newPassword = `manager-${suffix}-password`;

  await loginAs(page, E2E_ADMIN.email);
  await createUser(page, {
    fullName: `Password Person ${suffix}`,
    email,
    password: initialPassword,
  });

  const userContext = await browser.newContext();
  try {
    const userPage = await userContext.newPage();
    await resilientGoto(userPage, "/login");
    await userPage.getByLabel("Email", { exact: true }).fill(email);
    await userPage.getByLabel("Password", { exact: true }).fill(initialPassword);
    await userPage.getByRole("button", { name: "Sign In" }).click();
    await expect(userPage).toHaveURL(/\/$/);

    await openUserDetail(page, email);
    await page.getByLabel("New password").fill(newPassword);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed")).toBeVisible();

    await gotoExpectingRedirect(userPage, "/", /\/login$/);
    await expect(userPage).toHaveURL(/\/login$/);

    await userPage.getByLabel("Email", { exact: true }).fill(email);
    await userPage.getByLabel("Password", { exact: true }).fill(newPassword);
    await userPage.getByRole("button", { name: "Sign In" }).click();
    await expect(userPage).toHaveURL(/\/$/);
  } finally {
    await userContext.close();
  }
});

test("a user who does not write activities has no activity block on the home screen", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `no-activity-${suffix}@example.test`;
  const password = `initial-${suffix}-password`;

  await loginAs(page, E2E_ADMIN.email);
  const row = await createUser(page, {
    fullName: `No Activity User ${suffix}`,
    email,
    password,
    writesActivities: false,
  });
  await expect(row).toContainText("does not write activities");

  const userContext = await browser.newContext();
  try {
    const userPage = await userContext.newPage();
    await resilientGoto(userPage, "/login");
    await userPage.getByLabel("Email", { exact: true }).fill(email);
    await userPage.getByLabel("Password", { exact: true }).fill(password);
    await userPage.getByRole("button", { name: "Sign In" }).click();
    await expect(userPage).toHaveURL(/\/$/);

    await expect(userPage.getByRole("heading", { name: "My Overview" })).toBeVisible();
    await expect(userPage.getByText("You have not entered an activity today.")).toHaveCount(0);
    await expect(userPage.getByRole("heading", { name: "Assigned to me" })).toBeVisible();
  } finally {
    await userContext.close();
  }
});

test("a system administrator cannot change their own account through administration", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await openUserDetail(page, E2E_ADMIN.email);

  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate account" })).toHaveCount(0);
});
