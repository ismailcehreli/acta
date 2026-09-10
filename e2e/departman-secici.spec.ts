import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// İlgili departman seçici (Görev 10.3).
//
// Ağaç: Şirket → Genel Müdürlük → Kalıphane (Deneme Müdürü + Kalıphane Çalışanı)
//                               → Planlama (Planlama Müdürü)

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("departman çalışanına kendi birimi önceden seçili gelir", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/activities/new");

  // §5.4: çalışan çoğu gün bu alana hiç dokunmamalı.
  await expect(
    page.locator('[data-test="secilen-departmanlar"]'),
  ).toContainText("Kalıphane");
  await expect(
    page.getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ }),
  ).toBeChecked();
});

test("yöneticiye hiçbir departman seçili gelmez", async ({ page }) => {
  // Koordinatörün altındaki bütün birimleri işaretlemek yanlış olurdu:
  // IT ile ilgili bir kayda Lojistik de iliştirilirdi.
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");

  await expect(page.locator('[data-test="secilen-departmanlar"]')).toHaveCount(0);
  await expect(
    page.locator('[data-test="departman-secici"]').getByText("0/5"),
  ).toBeVisible();
});

test("arama listeyi süzer, seçim süzgeçten etkilenmez", async ({ page }) => {
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");

  const secici = page.locator('[data-test="departman-secici"]');

  await secici.getByLabel("Departman ara").fill("plan");
  await expect(secici.getByRole("checkbox", { name: /Planlama/ })).toBeVisible();
  await expect(secici.getByRole("checkbox", { name: /Kalıphane/ })).toHaveCount(0);

  await secici.getByRole("checkbox", { name: /Planlama/ }).check();
  await expect(secici).toContainText("1/5");

  // Süzgeç değişince seçim kaybolmaz — görünmeyen kutucuk da işaretli kalır.
  await secici.getByLabel("Departman ara").fill("kalıp");
  await expect(
    page.locator('[data-test="secilen-departmanlar"]'),
  ).toContainText("Planlama");
  await expect(secici).toContainText("1/5");
});

test("eşleşme yoksa açıkça söylenir", async ({ page }) => {
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");

  await page
    .locator('[data-test="departman-secici"]')
    .getByLabel("Departman ara")
    .fill("böyle-bir-departman-yok");

  await expect(page.getByText(/eşleşen departman yok/)).toBeVisible();
});

test("etiketten kaldırılan departman seçimden düşer", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/activities/new");

  const etiketler = page.locator('[data-test="secilen-departmanlar"]');
  await expect(etiketler).toContainText("Kalıphane");

  await etiketler.getByRole("button", { name: "Kalıphane seçimini kaldır" }).click();

  await expect(page.locator('[data-test="secilen-departmanlar"]')).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ }),
  ).not.toBeChecked();
});

test("arama ile seçilen departman kaydedilir", async ({ page }) => {
  await girisYap(page, E2E_USER.email);
  const baslik = `Seçici denemesi ${String(Date.now()).slice(-6)}`;

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill("Departman aramayla seçildi.");

  const secici = page.locator('[data-test="departman-secici"]');
  await secici.getByLabel("Departman ara").fill("plan");
  await secici.getByRole("checkbox", { name: /Planlama/ }).check();

  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);

  // Kayıt gerçekten o departmanla yazıldı mı — ekranın "kaydedildi" demesi
  // tek başına kanıt değil.
  await expect(
    page.locator('[data-test="faaliyet-satiri"]').filter({ hasText: baslik }),
  ).toContainText("Planlama");
});
