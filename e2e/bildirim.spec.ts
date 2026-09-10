import { dayanikliGoto } from "./gezinme";
import { expect, test, type Browser, type Page } from "./test-tabani";

import { E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Uygulama içi bildirim (Görev 10.4).
//
// Sınanan asıl şey: çalışan faaliyet yazınca **müdürün açık ekranında**
// bildirim beliriyor mu — sayfayı yenilemesine gerek kalmadan (Görev 7.3'teki
// gerçek zamanlı akış üzerinden).

test.describe.configure({ mode: "serial" });

async function openAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

async function onayaTabiYap(page: Page, acik: boolean): Promise<void> {
  await dayanikliGoto(page, "/admin/org");
  const satir = page.locator('[data-birim="Kalıphane"]');
  await satir.getByRole("button", { name: "Düzenle" }).click();
  const form = satir.locator("form[data-test^='birim-duzenle-']");
  const kutu = form.getByRole("checkbox", {
    name: "Bu birimdeki faaliyetler onaya tabidir",
  });
  if (acik) await kutu.check();
  else await kutu.uncheck();
  await form.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await dayanikliGoto(page, "/admin/org");
  const guncel = page.locator('[data-birim="Kalıphane"]');
  if (acik) {
    await expect(guncel.getByText("onaya tabi", { exact: true })).toBeVisible();
  } else {
    await expect(guncel.getByText("onaya tabi", { exact: true })).toHaveCount(0);
  }
}

test("zil boşken kutu açılır ve ne olduğunu söyler", async ({ browser }) => {
  const page = await openAs(browser, E2E_WORKER.email);

  try {
    await expect(page.getByRole("button", { name: "Bildirimler" })).toBeVisible();
    await page.getByRole("button", { name: "Bildirimler" }).click();

    // Boş kutu **sessiz kalmaz**: ne olduğu ve ne zaman dolacağı yazar.
    await expect(page.getByText("Kutunuz boş")).toBeVisible();
    await expect(page.getByText("Henüz bildiriminiz yok.")).toBeVisible();
  } finally {
    await page.context().close();
  }
});

// 21.08.2026: omurganın altındaki zil aşağı açılıyordu ve kutu ekranın
// dışında kalıyordu — bildirim vardı, kullanıcı hiçbir şey göremiyordu.
// Hesap menüsünde aynı hata daha önce görülüp düzeltilmişti.
test("zil kutusu ekranın içinde açılır", async ({ browser }) => {
  const page = await openAs(browser, E2E_USER.email);

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await dayanikliGoto(page, "/");
    await page.getByRole("button", { name: "Bildirimler" }).first().click();

    const kutu = page.getByRole("menu").first();
    await expect(kutu).toBeVisible();

    const olcu = await kutu.boundingBox();
    expect(olcu).not.toBeNull();
    // Kutunun altı ekranın altını aşmamalı; aşarsa içerik görünmez.
    expect(olcu!.y + olcu!.height).toBeLessThanOrEqual(900);
    expect(olcu!.y).toBeGreaterThanOrEqual(0);
  } finally {
    await page.context().close();
  }
});

