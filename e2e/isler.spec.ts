import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// Zamanlanmış iş izleme (§12.4): işleyici durursa sistem çalışıyor görünür ama
// hatırlatmalar sessizce ölür. Bu ekran o durumu görünür kılar.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("hiç çalışmamış işler gecikmiş görünür", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/jobs");

  await expect(page.getByRole("heading", { name: "Zamanlanmış işler" })).toBeVisible();

  // Uçtan uca koşuda işleyici süreci çalışmaz; üç iş de hiç çalışmamış olur.
  // "Listede yok" ile "sağlıklı" karıştırılmasın diye hepsi satır olarak görünür.
  for (const jobName of [
    "notification_dispatch",
    "missing_activity_reminder",
    "overdue_answer_reminder",
  ]) {
    const satir = page.locator(`[data-test="is-${jobName}"]`);
    await expect(satir).toBeVisible();
    await expect(satir).toContainText("hiç çalışmadı");
    await expect(satir.getByText("gecikti")).toBeVisible();
  }

  await expect(page.locator('[data-test="gecikme-uyarisi"]')).toBeVisible();
});

test("sağlık ucu gecikmiş zamanlayıcıda 503 döner", async ({ request }) => {
  const cevap = await request.get("/api/health");

  // İşleyici koşmadığı için zamanlayıcı gecikmiş: sistem "çalışıyor" demiyor.
  expect(cevap.status()).toBe(503);

  const rapor = await cevap.json();
  expect(rapor.scheduler.source).toBe("live");
  expect(rapor.scheduler.status).toBe("down");
  expect(rapor.notificationQueue.source).toBe("live");
  expect(typeof rapor.notificationQueue.depth).toBe("number");
});

test("sistem yöneticisi olmayan iş ekranını göremez", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/admin/jobs");

  await expect(page.getByRole("heading", { name: "Bu sayfayı görüntüleyemezsiniz" })).toBeVisible();
  await expect(page.locator('[data-test="is-notification_dispatch"]')).toHaveCount(0);
});
