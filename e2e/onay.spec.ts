import { dayanikliGoto } from "./gezinme";
import { expect, test, type Browser, type Page } from "./test-tabani";

import {
  E2E_ADMIN,
  E2E_GM,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

const PNG_ICERIK = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Onay akışı (§5.4, §8.2) — ürün sahibi kararıyla Sürüm 1'e alındı.
//
// Ağaç: Genel Müdürlük → Kalıphane (Deneme Müdürü + Kalıphane Çalışanı).
// Çalışanın onaylayıcısı Deneme Müdürü'dür; Genel Müdür onun üstüdür ve onay
// bitene kadar kaydı görmemelidir.

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function openAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, email);
  return page;
}

/** Kalıphane'yi onaya tabi yapar ya da geri alır. */
async function onayaTabiYap(page: Page, acik: boolean): Promise<void> {
  await dayanikliGoto(page, "/admin/org");
  // Satır adıyla seçilir: metin süzgeci "Taşı…" listesindeki adlara da
  // takılıyor ve yanlış birimi düzenletiyordu.
  const satir = page.locator('[data-birim="Kalıphane"]');
  await satir.getByRole("button", { name: "Düzenle" }).click();

  const form = satir.locator("form[data-test^='birim-duzenle-']");
  const kutu = form.getByRole("checkbox", {
    name: "Bu birimdeki faaliyetler onaya tabidir",
  });

  if (acik) await kutu.check();
  else await kutu.uncheck();

  await form.getByRole("button", { name: "Değişiklikleri kaydet" }).click();

  // Kaydın gerçekten yazıldığı **rozetten** doğrulanır. Önceki hâlinde form
  // kapanmasını bekleyip hatayı yutuyordum; bayrak hiç kaydedilmese bile test
  // devam ediyordu ve asıl hata çok sonra, anlamsız bir yerde patlıyordu.
  await dayanikliGoto(page, "/admin/org");
  const guncelSatir = page.locator('[data-birim="Kalıphane"]');
  if (acik) {
    await expect(guncelSatir.getByText("onaya tabi", { exact: true })).toBeVisible();
  } else {
    await expect(
      guncelSatir.getByText("onaya tabi", { exact: true }),
    ).toHaveCount(0);
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

test("onaya tabi birimde faaliyet müdürün önüne düşer, üst kademe görmez", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Onay akışı ${suffix}`;

  const admin = await openAs(browser, E2E_ADMIN.email);
  const calisan = await openAs(browser, E2E_WORKER.email);
  const mudur = await openAs(browser, E2E_USER.email);
  const genelMudur = await openAs(browser, E2E_GM.email);

  try {
    await onayaTabiYap(admin, true);

    await faaliyetYaz(calisan, baslik);

    // Yazan kendi kaydını görür ve durumu bilir.
    await dayanikliGoto(calisan, "/activities");
    const satir = calisan
      .locator('[data-test="faaliyet-satiri"]')
      .filter({ hasText: baslik });
    await expect(satir).toContainText("Onay bekliyor");

    // Onaylayıcı henüz kaydı okumadan yazar aynı faaliyet maddesine döner;
    // kullanıcı geri bildirimindeki fotoğraf yükleme de gerçek form yolunda
    // sınanır.
    await expect(
      satir.getByRole("link", { name: "Düzelt", exact: true }),
    ).toBeVisible();
    await satir.getByRole("link", { name: "Düzelt", exact: true }).click();
    await expect(
      calisan.getByRole("heading", { name: "Faaliyeti düzelt" }),
    ).toBeVisible();
    await calisan
      .getByLabel("Açıklama")
      .fill("Onaydan önce fotoğraf da eklendi.");
    await calisan.getByLabel(/^Ekler/).setInputFiles({
      name: "onay-oncesi-fotograf.png",
      mimeType: "image/png",
      buffer: PNG_ICERIK,
    });
    await expect(calisan.locator('[data-test="ek-sayac"]')).toContainText("1/5");
    await calisan.getByRole("button", { name: "Değişikliği kaydet" }).click();
    await expect(calisan).toHaveURL(/\/activities\?kayit=duzeltildi$/);

    // Müdürün ana ekranında onay kutusu var.
    await dayanikliGoto(mudur, "/");
    const kutu = mudur.locator('[data-test="bana-dusenler"]');
    await expect(kutu).toBeVisible();
    await expect(kutu).toContainText(baslik);

    // Genel Müdür göremez: süzülmemiş içerik yukarı akmıyor (§8.2).
    await dayanikliGoto(genelMudur, "/");
    await expect(genelMudur.getByText(baslik)).toHaveCount(0);
    await dayanikliGoto(genelMudur, `/search?q=${encodeURIComponent(String(suffix))}`);
    await expect(genelMudur.getByText(baslik)).toHaveCount(0);

    // Müdür düzeltme ister.
    await kutu.getByRole("link", { name: baslik }).click();
    await expect(mudur.locator('[data-test="onay-paneli"]')).toBeVisible();
    await mudur.getByRole("button", { name: "Düzeltme iste" }).click();
    const duzeltmeFormu = mudur.locator('[data-test="duzeltme-formu"]');
    // Gerekçe **kategori** olarak seçilir; açıklama isteğe bağlıdır
    // (ürün sahibi kararı, 19.08.2026).
    await duzeltmeFormu
      .getByLabel("Düzeltme gerekçesi")
      .selectOption({ label: "Eksik bilgi" });
    await duzeltmeFormu
      .getByLabel("Açıklama (isteğe bağlı)")
      .fill("Hangi kalıplar olduğunu yaz.");
    await duzeltmeFormu.getByRole("button", { name: "Düzeltme iste" }).click();
    // `exact`: kart başlığı da "Düzeltme istendi" diyor; kastedilen rozet.
    await expect(
      mudur.getByText("Düzeltme istendi", { exact: true }),
    ).toBeVisible();

    // Yazan gerekçeyi ekranında görür.
    await dayanikliGoto(calisan, "/activities");
    await calisan
      .locator('[data-test="faaliyet-satiri"]')
      .filter({ hasText: baslik })
      .getByRole("link", { name: baslik })
      .click();
    const gerekce = calisan.locator('[data-test="duzeltme-gerekcesi"]');
    await expect(gerekce).toContainText("Eksik bilgi");
    await expect(gerekce).toContainText("Hangi kalıplar olduğunu yaz.");

    // Düzeltip kaydeder; iş yeniden müdüre düşer.
    await gerekce.getByRole("link", { name: "Düzelt" }).click();
    await calisan
      .getByLabel("Açıklama")
      .fill("Üç numaralı kalıpta erken aşınma tespit edildi.");
    await calisan.getByRole("button", { name: "Değişikliği kaydet" }).click();
    await expect(calisan).toHaveURL(/\/activities\?/);

    // Müdür onaylar.
    await dayanikliGoto(mudur, "/");
    await mudur
      .locator('[data-test="bana-dusenler"]')
      .getByRole("link", { name: baslik })
      .click();
    await mudur.getByRole("button", { name: "Onayla" }).click();
    await expect(mudur.getByText("onay bekliyor")).toHaveCount(0);

    // Artık Genel Müdür görüyor.
    await dayanikliGoto(genelMudur, `/search?q=${encodeURIComponent(String(suffix))}`);
    await expect(genelMudur.getByText(baslik).first()).toBeVisible();
  } finally {
    // Kurulum bozulmasın: bayrak geri alınır.
    await onayaTabiYap(admin, false).catch(() => undefined);
    for (const page of [admin, calisan, mudur, genelMudur]) {
      await page.context().close();
    }
  }
});

test("onayı kendine düşmeyen kişi onay panelini göremez", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Panel gizli ${suffix}`;

  const admin = await openAs(browser, E2E_ADMIN.email);
  const calisan = await openAs(browser, E2E_WORKER.email);
  const genelMudur = await openAs(browser, E2E_GM.email);

  try {
    await onayaTabiYap(admin, true);
    await faaliyetYaz(calisan, baslik);

    // Önce kurulumun gerçekten çalıştığı doğrulanır: kayıt onay bekliyor
    // olmalı. Bu satır olmadan aşağıdaki iddialar onaylı bir kayıtta da
    // geçerdi ve test hiçbir şey kanıtlamazdı.
    await dayanikliGoto(calisan, "/activities");
    const satir = calisan
      .locator('[data-test="faaliyet-satiri"]')
      .filter({ hasText: baslik });
    await expect(satir).toContainText("Onay bekliyor");

    // Yazan kendi kaydını açar; panel ona çıkmaz (onaylayıcı değil).
    await satir.getByRole("link", { name: baslik }).click();
    await expect(calisan.locator('[data-test="onay-paneli"]')).toHaveCount(0);

    // Adresin gerçekten detay sayfası olduğu doğrulanır: tıklama yönlendirme
    // yapmasaydı aşağıdaki 404 iddiası liste sayfasına bakar ve anlamsız
    // biçimde 200 görürdü.
    await expect(calisan).toHaveURL(/\/activities\/[0-9a-f-]{36}$/);
    const yol = calisan.url();

    // Genel Müdür adresi doğrudan denese bile kaydı hiç göremez.
    const yanit = await dayanikliGoto(genelMudur, yol);
    expect(yanit?.status()).toBe(404);
  } finally {
    await onayaTabiYap(admin, false).catch(() => undefined);
    for (const page of [admin, calisan, genelMudur]) {
      await page.context().close();
    }
  }
});
