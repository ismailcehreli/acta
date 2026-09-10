import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_WORKER, e2ePassword } from "./global-setup";

// Tarayıcı bildirimleri (Görev 5.3b).
//
// Gerçek push gönderimi tarayıcı otomasyonuyla sınanamaz (push servisi dış
// sistemdir). Burada sınanan **kurulum akışı**: anahtar yokken kullanıcıya ne
// söylendiği, sistem yöneticisinin anahtarı üretmesi ve ondan sonra düğmenin
// çıkması. Gerçek bildirim ürün sahibinin elle doğrulayacağı kalemdir.

test.describe.configure({ mode: "serial" });

// **Sınır:** bu ortamdaki Chromium bildirim iznini kesin olarak reddediyor
// (`Notification.permission === "denied"`); `grantPermissions` de değiştirmiyor.
// Firefox ve WebKit ise izni "sorulmamış" bırakıyor. Yani izin durumu
// tarayıcıdan tarayıcıya değişiyor ve testler ona **yaslanmaz**. "İzin
// verilmiş" dalı hiçbir tarayıcıda koşturulamıyor; buradaki testler onu
// koşturuyormuş gibi yapmıyor. Gerçek bildirim, planın "Bitti kanıtı"nda
// yazdığı gibi ürün sahibinin elle doğrulayacağı kalemdir.

async function girisYap(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function profilAc(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Hesap menüsü" }).click();
  await page.getByRole("menuitem", { name: "Profilim" }).click();
  await expect(page).toHaveURL(/\/users\//);
}

test("anahtar kurulmadan kullanıcıya ne yapması gerektiği söylenir", async ({
  page,
}) => {
  await girisYap(page, E2E_WORKER.email);
  await profilAc(page);

  // Sessiz bir boşluk değil, ne yapılacağını söyleyen bir uyarı olmalı.
  await expect(
    page.getByText("Tarayıcı bildirimleri henüz kurulmadı."),
  ).toBeVisible();
  await expect(page.locator('[data-test="push-anahtari"]')).toHaveCount(0);
});

test("sistem yöneticisi anahtar üretir; kullanıcının gördüğü değişir", async ({
  page,
}) => {
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/settings/delivery");

  // Ayar sayfasında birden çok form var; push bölümüne daraltılır.
  const form = page.locator('[data-test="push-kurulumu"]');
  await expect(form.getByText("Henüz kurulmadı.")).toBeVisible();

  await form.getByLabel("İletişim adresi", { exact: true }).fill("mailto:bt@ornek.test");
  await form.getByRole("button", { name: "Anahtar üret ve kur" }).click();
  await expect(form.getByText("Anahtar çifti üretildi.")).toBeVisible();

  // Kurulumdan sonra iletişim adresi **değiştirilebilmeli** ve bu anahtarlara
  // dokunmamalı (21.08.2026). Eskiden "Kaydet" düğmesi "zaten anahtar var"
  // diye reddediyordu; adresi değiştirmenin tek yolu bütün abonelikleri
  // öldüren "yenile" seçeneğiydi.
  await dayanikliGoto(page, "/admin/settings/delivery");
  const guncelForm = page.locator('[data-test="push-kurulumu"]');
  await expect(guncelForm.getByText(/Kurulu\. Şu an \d+ cihaz abone\./)).toBeVisible();

  await guncelForm.getByLabel("İletişim adresi", { exact: true }).fill("mailto:yeni-bt@ornek.test");
  await guncelForm.getByRole("button", { name: "Kaydet" }).click();
  await expect(guncelForm.getByText("İletişim adresi kaydedildi.")).toBeVisible();

  // Adres gerçekten kaydedilmiş ve sistem hâlâ kurulu olmalı.
  await dayanikliGoto(page, "/admin/settings/delivery");
  const sonForm = page.locator('[data-test="push-kurulumu"]');
  await expect(sonForm.getByLabel("İletişim adresi", { exact: true })).toHaveValue(
    "mailto:yeni-bt@ornek.test",
  );
  await expect(sonForm.getByText(/Kurulu\. Şu an \d+ cihaz abone\./)).toBeVisible();

  // Kurulum kullanıcının gördüğünü **değiştirmeli**: artık "kurulmadı"
  // uyarısı yok, karar tarayıcı iznine kalmış durumda.
  await girisYap(page, E2E_WORKER.email);
  await profilAc(page);
  await expect(
    page.getByText("Tarayıcı bildirimleri henüz kurulmadı."),
  ).toHaveCount(0);

  // **Hangi** karara kaldığı tarayıcıya göre değişir ve uygulamanın işi
  // değildir: Chromium bildirimi baştan reddediyor ("engellenmiş" dalı),
  // Firefox ve WebKit ise sormamış sayıyor ("bu cihazda aç" düğmesi).
  // Önceden burada yalnız Chromium'un dalı aranıyordu; test, uygulamanın
  // davranışını değil ortamın varsayılanını ölçüyordu (22.08.2026, Firefox
  // koşusunda yakalandı). Sınanan şey artık doğru olan: kurulumdan sonra
  // karar tarayıcıya geçmiş olmalı.
  await expect(
    page.locator('[data-test="push-anahtari"], [data-test="push-engellenmis"]'),
  ).toBeVisible();
});

test("geçersiz iletişim adresi reddedilir", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/settings/delivery");

  const form = page.locator('[data-test="push-kurulumu"]');
  await form.getByLabel("İletişim adresi", { exact: true }).fill("bt@ornek.test");
  await form.getByRole("button", { name: /Kaydet|Anahtar üret ve kur/ }).click();

  await expect(form.getByText(/mailto:/).first()).toBeVisible();
});
