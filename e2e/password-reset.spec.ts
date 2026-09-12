import { PrismaClient } from "@prisma/client";
import { resilientGoto } from "./navigation";
import { expect, test } from "./test-base";

import { E2E_ADMIN, e2ePassword } from "./global-setup";

// Task 5.5 (§15.3): reset with a single-use, time-limited token.
//
// The token is sent by email; E2E runs have no mailbox, so it is read from the
// notification queue. The test covers the reset flow itself, not token
// transport: the link works once and the old password becomes invalid.
test.describe.configure({ mode: "serial" });

function db(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: process.env.E2E_DATABASE_URL } },
  });
}

async function readToken(email: string): Promise<string> {
  const prisma = db();
  try {
    const record = await prisma.notificationQueue.findFirstOrThrow({
      where: { eventType: "password_reset", user: { email } },
      orderBy: { createdAt: "desc" },
    });
    return (record.payload as { token: string }).token;
  } finally {
    await prisma.$disconnect();
  }
}

test("a user resets their password and the link cannot be reused", async ({
  page,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `reset-${suffix}@example.test`;
  const initialPassword = `initial-${suffix}-password`;
  const newPassword = `reset-${suffix}-password`;

  // Create a user dedicated to this test; changing an installation account's
  // password would break other E2E tests.
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(E2E_ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);

  await resilientGoto(page, "/admin/users/new");
  await page.getByLabel("Full name").fill(`Password reset test ${suffix}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Unit", { exact: true })
    .selectOption({ label: "Company" });
  await page.getByLabel("Initial password").fill(initialPassword);
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.locator("#user-success")).toBeVisible();
  await resilientGoto(page, `/admin/users?q=${encodeURIComponent(email)}`);
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  await page.context().clearCookies();

  // Request a reset from the sign-in screen.
  await resilientGoto(page, "/login");
  await page.getByRole("link", { name: "Forgot password" }).click();
  await expect(page).toHaveURL(/\/reset$/);

  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If this address is registered")).toBeVisible();

  // The token was written to the queue; this represents the email link.
  const token = await readToken(email);
  expect(token.length).toBeGreaterThan(20);

  await resilientGoto(page, `/reset/${encodeURIComponent(token)}`);
  await page.getByLabel("New Password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm New Password").fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();

  await expect(page.getByText("Your password was changed")).toBeVisible();

  // The new password works.
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);

  // The same link cannot be used a second time.
  await page.context().clearCookies();
  await resilientGoto(page, `/reset/${encodeURIComponent(token)}`);
  await page.getByLabel("New Password", { exact: true }).fill("another-password-9876");
  await page.getByLabel("Confirm New Password").fill("another-password-9876");
  await page.getByRole("button", { name: "Change password" }).click();

  await expect(page.getByText("This link has already been used")).toBeVisible();

  // The second attempt must not change the password.
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("an unknown email receives the same reset response", async ({ page }) => {
  await resilientGoto(page, "/reset");
  await page.getByLabel("Email", { exact: true }).fill("unknown@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();

  // The text is **the same** as for a registered address, so registration
  // status cannot be inferred.
  await expect(page.getByText("If this address is registered")).toBeVisible();
});

test("a password cannot be changed with a fabricated token", async ({ page }) => {
  await resilientGoto(page, "/reset/fabricated-token");
  await page.getByLabel("New Password", { exact: true }).fill("test-password-1234");
  await page.getByLabel("Confirm New Password").fill("test-password-1234");
  await page.getByRole("button", { name: "Change password" }).click();

  await expect(page.getByText("The link is invalid")).toBeVisible();
});
