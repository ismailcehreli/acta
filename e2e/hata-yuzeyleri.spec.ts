import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_PLANNER, E2E_WORKER, e2ePassword } from "./global-setup";

// Hata ve bekleme yüzeyleri (Görev 10.1).
//
// Buradaki asıl sınama şu: **404 yüzeyi ayrım yapmıyor.** "Böyle bir kayıt yok"
// ile "kaydı görme yetkiniz yok" aynı cevabı veriyor. Ayrım yapsaydı,
// görülemeyen bir kaydın varlığı ele verilirdi (§8.2, §18.4).

async function girisYap(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("olmayan adres 404 yüzeyi gösterir", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);

  const yanit = await dayanikliGoto(page, "/boyle-bir-sayfa-yok");

  expect(yanit?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Bu sayfa yok" })).toBeVisible();
  // Kullanıcı çıkmaz sokakta bırakılmaz.
  await expect(page.getByRole("link", { name: "Ana ekrana dön" })).toBeVisible();
});

test("görülemeyen kayıt, olmayan kayıtla aynı yüzeyi verir", async ({ page }) => {
  // Çalışan bir faaliyet yazar ve adresini alır.
  await girisYap(page, E2E_WORKER.email);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Gizli kayıt ${suffix}`;

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill("Bu kaydı başka dal görmemeli.");
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?/);

  await page
    .locator('[data-test="faaliyet-satiri"]')
    .filter({ hasText: baslik })
    .getByRole("link", { name: baslik })
    .click();
  await expect(page).toHaveURL(/\/activities\/[0-9a-f-]{36}$/);
  const adres = page.url();

  // Planlama Müdürü başka daldadır; kaydı göremez.
  await girisYap(page, E2E_PLANNER.email);
  const yanit = await dayanikliGoto(page, adres);

  expect(yanit?.status()).toBe(404);
  // **Aynı** yüzey: "yetkiniz yok" demiyor, kaydın başlığını sızdırmıyor.
  await expect(page.getByRole("heading", { name: "Bu sayfa yok" })).toBeVisible();
  await expect(page.getByText(baslik)).toHaveCount(0);
});
