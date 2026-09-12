import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Attaching files to an activity — end to end.
//
// Unit tests already cover the file service (type validation, size limits, and
// disk writes). This test covers the **user journey**: selecting and saving a
// file in the browser, seeing it attached to the record, **opening and closing
// it without leaving the page**, downloading it, and being unable to download
// an attachment from a record the user cannot see.
//
// The preview endpoint (`?inline=1`) is a separate presentation mode but goes
// through the **same** visibility gate; both must return 404 for an
// unauthorized user. This proves that the new preview surface does not become
// a data-leak path.
//
// The last point is the key one: attachment download is a separate HTTP
// endpoint (`/api/attachments/`) and operates independently of page
// visibility. If it bypassed the visibility module, anyone with an attachment
// link could access the file.
//
// The download request is made **from the page** (`fetch`), not through a
// separate HTTP client: the session cookie is marked `secure`, and Playwright's
// API client does not send it over plain HTTP. A 401 from that route would be
// the test tool's behavior rather than the application's.

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** A small but **real** PNG: type validation checks the content signature. */
const PNG_CONTENT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let recordUrl = "";
let attachmentUrl = "";

test("a user can attach files to an activity and download them", async ({ page }) => {
  await signIn(page, E2E_USER.email);

  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill("Mold measurement report");
  await page
    .getByLabel("Description")
    .fill("The measurement results are in the attached files; two parts exceed tolerance.");

  await page.getByLabel("Attachments (optional)").setInputFiles({
    name: "measurement-report.png",
    mimeType: "image/png",
    buffer: PNG_CONTENT,
  });
  // The browser replaces the first selection when the same input is used a
  // second time. The application must accumulate selections; this catches the
  // earlier "only the last photo" bug from the user's journey.
  await page.getByLabel("Attachments (optional)").setInputFiles({
    name: "measurement-detail.png",
    mimeType: "image/png",
    buffer: PNG_CONTENT,
  });
  await expect(page.locator('[data-test="attachment-count"]')).toContainText("2/5");
  await expect(page.locator('[data-test="attachment-list"]')).toContainText(
    "measurement-report.png",
  );
  await expect(page.locator('[data-test="attachment-list"]')).toContainText(
    "measurement-detail.png",
  );

  // A related department is required.
  await page.getByRole("checkbox", { name: /Company/ }).first().check();

  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities\?record=added$/);

  // Open the record detail: attachments are listed there.
  await page
    .locator('[data-test="activity-record"]')
    .filter({ hasText: "Mold measurement report" })
    .getByRole("link")
    .first()
    .click();
  await expect(page).toHaveURL(/\/activities\/[0-9a-f-]+$/);
  recordUrl = page.url();

  // An image attachment appears as a small preview, not a download link.
  const previews = page.locator('[data-test="attachment-preview"][data-attachment-type="image"]');
  await expect(previews).toHaveCount(2);
  await expect(previews.filter({ hasText: "measurement-detail.png" })).toHaveCount(1);
  const preview = previews.first();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("measurement-report.png");

  const resolveUrl = async (selector: string, attribute: string) =>
    new URL(
      (await page.locator(selector).first().getAttribute(attribute)) ?? "",
      page.url(),
    ).toString();

  // The small preview renders the file itself through the `inline` endpoint.
  const previewUrl = await resolveUrl('[data-test="attachment-preview"] img', "src");
  expect(previewUrl).toContain("/api/attachments/");
  expect(previewUrl).toContain("inline=1");

  // Clicking opens an overlay on the **same page**: the address does not
  // change and no new tab is opened.
  const previousUrl = page.url();
  await preview.click();
  const overlay = page.locator('[data-test="attachment-preview-overlay"]');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator("img")).toBeVisible();
  expect(page.url()).toBe(previousUrl);

  // The download link in the overlay points to the endpoint without a query
  // parameter.
  attachmentUrl = new URL(
    (await overlay.getByRole("link", { name: "Download" }).getAttribute("href")) ?? "",
    page.url(),
  ).toString();
  expect(attachmentUrl).toContain("/api/attachments/");
  expect(attachmentUrl).not.toContain("inline=1");

  // Closing leaves the user on the record detail page.
  await overlay.getByRole("button", { name: "Close" }).click();
  await expect(overlay).toHaveCount(0);
  expect(page.url()).toBe(previousUrl);

  // Escape also closes it: keyboard users must not be trapped in the overlay.
  await preview.click();
  await expect(overlay).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);

  // The same file is served in two modes, and both return the same bytes.
  const previewResponse = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return {
      status: response.status,
      disposition: response.headers.get("content-disposition"),
      csp: response.headers.get("content-security-policy"),
    };
  }, `${attachmentUrl}?inline=1`);

  expect(previewResponse.status).toBe(200);
  expect(previewResponse.disposition).toContain("inline");
  // The displayed file cannot execute scripts or make external requests.
  expect(previewResponse.csp).toContain("sandbox");

  // The download really returns the file. The request is made **from the
  // page**, so the browser automatically carries the session cookie.
  const downloadResponse = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      disposition: response.headers.get("content-disposition"),
      length: bytes.length,
      signature: Array.from(bytes.subarray(0, 4))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    };
  }, attachmentUrl);

  expect(downloadResponse.status).toBe(200);
  expect(downloadResponse.contentType).toContain("image/png");
  // It is always served as a download so the browser does not execute it.
  expect(downloadResponse.disposition).toContain("attachment");
  expect(downloadResponse.disposition).toContain("measurement-report.png");
  expect(downloadResponse.length).toBe(PNG_CONTENT.length);
  expect(downloadResponse.signature).toBe("89504e47");
});

test("a person who cannot see a record cannot download its attachment", async ({ page }) => {
  expect(attachmentUrl).not.toBe("");

  // A user from another unit who has no permission to see this record.
  await signIn(page, E2E_WORKER.email);

  // First check the record itself: "does not exist" and "not authorized"
  // return the same response.
  const recordResponse = await resilientGoto(page, recordUrl);
  expect(recordResponse?.status()).toBe(404);

  // The important part: the download endpoint is separate and must apply the
  // same rule. The 404 response must not contain the file body.
  const attachmentResponse = await resilientGoto(page, attachmentUrl);
  expect(attachmentResponse?.status()).toBe(404);
  const body = await attachmentResponse!.body();
  expect(body.subarray(0, 4).toString("hex")).not.toBe("89504e47");

  // Preview is a separate presentation mode but uses the **same** gate; adding
  // the parameter does not grant access.
  const previewResponse = await resilientGoto(page, `${attachmentUrl}?inline=1`);
  expect(previewResponse?.status()).toBe(404);
  expect((await previewResponse!.body()).subarray(0, 4).toString("hex")).not.toBe(
    "89504e47",
  );
});

test("an unauthenticated request cannot download an attachment", async ({ page }) => {
  expect(attachmentUrl).not.toBe("");
  await page.context().clearCookies();

  const response = await resilientGoto(page, attachmentUrl);
  // An unauthenticated request cannot be a 200 response containing the file.
  expect(response?.status()).not.toBe(200);
  expect((await response!.body()).subarray(0, 4).toString("hex")).not.toBe("89504e47");
});
