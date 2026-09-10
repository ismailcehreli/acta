import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_WORKER, e2ePassword } from "./global-setup";

// Ayarlanabilir metin sınırları (Görev 11.6).
//
// Sınır **sunucuda** uygulanıyor; formdaki `minLength` bir kolaylık. Test
// ayarı değiştirip formun ve sunucunun aynı sayıyı kullandığını gösteriyor.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function ayarla(page: Page, etiket: string, deger: string) {
  await dayanikliGoto(page, "/admin/settings/general");
  await page.getByLabel(etiket, { exact: true }).fill(deger);
  await page.getByRole("button", { name: "Ayarları kaydet" }).click();
}

test("çapraz doğrulama: en az, en çoktan büyük olamaz", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/settings/general");

  // İkisi de kendi sınırları içinde ama birbirine ters.
  await page.getByLabel("Başlık en az", { exact: true }).fill("80");
  await page.getByLabel("Başlık en çok", { exact: true }).fill("50");
  await page.getByRole("button", { name: "Ayarları kaydet" }).click();

  await expect(page.getByText(/en az.*en çok/i)).toBeVisible();
});

test("ayar yükseltilince form ve sunucu aynı sınırı uygular", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await ayarla(page, "Başlık en az", "15");

  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/activities/new");

  // Form sınırı gösteriyor.
  await expect(page.getByText("En az 15 karakter")).toBeVisible();

  // Alan `minLength` taşıyor: aynı sayı, tek kaynak.
  await expect(page.getByLabel("Başlık")).toHaveAttribute("minlength", "15");

  // Sunucu da aynı sınırı uyguluyor: kısa başlık reddediliyor.
  await page.getByLabel("Başlık").fill("Kısa");
  await page.getByLabel("Açıklama").fill("Yeterince uzun bir açıklama metni.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.evaluate(() => {
    // Tarayıcı doğrulamasını atla: sınanan şey **sunucunun** kararı.
    document.querySelector("form")?.setAttribute("novalidate", "true");
  });
  await page.getByRole("button", { name: "Gönder" }).click();

  await expect(page.getByText(/Başlık en az 15 karakter olmalı/)).toBeVisible();
});

test("sınır geri alınınca kısa başlık yeniden geçerli", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await ayarla(page, "Başlık en az", "1");

  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill("İK");
  await page.getByLabel("Açıklama").fill("Kısa başlık yeniden kabul ediliyor.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();

  await expect(page).toHaveURL(/kayit=eklendi/);
});
