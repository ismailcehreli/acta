import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import {
  E2E_ADMIN,
  E2E_GM,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// §9: ask a question → answer it → close it with real users.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function writeActivity(page: Page, title: string): Promise<string> {
  await resilientGoto(page, "/activities/new");
  await page.getByLabel("Activity Title").fill(title);
  await page.getByLabel("Description").fill(`${title} description.`);
  await page
    .getByRole("checkbox", { name: /^Mold Shop( \(your unit\))?$/ })
    .check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const link = page
    .locator('[data-test="activity-record"]')
    .filter({ hasText: title })
    .getByRole("link", { name: title, exact: false });
  const href = await link.getAttribute("href");
  return href as string;
}

test("ask, answer, and close a question", async ({ page, browser }) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `Question flow ${suffix}`;

  // A Mold Shop worker writes an activity.
  await loginAs(page, E2E_WORKER.email);
  const detailUrl = await writeActivity(page, title);

  // The Mold Shop manager asks a question.
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, detailUrl);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.getByLabel("Ask a Question").fill("Why has this question been open for three weeks?");
  await page.getByRole("button", { name: "Submit question" }).click();
  await expect(page.getByText("Why has this question been open for three weeks?")).toBeVisible();
  // The activity writer is next in line.
  await expect(page.getByText(`Queue: ${E2E_WORKER.fullName}`)).toBeVisible();

  // The writer answers; responsibility moves back to the person who asked.
  const writerContext = await browser.newContext();
  try {
    const writerPage = await writerContext.newPage();
    await loginAs(writerPage, E2E_WORKER.email);

    // The question appears as work assigned to the writer (§9.4).
    // The unified work queue (Task 10.5) states what to do and who it came from.
    await expect(
      writerPage.locator('[data-test="work-item"][data-type="answer"]').first(),
    ).toBeVisible();
    await expect(
      writerPage.getByRole("link", { name: title, exact: false }).first(),
    ).toBeVisible();

    await resilientGoto(writerPage, detailUrl);
    await writerPage
      .getByPlaceholder("Write your answer")
      .fill("A spare part is expected on September 12.");
    await writerPage.getByRole("button", { name: "Submit" }).click();

    await expect(
      writerPage.getByText("A spare part is expected on September 12.", { exact: false }),
    ).toBeVisible();
    await expect(writerPage.getByText(`Queue: ${E2E_USER.fullName}`)).toBeVisible();

    // The responsible person cannot close the conversation (§9.3).
    await writerPage.getByRole("button", { name: "Close conversation" }).click();
    await expect(
      writerPage.getByText(
        "The person responsible for the question cannot close the conversation",
        { exact: false },
      ),
    ).toBeVisible();
  } finally {
    await writerContext.close();
  }

  // The person who asked closes it.
  await resilientGoto(page, detailUrl);
  await page.getByRole("button", { name: "Close conversation" }).click();
  await expect(page.locator("li[data-status='closed']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close conversation" })).toHaveCount(0);
});

test("an intermediate manager sees the conversation but not a peer's activity", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `Intermediate manager ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  const detailUrl = await writeActivity(page, title);

  // The general manager asks a question.
  await loginAs(page, E2E_GM.email);
  await resilientGoto(page, detailUrl);
  await page.getByLabel("Ask a Question").fill("General Manager question");
  await page.getByRole("button", { name: "Submit question" }).click();
  await expect(page.getByText("General Manager question")).toBeVisible();

  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();

    // The intermediate manager can see the conversation (§9.4).
    await loginAs(otherPage, E2E_USER.email);
    await resilientGoto(otherPage, detailUrl);
    await expect(otherPage.getByText("General Manager question")).toBeVisible();

    // A peer manager cannot see the activity (§8.1).
    await loginAs(otherPage, E2E_PLANNER.email);
    const response = await resilientGoto(otherPage, detailUrl);
    expect(response?.status()).toBe(404);
    await expect(otherPage.getByText("General Manager question")).toHaveCount(0);
  } finally {
    await otherContext.close();
  }
});

// §9.4: an open question remains in both users' lists until it is answered.
test("an open question appears on both users' home screens", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const title = `Both sides ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  const detailUrl = await writeActivity(page, title);

  // The manager asks a question.
  await loginAs(page, E2E_USER.email);
  await resilientGoto(page, detailUrl);
  await page.getByLabel("Ask a Question").fill("What is the status of this item?");
  await page.getByRole("button", { name: "Submit question" }).click();
  await expect(page.getByText("What is the status of this item?")).toBeVisible();

  // The asker sees it in **Watched by me**: it is not their turn, but they are
  // following it (Task 10.5).
  await resilientGoto(page, "/");
  await expect(page.getByText("Watched by me")).toBeVisible();
  await expect(
    page.locator('[data-test="watched-item"]').filter({ hasText: title }),
  ).toBeVisible();
  // The title can appear in both the work queue and the scope feed; target the
  // work-queue link.
  await expect(
    page.getByRole("link", { name: title, exact: false }).first(),
  ).toBeVisible();

  // The writer sees the same item as waiting for their answer.
  const writerContext = await browser.newContext();
  try {
    const writer = await writerContext.newPage();
    await loginAs(writer, E2E_WORKER.email);
    await expect(
      writer.locator('[data-test="work-item"][data-type="answer"]').first(),
    ).toBeVisible();
    await expect(
      writer.getByRole("link", { name: title, exact: false }).first(),
    ).toBeVisible();

    // The roles switch after the writer answers.
    await resilientGoto(writer, detailUrl);
    await writer.getByPlaceholder("Write your answer").fill("Completed.");
    await writer.getByRole("button", { name: "Submit" }).click();
    await expect(writer.getByText("Completed.")).toBeVisible();

    await resilientGoto(writer, "/");
    // The turn moved to the other person: it left the work queue and moved to
    // Watched by me.
    await expect(writer.locator('[data-test="watched-items"]')).toBeVisible();
  } finally {
    await writerContext.close();
  }

  await resilientGoto(page, "/");
  await expect(
    page.locator('[data-test="work-item"][data-type="answer"]').first(),
  ).toBeVisible();
});

