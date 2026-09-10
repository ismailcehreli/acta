import { dayanikliGoto } from "./gezinme";
import { expect, test, type Browser, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_GM, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Reddetme (ürün sahibi kararı, 19.08.2026).
//
// Müdürün üçüncü seçeneği: kayıt düzeltmeyle kurtulmuyorsa kapatılır.
// Reddedilen kayıt **silinmez** ve **yukarı akmaz**.

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

async function faaliyetYaz(page: Page, baslik: string): Promise<void> {
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill(`${baslik} için açıklama.`);
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?/);
}

test("müdür reddeder; kayıt kapanır, yukarı akmaz, düzenlenemez", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Reddedilen ${suffix}`;

  const admin = await openAs(browser, E2E_ADMIN.email);
  const calisan = await openAs(browser, E2E_WORKER.email);
  const mudur = await openAs(browser, E2E_USER.email);
  const genelMudur = await openAs(browser, E2E_GM.email);

  try {
    await onayaTabiYap(admin, true);
    await faaliyetYaz(calisan, baslik);

    // Müdür kaydı açar ve reddeder.
    await dayanikliGoto(mudur, "/");
    const kutu = mudur.locator('[data-test="bana-dusenler"]');
    await expect(kutu).toContainText(baslik);
    await kutu.getByRole("link", { name: baslik }).click();

    await mudur.getByRole("button", { name: "Reddet" }).click();
    const retFormu = mudur.locator('[data-test="ret-formu"]');
    await retFormu
      .getByLabel("Ret gerekçesi")
      .selectOption({ label: "Mükerrer kayıt" });
    await retFormu
      .getByLabel("Açıklama (isteğe bağlı)")
      .fill("Aynı iş dün de yazılmıştı.");
    await retFormu.getByRole("button", { name: "Reddet" }).click();

    await expect(mudur.getByText("Uygun bulunmadı", { exact: true })).toBeVisible();

    // Onay kutusundan düşer. Kutunun tamamının kaybolmasını beklemiyoruz:
    // başka testlerin bıraktığı bekleyen kayıtlar da orada olabilir.
    await dayanikliGoto(mudur, "/");
    await expect(
      mudur.locator('[data-test="bana-dusenler"]').getByText(baslik),
    ).toHaveCount(0);

    // Yazan gerekçeyi görür.
    await dayanikliGoto(calisan, "/activities");
    const satir = calisan
      .locator('[data-test="faaliyet-satiri"]')
      .filter({ hasText: baslik });
    await expect(satir).toContainText("Uygun bulunmadı");
    await satir.getByRole("link", { name: baslik }).click();
    const retKarti = calisan.locator('[data-test="ret-gerekcesi"]');
    await expect(retKarti).toContainText("Mükerrer kayıt");
    await expect(retKarti).toContainText("Aynı iş dün de yazılmıştı.");
    const yol = calisan.url();

    // Genel Müdür göremez: reddedilen içerik yukarı akmıyor.
    await dayanikliGoto(genelMudur, `/search?q=${encodeURIComponent(String(suffix))}`);
    await expect(genelMudur.getByText(baslik)).toHaveCount(0);
    const yanit = await dayanikliGoto(genelMudur, yol);
    expect(yanit?.status()).toBe(404);

    // Yazan düzeltemez: reddetme son durumdur. Kendi eski bağlantısı 404'e
    // düşmez; neden kapandığını ve kayda dönüş yolunu açıkça görür.
    const duzeltme = await dayanikliGoto(calisan, `${yol}/edit`);
    expect(duzeltme?.status()).toBe(200);
    await expect(
      calisan.getByText(
        "Reddedilen faaliyet düzenlenemez. Gerekiyorsa yeni bir faaliyet yazın.",
      ),
    ).toBeVisible();
    await expect(calisan.getByRole("link", { name: "Faaliyete dön" })).toBeVisible();
  } finally {
    await onayaTabiYap(admin, false).catch(() => undefined);
    for (const page of [admin, calisan, mudur, genelMudur]) {
      await page.context().close();
    }
  }
});

test("sistem yöneticisi gerekçe kataloğunu yönetir", async ({ browser }) => {
  const admin = await openAs(browser, E2E_ADMIN.email);
  const suffix = String(Date.now()).slice(-6);
  const ad = `Deneme gerekçesi ${suffix}`;

  try {
    await dayanikliGoto(admin, "/admin/approval-reasons");

    // Satırlardaki düzenleme kutuları da "Gerekçe adı" diyor; ekleme formuna
    // daraltılır.
    const ekleme = admin.locator('[data-test="gerekce-ekle"]');
    await ekleme.getByLabel("Karar").selectOption("REJECTED");
    await ekleme.getByLabel("Gerekçe adı").fill(ad);
    await ekleme.getByRole("button", { name: "Gerekçe ekle" }).click();
    await expect(admin.getByText(`"${ad}" eklendi.`)).toBeVisible();

    // Pasifleştirilen gerekçe karar ekranında çıkmaz ama katalogda durur.
    const satir = admin.locator(`[data-gerekce="${ad}"]`);
    await satir.getByRole("button", { name: "Pasifleştir" }).click();
    await expect(
      admin.locator(`[data-gerekce="${ad}"]`).getByText("pasif"),
    ).toBeVisible();
  } finally {
    await admin.context().close();
  }
});
