import { resilientGoto } from "./navigation";
import { expect, test } from "./test-base";

import { E2E_USER, e2ePassword } from "./global-setup";

test.describe.configure({ mode: "serial" });

test("an unauthenticated user is redirected to the sign-in page", async ({ page }) => {
  await resilientGoto(page, "/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});

// Audit (2026-08-17, finding 13): the previous test sent a wrong password only
// to a registered account, so it did not prove that account existence is not
// disclosed. The proof is that different account states return the **same**
// response.
test("registered and unknown accounts receive the same error", async ({ page }) => {
  async function errorTextFor(email: string): Promise<string> {
    await resilientGoto(page, "/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign In" }).click();
    return (await page.locator("#login-error").textContent()) ?? "";
  }

  const registered = await errorTextFor(E2E_USER.email);
  const unknown = await errorTextFor("not-registered@example.test");

  expect(registered).toContain("The email address or password entered is incorrect.");
  expect(unknown).toBe(registered);
  await expect(page).toHaveURL(/\/login$/);
});

test("a correct password signs in and logging out closes the session", async ({
  page,
  context,
  browser,
}) => {
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(E2E_USER.email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("banner").getByText(E2E_USER.fullName),
  ).toBeVisible();

  // Copy the session cookie to prove that logout invalidates the server-side
  // session, not only the browser cookie.
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name === "acta_session");
  expect(sessionCookie).toBeDefined();

  // Logout is inside the account menu; the user's name no longer links directly
  // to the password screen.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log Out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // A protected page cannot be opened in this browser after logout.
  await resilientGoto(page, "/");
  await expect(page).toHaveURL(/\/login$/);

  // The copied cookie is invalid in another browser context too. If the
  // server-side session invalidation were removed, this step would pass and
  // the test would silently lose its value.
  const stolen = await browser.newContext();
  try {
    await stolen.addCookies([sessionCookie!]);
    const stolenPage = await stolen.newPage();
    await resilientGoto(stolenPage, "/");
    await expect(stolenPage).toHaveURL(/\/login$/);
  } finally {
    await stolen.close();
  }
});

// "Remember me" (2026-08-21).
//
// Test the checkbox explanation and that the option can be controlled by a
// setting. The duration extension itself is covered by unit tests; this checks
// the user-visible surface.
test("the remember-me checkbox explains what it does", async ({ page }) => {
  await resilientGoto(page, "/login");

  const rememberMe = page.getByRole("checkbox", { name: "Remember me" });
  await expect(rememberMe).toBeVisible();

  // It must make a quantified promise rather than use vague wording.
  await expect(page.getByText(/for \d+ days/)).toBeVisible();
  // The shared-computer warning is shown too.
  await expect(page.getByText(/shared computer/)).toBeVisible();
});

test("checking remember me creates a longer-lived session", async ({ page }) => {
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(E2E_USER.email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("checkbox", { name: "Remember me" }).check();
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/$/);

  // The cookie must have the same lifetime as the session; a long session with
  // a short-lived cookie would not work.
  const sessionCookie = (await page.context().cookies()).find(
    (c) => c.name === "acta_session",
  );
  expect(sessionCookie).toBeDefined();

  const remainingDays = (sessionCookie!.expires * 1000 - Date.now()) / 86_400_000;
  expect(remainingDays).toBeGreaterThan(7);
});
