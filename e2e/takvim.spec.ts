import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Görev 5.4a (§12.1): çalışma takvimi sistem yöneticisinde, "faaliyet
// beklenmiyor" işareti kişinin yöneticisinde.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("sistem yöneticisi çalışma takvimini düzenler ve tatil ekler", async ({
  page,
}) => {
  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/calendar");

  await expect(
    page.getByRole("heading", { name: "Çalışma takvimi" }),
  ).toBeVisible();

  // Cumartesi çalışma günü yapılır.
  await page.getByRole("checkbox", { name: "Cumartesi" }).check();
  await page.getByRole("button", { name: "Takvimi kaydet" }).click();
  await expect(page.getByText("Çalışma takvimi kaydedildi")).toBeVisible();

  // Sayfa yeniden açıldığında seçim korunur.
  await dayanikliGoto(page, "/admin/calendar");
  await expect(page.getByRole("checkbox", { name: "Cumartesi" })).toBeChecked();

  // Tatil eklenir ve listede görünür.
  const tatil = "2026-12-31";
  await dayanikliGoto(page, "/admin/calendar?sekme=tatiller");
  await page.getByLabel("Tarih").fill(tatil);
  await page.getByLabel("Açıklama").fill("Yılbaşı arifesi");
  await page.getByRole("button", { name: "Tatil ekle" }).click();
  await expect(page.getByText("Yılbaşı arifesi")).toBeVisible();

  // Yanlış girilen tatil çıkarılabilir. Tatiller Görev 7.2'de tabloya taşındı;
  // satır artık `<tr>`.
  const satir = page.getByRole("row").filter({ hasText: "Yılbaşı arifesi" });
  await satir.getByRole("button", { name: "Çıkar" }).click();
  await expect(page.getByText("Yılbaşı arifesi")).toHaveCount(0);

  // Kurulum bozulmasın: Cumartesi geri alınır.
  await dayanikliGoto(page, "/admin/calendar");
  await page.getByRole("checkbox", { name: "Cumartesi" }).uncheck();
  await page.getByRole("button", { name: "Takvimi kaydet" }).click();
  await expect(page.getByText("Çalışma takvimi kaydedildi")).toBeVisible();
});

test("sistem yöneticisi olmayan takvimi düzenleyemez", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/admin/calendar");

  await expect(page.getByRole("heading", { name: "Bu sayfayı görüntüleyemezsiniz" })).toBeVisible();
  // Form hiç render edilmemeli.
  await expect(page.getByRole("button", { name: "Takvimi kaydet" })).toHaveCount(0);
});

test("yönetici ekibi için işaret koyar ve gerekçeyle iptal eder", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/team/absence");

  await expect(
    page.getByRole("heading", { name: "Ekip izinleri" }),
  ).toBeVisible();

  await page.getByLabel("Kişi").selectOption({ label: E2E_WORKER.fullName });
  await page.getByLabel("Başlangıç").fill("2026-12-21");
  await page.getByLabel("Bitiş").fill("2026-12-25");
  await page.getByLabel("Not (isteğe bağlı)").fill("Yıllık izin");
  await page.getByRole("button", { name: "Kaydet" }).click();

  await expect(page.getByText("Bu tarihlerde kişiye hatırlatma gitmez")).toBeVisible();
  // İşaretler tasarım Faz 6'da kayıt defterine döndü: satır artık `<li>`
  // (dar ekranda beş sütunlu tablo yerine etiketli kayıt).
  const satir = page.getByRole("listitem").filter({ hasText: "Yıllık izin" });
  await expect(satir).toBeVisible();

  // Kayıt **silinmez**, gerekçeyle iptal edilir (bulgu 7): vekilin
  // o döneme ait görünürlüğü bu satırdan türüyor.
  await satir.getByRole("button", { name: `${E2E_WORKER.fullName} kaydını iptal et` }).click();
  await satir.getByLabel("İptal gerekçesi").fill("Sehven girildi");
  await satir.getByRole("button", { name: "Onayla" }).click();

  // Satır listede kalır, iptal gerekçesiyle.
  const iptalli = page.getByRole("listitem").filter({ hasText: "Yıllık izin" });
  await expect(iptalli).toBeVisible();
  await expect(iptalli).toContainText("Sehven girildi");
  // İptal edilmiş kayıt ikinci kez iptal edilemez.
  await expect(
    iptalli.getByRole("button", { name: `${E2E_WORKER.fullName} kaydını iptal et` }),
  ).toHaveCount(0);
});

test("ekibi olmayan kullanıcı kimseye işaret koyamaz", async ({ page }) => {
  await loginAs(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/team/absence");

  await expect(page.getByText("Ekibinizde kullanıcı yok")).toBeVisible();
  await expect(page.getByRole("button", { name: "Kaydet" })).toHaveCount(0);
});
