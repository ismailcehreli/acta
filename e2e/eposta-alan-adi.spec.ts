import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, e2ePassword } from "./global-setup";

// E-posta alan adı kısıtı: ayar ekranından açılır, kullanıcı ekleme ekranında
// etkisini gösterir, kapatılınca etkisi kalkar.
//
// Ayar **ortak durumdur**; test bitiminde mutlaka boşaltılır, yoksa sonraki
// koşularda kullanıcı ekleyen testleri kırar.

test.describe.configure({ mode: "serial" });

const ALAN = "İzinli e-posta alan adları";

async function loginAsAdmin(page: Page): Promise<void> {
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(E2E_ADMIN.email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function kisitYaz(page: Page, deger: string): Promise<void> {
  await dayanikliGoto(page, "/admin/settings/accounts");
  await page.getByLabel(ALAN).fill(deger);
  await page.getByRole("button", { name: "Ayarları kaydet" }).click();
  // Değer zaten aynıysa "değişiklik yok" denir; ikisi de kaydın işlendiğini
  // gösterir.
  await expect(page.getByText(/ayar güncellendi|Değişiklik yok/)).toBeVisible();
  await expect(page.getByLabel(ALAN)).toHaveValue(deger);
}

test("kısıt dışındaki adrese hesap açılamaz, kısıt kalkınca açılır", async ({
  page,
}) => {
  await loginAsAdmin(page);

  try {
    await kisitYaz(page, "acme.com");

    const suffix = String(Date.now()).slice(-6);

    await dayanikliGoto(page, "/admin/users");
    await page.getByLabel("Ad soyad").fill(`Yanlış Alan ${suffix}`);
    await page.getByLabel("E-posta", { exact: true }).fill(`kisi-${suffix}@baska.test`);
    await page
      .getByLabel("Birim", { exact: true })
      .selectOption({ label: "Şirket" });
    await page.getByLabel("Başlangıç parolası").fill("baslangic-parolasi-1");
    await page.getByRole("button", { name: "Kullanıcı ekle" }).click();

    // Hata mesajı hangi alan adlarının kabul edildiğini söylemeli.
    await expect(page.locator("#kullanici-hatasi")).toContainText(
      "acme.com",
    );
    await expect(page.getByRole("cell", { name: `kisi-${suffix}@baska.test` })).toHaveCount(
      0,
    );
  } finally {
    // Kısıt her hâlükârda kaldırılır.
    await kisitYaz(page, "");
  }

  // Kısıt kalkınca aynı adres kabul edilir.
  const suffix = String(Date.now()).slice(-6);
  await dayanikliGoto(page, "/admin/users");
  await page.getByLabel("Ad soyad").fill(`Serbest Alan ${suffix}`);
  await page.getByLabel("E-posta", { exact: true }).fill(`serbest-${suffix}@baska.test`);
  await page.getByLabel("Birim", { exact: true }).selectOption({ label: "Şirket" });
  await page.getByLabel("Başlangıç parolası").fill("baslangic-parolasi-2");
  await page.getByRole("button", { name: "Kullanıcı ekle" }).click();

  await expect(page.locator("#kullanici-basarili")).toContainText("eklendi");
});
