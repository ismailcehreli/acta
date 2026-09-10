import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// Faaliyet silme ekranının **yetki kapısı** (karar 03.09.2026, açık soru 25).
//
// Silme yalnız ana sistem yöneticisine (root) açıktır. Buradaki iddia dar ama
// kritik: sistem yöneticisi olmak yetmiyor. Kapı sayfanın kendisinde de
// sorulduğu için menüde görünmemek tek başına koruma sayılmıyor — bu test
// ikisini birden ölçüyor.
//
// Silmenin **kendisi** (kod üretimi, dönem sınırı, bağlı kayıtların gitmesi,
// denetim izinin kalması) servis testlerinde uçtan uca sınanıyor
// (`tests/activities/delete.test.ts`); orada gerçek veritabanı kapısı da
// devrede.

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("root olmayan sistem yöneticisi silme ekranını açamaz", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);

  await dayanikliGoto(page, "/admin/faaliyet-silme");

  await expect(
    page.getByText("Faaliyet silme yalnız ana sistem yöneticisine açıktır."),
  ).toBeVisible();
  // Silme akışının hiçbir parçası çizilmemeli.
  await expect(page.getByRole("button", { name: "Silme kodu gönder" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Kaydı kalıcı olarak sil" }),
  ).toHaveCount(0);
});

test("yönetim şeridinde silme bağlantısı root olmayana görünmez", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);

  await dayanikliGoto(page, "/admin/org");

  const serit = page.getByRole("navigation", { name: "Yönetim bölümleri" });
  await expect(serit).toBeVisible();
  await expect(serit.getByRole("link", { name: "Faaliyet silme" })).toHaveCount(0);
});

test("sistem yöneticisi olmayan kullanıcı da giremez", async ({ page }) => {
  await girisYap(page, E2E_USER.email);

  await dayanikliGoto(page, "/admin/faaliyet-silme");

  await expect(
    page.getByText("Faaliyet silme yalnız ana sistem yöneticisine açıktır."),
  ).toBeVisible();
});
