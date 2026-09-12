import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_PLANNER, E2E_WORKER, e2ePassword } from "./global-setup";

// Profile picture (Task 11.5).
//
// Test upload behavior, content-type validation, and whether a picture from an
// out-of-scope person **can leak**.

test.describe.configure({ mode: "serial" });

async function openProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My Profile" }).click();
  await expect(page).toHaveURL(/\/users\//);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("a user can upload and remove their profile picture", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  await openProfile(page);

  await page
    .getByLabel("Profile picture file")
    .setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByText("Profile picture updated.")).toBeVisible();

  // The picture is really served and the browser can load it. A positive
  // `naturalWidth` proves that the request succeeded and returned an image.
  // It must appear **without a page reload**, so the user does not see an
  // update message while the old picture remains visible.
  const image = page.locator('img[src*="/avatar"]').first();
  await expect(image).toHaveCount(1);
  // A broken image can still occupy the page; `naturalWidth` is positive only
  // after the content has loaded.
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Remove picture" }).click();
  await expect(page.getByText("Profile picture removed.")).toBeVisible();

  // The image and its initials badge disappear after removal.
  await expect(page.locator('img[src*="/avatar"]')).toHaveCount(0);
});

test("an SVG cannot be uploaded", async ({ page }) => {
  await signIn(page, E2E_WORKER.email);
  await openProfile(page);

  // An SVG that claims to be a PNG by filename and MIME type must still fail
  // because type validation checks the content signature.
  await page.getByLabel("Profile picture file").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  });
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByText(/PNG, JPEG, or WebP/)).toBeVisible();
});

test("a picture from an out-of-scope person does not leak", async ({ page, browser }) => {
  // The Mold Shop employee uploads a picture.
  await signIn(page, E2E_WORKER.email);
  await openProfile(page);
  const targetUserId = page.url().split("/users/")[1]?.split("?")[0] ?? "";

  await page
    .getByLabel("Profile picture file")
    .setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Profile picture updated.")).toBeVisible();

  // The Planning manager is not above that employee and must not see either
  // the profile or the picture.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await signIn(otherPage, E2E_PLANNER.email);

  // Saying "it exists but you cannot see it" would disclose the person's
  // existence: return 404.
  //
  // Use a **direct request**, not page navigation. The measured value is an
  // HTTP status code; browser navigation rules made the measurement noisy
  // because Firefox does not complete navigation for an empty response
  // (2026-08-22). The request carries the context's session cookie, so the
  // authorization check is unchanged.
  const response = await otherContext.request.get(`/api/users/${targetUserId}/avatar`);
  expect(response.status()).toBe(404);

  await otherContext.close();
});

test("a system administrator can change another user's picture", async ({ page }) => {
  // Product-owner decision (2026-08-22): administrators need an intervention
  // path for inappropriate pictures.
  await signIn(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/users");

  await page.getByRole("link", { name: E2E_WORKER.fullName }).first().click();
  await expect(page).toHaveURL(/\/users\//);

  await expect(page.getByLabel("Profile picture file")).toBeVisible();
});
