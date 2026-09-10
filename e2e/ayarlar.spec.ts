import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// Sistem ayarları (§16.5): parametreler ekrandan değişir, kod okumak gerekmez.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("sistem yöneticisi ayarı değiştirir ve değer kalıcı olur", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/settings/approval");

  await expect(
    page.getByRole("heading", { name: "Onay ve takip ayarları" }),
  ).toBeVisible();

  const alan = page.getByLabel("Cevapsızlık hatırlatması");
  await expect(alan).toHaveValue("3");

  await alan.fill("5");
  await page.getByRole("button", { name: "Ayarları kaydet" }).click();
  await expect(page.getByText("1 ayar güncellendi")).toBeVisible();

  // Sayfa yeniden açıldığında yeni değer görünür.
  await dayanikliGoto(page, "/admin/settings/approval");
  await expect(page.getByLabel("Cevapsızlık hatırlatması")).toHaveValue("5");

  // Eski değere döndürülür ki diğer testler etkilenmesin.
  await page.getByLabel("Cevapsızlık hatırlatması").fill("3");
  await page.getByRole("button", { name: "Ayarları kaydet" }).click();
  await expect(page.getByText("1 ayar güncellendi")).toBeVisible();
});

test("onay sonrası düzeltme süresi arayüzden tanımlanır", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/settings/general");

  const alan = page.getByLabel("Düzeltme penceresi");
  await expect(alan).toHaveValue("15");

  await alan.fill("30");
  await page.getByRole("button", { name: "Ayarları kaydet" }).click();
  await expect(page.getByText("1 ayar güncellendi")).toBeVisible();
  await dayanikliGoto(page, "/admin/settings/general");
  await expect(page.getByLabel("Düzeltme penceresi")).toHaveValue("30");

  // Diğer testler için ürün sahibinin onayladığı varsayılan değer korunur.
  await page.getByLabel("Düzeltme penceresi").fill("15");
  await page.getByRole("button", { name: "Ayarları kaydet" }).click();
  await expect(page.getByText("1 ayar güncellendi")).toBeVisible();
});

test("sınır dışı değer reddedilir ve hiçbir ayar yazılmaz", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/settings/approval");

  // Tarayıcı doğrulamasını atlatmak için alanın min/max kısıtı kaldırılır:
  // asıl kontrol sunucudadır, ekranın gizlemesi güvenlik değildir.
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      'input[name="overdue_answer_business_days"]',
    );
    if (input) {
      input.removeAttribute("min");
      input.removeAttribute("max");
      input.value = "999";
    }
  });

  await page.getByRole("button", { name: "Ayarları kaydet" }).click();
  await expect(page.getByText("en fazla 30 olabilir")).toBeVisible();

  // Değer yazılmamış olmalı.
  await dayanikliGoto(page, "/admin/settings/approval");
  await expect(page.getByLabel("Cevapsızlık hatırlatması")).toHaveValue("3");
});

test("sistem yöneticisi olmayan ayarları göremez", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/admin/settings");

  await expect(page.getByRole("heading", { name: "Bu sayfayı görüntüleyemezsiniz" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ayarları kaydet" })).toHaveCount(0);
});

test("SMTP ayarları ekrandan kaydedilir, parola geri gösterilmez", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/settings/delivery");

  await expect(
    page.getByRole("heading", { name: "E-posta gönderimi (SMTP)" }),
  ).toBeVisible();

  await page.getByLabel("Sunucu adresi").fill("posta.uctan-uca.test");
  await page.getByLabel("Port", { exact: true }).fill("2525");
  await page.getByLabel("Gönderen adresi").fill("faaliyet@uctan-uca.test");
  await page.locator('input[name="password"]').fill("gizli-uctan-uca");
  await page.getByRole("button", { name: "SMTP ayarlarını kaydet" }).click();

  await expect(page.getByText("SMTP ayarları kaydedildi")).toBeVisible();

  // Sayfa yeniden açıldığında değerler duruyor ama parola alanı **boş**.
  await dayanikliGoto(page, "/admin/settings/delivery");
  await expect(page.getByLabel("Sunucu adresi")).toHaveValue("posta.uctan-uca.test");
  await expect(page.getByLabel("Port", { exact: true })).toHaveValue("2525");
  await expect(page.locator('input[name="password"]')).toHaveValue("");
  await expect(page.getByText("Kayıtlı. Değiştirmiyorsanız boş bırakın.")).toBeVisible();

  // Sayfa kaynağında parola hiç geçmemeli.
  const icerik = await page.content();
  expect(icerik).not.toContain("gizli-uctan-uca");

  // Kurulum bozulmasın: parola silinir. Silme sonrası düğme listeden kalkar;
  // başarı mesajını gösterecek bileşen de onunla gittiği için kanıt, düğmenin
  // kaybolması ve alanın "kayıtlı değil" demesidir.
  await page.getByRole("button", { name: "Kayıtlı parolayı sil" }).click();
  await expect(page.getByText("Kayıtlı değil.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Kayıtlı parolayı sil" }),
  ).toHaveCount(0);
});
