import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// İşlem kayıtları — denetim izi (§15.2). Ekran sistem yöneticisine açıktır ve **içerik
// taşımaz** (§15.1): faaliyet başlığı, açıklaması ve mesaj metni görünmez.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("giriş ve faaliyet işlemleri denetim izinde görünür", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Denetim denemesi ${suffix}`;

  // Kalıphane çalışanı faaliyet yazar.
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill(`${baslik} için gizli açıklama metni.`);
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);

  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/audit");

  await expect(page.getByRole("heading", { name: "İşlem kayıtları" })).toBeVisible();
  await expect(page.locator('[data-test="denetim-kaydi"]').first()).toBeVisible();

  // Giriş denemeleri kayda geçiyor (§15.3).
  await dayanikliGoto(page, "/admin/audit?action=login_succeeded");
  await expect(page.locator('[data-test="denetim-kaydi"]').first()).toBeVisible();

  // Faaliyet yazımı kayda geçiyor ama **başlığı görünmüyor**.
  await dayanikliGoto(page, "/admin/audit?action=activity_created");
  const ilkKayit = page.locator('[data-test="denetim-kaydi"]').first();
  await expect(ilkKayit).toBeVisible();

  const icerik = await page.content();
  expect(icerik).not.toContain(baslik);
  expect(icerik).not.toContain("gizli açıklama metni");
});

test("sistem yöneticisi olmayan denetim izini göremez", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/admin/audit");

  await expect(page.getByRole("heading", { name: "Bu sayfayı görüntüleyemezsiniz" })).toBeVisible();
  await expect(page.locator('[data-test="denetim-kaydi"]')).toHaveCount(0);
});