// Open questions in Plan 12 (product-owner decision, 2026-08-18) are closed
// during deactivation. A system administrator cannot see activity content
// (§15.1), so they cannot close the conversation from its detail page; the
// deactivation lock is intentional (§4.6).
test("a system administrator closes an open conversation with a reason and deactivates the user", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `departing-${suffix}@example.test`;
  const password = `initial-${suffix}-password`;
  const fullName = `Departing Person ${suffix}`;
  const title = `Deactivation flow ${suffix}`;

  // Add a new worker to Mold Shop.
  await loginAs(page, E2E_ADMIN.email);
  await resilientGoto(page, "/admin/users/new");
  await page.getByLabel("Full name").fill(fullName);
  await page.getByLabel("Email", { exact: true }).fill(email);
  // Option labels are indented by tree depth ("— — Mold Shop"); read the value
  // from the option instead of constructing the label manually.
  const selectedUnitValue = await page
    .locator("#orgUnitId option")
    .filter({ hasText: "Mold Shop" })
    .first()
    .getAttribute("value");
  await page.getByLabel("Unit", { exact: true }).selectOption(selectedUnitValue!);
  await page.getByLabel("Initial password").fill(password);
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.locator("#user-success")).toBeVisible();
  await resilientGoto(page, `/admin/users?q=${encodeURIComponent(email)}`);
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  const workerContext = await browser.newContext();
  try {
    const workerPage = await workerContext.newPage();
    await resilientGoto(workerPage, "/login");
    await workerPage.getByLabel("Email", { exact: true }).fill(email);
    await workerPage.getByLabel("Password", { exact: true }).fill(password);
    await workerPage.getByRole("button", { name: "Sign In" }).click();
    await expect(workerPage).toHaveURL(/\/$/);

    const detailUrl = await writeActivity(workerPage, title);

    // The manager asks a question, leaving the conversation open.
    const managerContext = await browser.newContext();
    try {
      const managerPage = await managerContext.newPage();
      await loginAs(managerPage, E2E_USER.email);
      await resilientGoto(managerPage, detailUrl);
      await managerPage.getByLabel("Ask a Question").fill("Has this work been completed?");
      await managerPage.getByRole("button", { name: "Submit question" }).click();
      await expect(managerPage.getByText("Has this work been completed?")).toBeVisible();
    } finally {
      await managerContext.close();
    }
  } finally {
    await workerContext.close();
  }

  // Deactivation is blocked and the reason is displayed on the user detail page.
  await resilientGoto(page, "/admin/users");
  const userRow = page.getByRole("row").filter({ hasText: email });
  await userRow.getByRole("link", { name: "Open details" }).click();
  await expect(page).toHaveURL(/\/admin\/users\/[^/]+/);
  await page.getByRole("button", { name: "Deactivate account" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This user has open work." }),
  ).toBeVisible();

  // The browser also rejects closing without a reason: the field is required.
  await expect(page.getByLabel("Closing reason")).toBeVisible();
  await page.getByLabel("Closing reason").fill("The person left the company.");
  await page.getByRole("button", { name: "Close open conversations" }).click();
  await expect(page.getByText("1 conversations were closed with a reason.")).toBeVisible();

  // It can now be deactivated from the same detail page.
  await page.getByRole("button", { name: "Deactivate account" }).click();
  await expect(
    page.getByText("The user cannot sign in; historical records are preserved."),
  ).toBeVisible();
});
