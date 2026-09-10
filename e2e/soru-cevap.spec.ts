import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import {
  E2E_ADMIN,
  E2E_GM,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// §9: soru sor → cevapla → kapat akışı, gerçek kullanıcılarla.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function writeActivity(page: Page, title: string): Promise<string> {
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(title);
  await page.getByLabel("Açıklama").fill(`${title} için açıklama.`);
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const link = page
    .locator('[data-test="faaliyet-satiri"]')
    .filter({ hasText: title })
    .getByRole("link", { name: title, exact: false });
  const href = await link.getAttribute("href");
  return href as string;
}

test("soru sor, cevapla, kapat", async ({ page, browser }) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Soru akışı ${suffix}`;
  const kalipBasligi = baslik;

  // Kalıphane çalışanı faaliyet yazar.
  await loginAs(page, E2E_WORKER.email);
  const detayUrl = await writeActivity(page, baslik);

  // Üst kademe (Kalıphane Müdürü) soru sorar.
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, detayUrl);
  await expect(page.getByRole("heading", { name: baslik })).toBeVisible();

  await page.getByLabel("Soru sor").fill("Bu sorun neden üç haftadır sürüyor?");
  await page.getByRole("button", { name: "Soruyu gönder" }).click();
  await expect(page.getByText("Bu sorun neden üç haftadır sürüyor?")).toBeVisible();
  // Sıra faaliyeti yazan kişidedir.
  await expect(page.getByText(`sıra: ${E2E_WORKER.fullName}`)).toBeVisible();

  // Yazan kişi cevaplar; sorumluluk sorana geçer.
  const yazarOturumu = await browser.newContext();
  try {
    const yazarSayfasi = await yazarOturumu.newPage();
    await loginAs(yazarSayfasi, E2E_WORKER.email);

    // Soru, yazanın "bana düşenler" listesinde iş olarak görünür (§9.4).
    // Tek iş kuyruğuna geçildi (Görev 10.5): satır artık ne yapılacağını
    // ("Cevapla") ve kimden geldiğini söylüyor.
    await expect(
      yazarSayfasi.locator('[data-test="is-satiri"][data-tur="answer"]').first(),
    ).toBeVisible();
    await expect(
      yazarSayfasi.getByRole("link", { name: kalipBasligi, exact: false }).first(),
    ).toBeVisible();

    await dayanikliGoto(yazarSayfasi, detayUrl);
    await yazarSayfasi
      .getByPlaceholder("Cevabınızı yazın")
      .fill("Yedek parça bekleniyor, 12 Eylül'de gelecek.");
    await yazarSayfasi.getByRole("button", { name: "Gönder" }).click();

    await expect(yazarSayfasi.getByText("Yedek parça bekleniyor", { exact: false })).toBeVisible();
    await expect(yazarSayfasi.getByText(`sıra: ${E2E_USER.fullName}`)).toBeVisible();

    // Sorumlu konuşmayı kapatamaz (§9.3).
    await yazarSayfasi.getByRole("button", { name: "Konuşmayı kapat" }).click();
    await expect(
      yazarSayfasi.getByText("Sorunun sorumlusu konuşmayı kapatamaz", { exact: false }),
    ).toBeVisible();
  } finally {
    await yazarOturumu.close();
  }

  // Soran kapatır.
  await dayanikliGoto(page, detayUrl);
  await page.getByRole("button", { name: "Konuşmayı kapat" }).click();
  await expect(page.locator("li[data-durum='kapali']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Konuşmayı kapat" })).toHaveCount(0);
});

test("ara kademe konuşmayı görür ama akran faaliyeti hiç göremez", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Ara kademe ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  const detayUrl = await writeActivity(page, baslik);

  // Genel Müdür soru sorar.
  await loginAs(page, E2E_GM.email);
  await dayanikliGoto(page, detayUrl);
  await page.getByLabel("Soru sor").fill("Genel Müdür sorusu");
  await page.getByRole("button", { name: "Soruyu gönder" }).click();
  await expect(page.getByText("Genel Müdür sorusu")).toBeVisible();

  const digerOturum = await browser.newContext();
  try {
    const sayfa = await digerOturum.newPage();

    // Ara kademe (Kalıphane Müdürü) konuşmayı görür (§9.4).
    await loginAs(sayfa, E2E_USER.email);
    await dayanikliGoto(sayfa, detayUrl);
    await expect(sayfa.getByText("Genel Müdür sorusu")).toBeVisible();

    // Akran (Planlama Müdürü) faaliyeti hiç göremez (§8.1).
    await loginAs(sayfa, E2E_PLANNER.email);
    const cevap = await dayanikliGoto(sayfa, detayUrl);
    expect(cevap?.status()).toBe(404);
    await expect(sayfa.getByText("Genel Müdür sorusu")).toHaveCount(0);
  } finally {
    await digerOturum.close();
  }
});


// §9.4: soru cevaplanana kadar hem soranın hem sorumlunun listesinde durur.
// Excel'de eksik olan tek şey buydu.
test("açık soru iki tarafın da ana ekranında görünür", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `İki taraf ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  const detayUrl = await writeActivity(page, baslik);

  // Müdür soru sorar.
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, detayUrl);
  await page.getByLabel("Soru sor").fill("Bu konu ne durumda?");
  await page.getByRole("button", { name: "Soruyu gönder" }).click();
  await expect(page.getByText("Bu konu ne durumda?")).toBeVisible();

  // Soran, ana ekranında **izlenenler** bölümünde görür: sıra kendisinde
  // değil, ama takip ediyor (Görev 10.5).
  await dayanikliGoto(page, "/");
  await expect(page.getByText("İzlediklerim")).toBeVisible();
  await expect(
    page.locator('[data-test="izlenen-satiri"]').filter({ hasText: baslik }),
  ).toBeVisible();
  // Başlık hem iş listesinde hem kapsam akışında görünebilir; iş listesindeki
  // satır aranıyor.
  await expect(
    page.getByRole("link", { name: baslik, exact: false }).first(),
  ).toBeVisible();

  // Yazan, aynı işi "cevabımı bekliyor" tarafında görür.
  const yazarOturum = await browser.newContext();
  try {
    const yazar = await yazarOturum.newPage();
    await loginAs(yazar, E2E_WORKER.email);
    await expect(
      yazar.locator('[data-test="is-satiri"][data-tur="answer"]').first(),
    ).toBeVisible();
    await expect(
      yazar.getByRole("link", { name: baslik, exact: false }).first(),
    ).toBeVisible();

    // Yazan cevaplayınca roller yer değiştirir.
    await dayanikliGoto(yazar, detayUrl);
    await yazar.getByPlaceholder("Cevabınızı yazın").fill("Tamamlandı.");
    await yazar.getByRole("button", { name: "Gönder" }).click();
    await expect(yazar.getByText("Tamamlandı.")).toBeVisible();

    await dayanikliGoto(yazar, "/");
    // Sıra karşı tarafa geçti: iş kuyruğundan çıkıp izlenenlere düştü.
    await expect(yazar.locator('[data-test="izlenenler"]')).toBeVisible();
  } finally {
    await yazarOturum.close();
  }

  await dayanikliGoto(page, "/");
  await expect(
    page.locator('[data-test="is-satiri"][data-tur="answer"]').first(),
  ).toBeVisible();
});

