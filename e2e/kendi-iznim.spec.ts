import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Kişinin kendi "faaliyet beklenmiyor" dönemi ve yönetici onayı.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("kişi kendi dönemini girer ve listesinde görür", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/absence");

  await page.getByLabel("Başlangıç").fill("2027-03-01");
  await page.getByLabel("Bitiş").fill("2027-03-05");
  // Not metni bilerek benzersiz: kişinin girdiği kayıt müdürün ekip
  // listesinde de görünüyor (doğru davranış) ve orada metinle filtreleyen
  // başka bir spec ile çakışmamalı.
  await page.getByLabel("Not (isteğe bağlı)").fill("Kendi girdiğim dönem");
  await page.getByRole("button", { name: "Kaydet" }).click();

  await expect(page.getByText(/Talebiniz gönderildi/)).toBeVisible();
  const satir = page
    .locator('[data-test="kendi-donem-satiri"]')
    .filter({ hasText: "01.03.2027" });
  await expect(satir).toBeVisible();
  // Kaydı kimin girdiği görünür: kendi mi, yöneticisi mi.
  await expect(satir.getByText("Kendim")).toBeVisible();
});

test("kişi kendi kaydını gerekçeyle iptal eder", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/absence");

  const satir = page
    .locator('[data-test="kendi-donem-satiri"]')
    .filter({ hasText: "01.03.2027" });
  await satir.getByRole("button", { name: "İptal et" }).click();
  await satir.getByLabel("İptal gerekçesi").fill("Tarihleri yanlış girdim");
  await satir.getByRole("button", { name: "Kaydı iptal et" }).click();

  // Kayıt silinmez, üstü çizili kalır.
  await expect(page.getByText("Tarihleri yanlış girdim")).toBeVisible();
});

test("uzun dönem reddedilir ve yöneticiye yönlendirilir", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/absence");

  // Varsayılan sınır 30 gün.
  await page.getByLabel("Başlangıç").fill("2027-05-01");
  await page.getByLabel("Bitiş").fill("2027-08-01");
  await page.getByRole("button", { name: "Kaydet" }).click();

  await expect(page.getByText(/yöneticiniz girebilir/)).toBeVisible();
});

test("müdürün ekip ekranı çalışmaya devam ediyor", async ({ page }) => {
  // §12.1'in mevcut yolu bozulmamalı: müdür hâlâ ekibi için girebiliyor.
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/team/absence");

  await expect(
    page.getByRole("heading", { name: "Faaliyet beklenmeyen günler ekle" }),
  ).toBeVisible();
});