test("faaliyet onaya düşünce müdürün ekranında bildirim belirir", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Bildirim denemesi ${suffix}`;

  const admin = await openAs(browser, "e2e-admin@ornek.test");
  const calisan = await openAs(browser, E2E_WORKER.email);
  const mudur = await openAs(browser, E2E_USER.email);

  try {
    await onayaTabiYap(admin, true);

    // Müdür ana ekranda **duruyor**; sayfayı yenilemeyecek.
    await dayanikliGoto(mudur, "/");
    await expect(mudur.getByRole("button", { name: "Bildirimler" })).toBeVisible();

    await dayanikliGoto(calisan, "/activities/new");
    await calisan.getByLabel("Başlık").fill(baslik);
    await calisan.getByLabel("Açıklama").fill("Müdüre bildirim gitmeli.");
    await calisan.getByRole("button", { name: "Gönder" }).click();
    await expect(calisan).toHaveURL(/\/activities\?kayit=eklendi$/);

    // Gerçek zamanlı akış müdürün ekranını tazeler; anlık kutucuk belirir.
    await expect(mudur.locator('[data-test="bildirim-kutucugu"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(mudur.locator('[data-test="bildirim-kutucugu"]')).toContainText(
      "Onayınızı bekleyen",
    );

    // Zil de sayıyor ve listede duruyor.
    await mudur.getByRole("button", { name: "Bildirimler" }).click();
    await expect(mudur.locator('[data-test="bildirim-listesi"]')).toContainText(
      "Onayınızı bekleyen",
    );
  } finally {
    await onayaTabiYap(admin, false).catch(() => undefined);
    for (const page of [admin, calisan, mudur]) await page.context().close();
  }
});

test("zil açılınca bildirimler görüldü sayılır", async ({ browser }) => {
  test.setTimeout(120_000);
  const mudur = await openAs(browser, E2E_USER.email);

  try {
    await dayanikliGoto(mudur, "/");
    const zil = mudur.getByRole("button", { name: "Bildirimler" });

    // Önceki testten kalan bildirimler var; kutu açılınca sayı sıfırlanmalı.
    await zil.click();
    await expect(mudur.locator('[data-test="bildirim-listesi"]')).toBeVisible();

    await dayanikliGoto(mudur, "/");
    await zil.click();
    // Kutu boş değil, **yenisi** yok: başlık ikisini ayırmalı. Önce yalnız
    // "yeni" sayısına bakıyordu ve dolu kutuda "Yeni bildirim yok" yazıp
    // kullanıcıyı yanıltıyordu.
    await expect(mudur.getByText(/bildirim · yenisi yok/)).toBeVisible();
    await expect(mudur.locator('[data-test="bildirim-listesi"]')).toBeVisible();
  } finally {
    await mudur.context().close();
  }
});

test("başkasının bildirimi görünmez", async ({ browser }) => {
  const calisan = await openAs(browser, E2E_WORKER.email);

  try {
    await dayanikliGoto(calisan, "/");
    await calisan.getByRole("button", { name: "Bildirimler" }).click();

    // Müdüre giden "onayınızı bekliyor" bildirimi çalışanın zilinde olmamalı.
    await expect(calisan.getByText("Onayınızı bekleyen")).toHaveCount(0);
  } finally {
    await calisan.context().close();
  }
});

test("kişi bildirim tercihini kendi profilinden değiştirir", async ({ browser }) => {
  const page = await openAs(browser, E2E_WORKER.email);

  try {
    await page.getByRole("button", { name: "Hesap menüsü" }).click();
    await page.getByRole("menuitem", { name: "Profilim" }).click();
    await expect(page).toHaveURL(/\/users\//);

    const form = page.locator('[data-test="bildirim-tercihi"]');
    await expect(form).toBeVisible();
    // Varsayılan anlık.
    await expect(form.getByRole("radio", { name: /Anlık/ })).toBeChecked();

    await form.getByRole("radio", { name: /Yalnız benden işlem isteyenler/ }).check();
    await form.getByRole("button", { name: "Tercihi kaydet" }).click();
    await expect(form.getByText("Bildirim tercihiniz kaydedildi.")).toBeVisible();

    // Kalıcı: sayfa yeniden açıldığında seçim duruyor.
    await page.reload();
    await expect(
      page
        .locator('[data-test="bildirim-tercihi"]')
        .getByRole("radio", { name: /Yalnız benden işlem isteyenler/ }),
    ).toBeChecked();
  } finally {
    await page.context().close();
  }
});

test("başkasının profilinde bildirim tercihi görünmez", async ({ browser }) => {
  test.setTimeout(120_000);
  const calisan = await openAs(browser, E2E_WORKER.email);
  const mudur = await openAs(browser, E2E_USER.email);

  try {
    // Çalışanın profil adresi alınır.
    await calisan.getByRole("button", { name: "Hesap menüsü" }).click();
    await calisan.getByRole("menuitem", { name: "Profilim" }).click();
    await expect(calisan).toHaveURL(/\/users\//);
    const adres = calisan.url();

    // Müdür astının profilini görebiliyor…
    await dayanikliGoto(mudur, adres);
    await expect(mudur.getByRole("heading", { name: "Kalıphane Çalışanı" })).toBeVisible();

    // …ama onun bildirim tercihini değiştiremez. Başkasının bildirimlerini
    // sessizce kapatan bir ekran, onu kendi işinden habersiz bırakırdı.
    await expect(mudur.locator('[data-test="bildirim-tercihi"]')).toHaveCount(0);
    await expect(mudur.locator('[data-test="push-anahtari"]')).toHaveCount(0);
  } finally {
    for (const page of [calisan, mudur]) await page.context().close();
  }
});