// Plan açık soru 12 (ürün sahibi kararı 18.08.2026): idari kapatmanın yeri
// pasifleştirme akışıdır. Sistem yöneticisi faaliyet içeriğini göremez (§15.1),
// bu yüzden konuşmayı detay ekranından kapatamaz; kilit de burada doğuyor
// (§4.6 açık konuşması olan kullanıcıyı pasifleştirtmiyor).
test("sistem yöneticisi açık konuşmayı gerekçeyle kapatıp kullanıcıyı pasifleştirir", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `ayrilan-${suffix}@ornek.test`;
  const password = `baslangic-${suffix}-parola`;
  const adSoyad = `Ayrılan Kişi ${suffix}`;
  const baslik = `Ayrılık akışı ${suffix}`;

  // Kalıphane'ye yeni bir çalışan eklenir.
  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/users");
  await page.getByLabel("Ad soyad").fill(adSoyad);
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  // Seçenek etiketleri ağaç derinliğine göre girintili ("— — Kalıphane");
  // etiketi elle yazmak yerine değeri seçenekten okunur.
  const kaliphaneDegeri = await page
    .locator("#orgUnitId option")
    .filter({ hasText: "Kalıphane" })
    .first()
    .getAttribute("value");
  await page.getByLabel("Birim", { exact: true }).selectOption(kaliphaneDegeri!);
  await page.getByLabel("Başlangıç parolası").fill(password);
  await page.getByRole("button", { name: "Kullanıcı ekle" }).click();
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  const calisanOturumu = await browser.newContext();
  try {
    const calisanSayfasi = await calisanOturumu.newPage();
    await dayanikliGoto(calisanSayfasi, "/login");
    await calisanSayfasi.getByLabel("E-posta", { exact: true }).fill(email);
    await calisanSayfasi.getByLabel("Parola", { exact: true }).fill(password);
    await calisanSayfasi.getByRole("button", { name: "Giriş yap" }).click();
    await expect(calisanSayfasi).toHaveURL(/\/$/);

    const detayUrl = await writeActivity(calisanSayfasi, baslik);

    // Müdürü soru sorar: konuşma açık kalır.
    const mudurOturumu = await browser.newContext();
    try {
      const mudurSayfasi = await mudurOturumu.newPage();
      await loginAs(mudurSayfasi, E2E_USER.email);
      await dayanikliGoto(mudurSayfasi, detayUrl);
      await mudurSayfasi.getByLabel("Soru sor").fill("Bu iş tamamlandı mı?");
      await mudurSayfasi.getByRole("button", { name: "Soruyu gönder" }).click();
      await expect(mudurSayfasi.getByText("Bu iş tamamlandı mı?")).toBeVisible();
    } finally {
      await mudurOturumu.close();
    }
  } finally {
    await calisanOturumu.close();
  }

  // Pasifleştirme engellenir ve sebebi ekranda görünür.
  await dayanikliGoto(page, "/admin/users");
  const satir = page.getByRole("row").filter({ hasText: email });
  await satir.getByRole("button", { name: "Pasifleştir" }).click();
  await expect(satir.getByRole("alert")).toContainText("açık konuşma");

  // Gerekçesiz kapatma denemesi tarayıcıda da geçmez: alan zorunludur.
  await expect(satir.getByLabel("Kapatma gerekçesi")).toBeVisible();
  await satir.getByLabel("Kapatma gerekçesi").fill("Kişi işten ayrıldı.");
  await satir.getByRole("button", { name: "Açık konuşmaları kapat" }).click();
  await expect(satir.getByText("1 konuşma gerekçeyle kapatıldı")).toBeVisible();

  // Artık pasifleştirilebilir. Durum hücresine bakılır: "Pasifleştir" butonu
  // da "pasif" kelimesini içerir ve satır metnine bakmak yanıltıcı olurdu.
  await page.getByRole("row").filter({ hasText: email }).getByRole("button", {
    name: "Pasifleştir",
  }).click();
  await expect(
    page.getByRole("row").filter({ hasText: email }).locator("[data-durum]"),
  ).toHaveText("pasif");
});
