import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_PLANNER, E2E_WORKER, e2ePassword } from "./global-setup";

const PNG_ICERIK = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Taslaklar — gönderilmemiş kayıtlar (21.08.2026).
//
// Ürün sahibinin tarif ettiği iki durum:
//
//   1. **Bilerek bekletme** — "yazdım ama son bir kontrol edeyim".
//   2. **Kazara kalma** — pencere kapandı, yazdıkları çöpe gitmesin.
//
// İkisi de aynı listede toplanır; kullanıcı gönderir ya da siler.
//
// Sınanan asıl şey, taslağın **kimseye görünmemesi**: gönderilene kadar
// ortada bir faaliyet yoktur ve yöneticinin akışında da çıkmamalıdır.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

const BASLIK = `Taslak denemesi ${String(Date.now()).slice(-6)}`;

test("kullanıcı taslak olarak kaydeder ve listede görür", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(BASLIK);
  await page
    .getByLabel("Açıklama")
    .fill("Henüz bitmedi; rakamları teyit edip göndereceğim.");

  await page.getByRole("button", { name: "Taslak olarak kaydet" }).click();

  await expect(page).toHaveURL(/\/drafts\?kayit=taslak$/);
  await expect(page.locator("#taslak-bilgi")).toContainText("Taslak kaydedildi");

  const satir = page
    .locator('[data-test="taslak-satiri"]')
    .filter({ hasText: BASLIK });
  await expect(satir).toBeVisible();
  // Bilerek bekletilen taslak, kazara kalandan rozetle ayrılır.
  await expect(satir).toContainText("Bekletiliyor");

  // Taslak **faaliyet değildir**: kayıt defterinde görünmemeli.
  await dayanikliGoto(page, "/activities");
  await expect(page.getByText(BASLIK)).toHaveCount(0);
});

test("taslak gezinmede sayısıyla görünür", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);

  const menu = page.getByRole("navigation", { name: "Ana menü" });
  await expect(menu.getByRole("link", { name: /Taslaklar/ })).toBeVisible();
});

// Menü öğesi önce yalnız taslağı olan kullanıcıda görünüyordu (`draftCount > 0`).
// Ürün sahibi 21.08.2026'da her zaman görünmesini istedi: kaybolan menü öğesi
// kullanıcıya özelliğin varlığını hiç öğretmiyor, taslak bitince de "nereye
// gitti" diye aratıyor.
test("taslağı olmayan kullanıcıda da gezinmede durur", async ({ page }) => {
  await girisYap(page, E2E_PLANNER.email);

  // Testin ön koşulu kanıtlanır: bu kullanıcının gerçekten taslağı yok.
  await dayanikliGoto(page, "/drafts");
  await expect(page.locator('[data-test="taslak-satiri"]')).toHaveCount(0);

  const menu = page.getByRole("navigation", { name: "Ana menü" });
  const baglanti = menu.getByRole("link", { name: /Taslaklar/ });
  await expect(baglanti).toBeVisible();

  // Sayaç sıfırken yazılmaz: rozet dikkat çeker, boş kutu dikkat istemiyor.
  await expect(baglanti).not.toContainText("0");
});

test("taslak yöneticiye görünmez", async ({ page }) => {
  // Planlama Müdürü, Kalıphane çalışanının taslağını hiçbir yerde görmemeli.
  await girisYap(page, E2E_PLANNER.email);

  await dayanikliGoto(page, "/feed?period=all");
  await expect(page.getByText(BASLIK)).toHaveCount(0);

  await dayanikliGoto(page, "/search?q=Taslak");
  await expect(page.getByText(BASLIK)).toHaveCount(0);

  // Taslaklar sayfası herkeste var ama yalnız kendi taslaklarını gösterir.
  await dayanikliGoto(page, "/drafts");
  await expect(page.getByText(BASLIK)).toHaveCount(0);
});

test("taslaktan devam edilip faaliyet olarak gönderilir", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);

  await dayanikliGoto(page, "/drafts");
  await page
    .locator('[data-test="taslak-satiri"]')
    .filter({ hasText: BASLIK })
    .getByRole("link", { name: "Devam et" })
    .click();

  // Form taslağın içeriğiyle açılır.
  await expect(page.getByRole("heading", { name: "Taslağa devam et" })).toBeVisible();
  await expect(page.getByLabel("Başlık")).toHaveValue(BASLIK);

  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();

  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);
  await expect(
    page.locator('[data-test="faaliyet-satiri"]').filter({ hasText: BASLIK }),
  ).toBeVisible();

  // Gönderilen taslak listeden düşer: kopyası kalırsa ikinci kez gönderilir.
  await dayanikliGoto(page, "/drafts");
  await expect(page.getByText(BASLIK)).toHaveCount(0);
});

test("taslakta iki ayrı seçimle eklenen dosyalar korunur", async ({ page }) => {
  const baslik = `Ekli taslak ${String(Date.now()).slice(-6)}`;
  await girisYap(page, E2E_WORKER.email);

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill("Taslak eki gönderilene kadar korunmalı.");

  const ekler = page.getByLabel(/^Ekler/);
  await ekler.setInputFiles({
    name: "taslak-ilk.png",
    mimeType: "image/png",
    buffer: PNG_ICERIK,
  });
  await ekler.setInputFiles({
    name: "taslak-ikinci.png",
    mimeType: "image/png",
    buffer: PNG_ICERIK,
  });
  await expect(page.locator('[data-test="ek-sayac"]')).toContainText("2/5");

  await page.getByRole("button", { name: "Taslak olarak kaydet" }).click();
  await expect(page).toHaveURL(/\/drafts\?kayit=taslak$/);

  const satir = page
    .locator('[data-test="taslak-satiri"]')
    .filter({ hasText: baslik });
  await satir.getByRole("link", { name: "Devam et" }).click();

  await expect(page.getByRole("heading", { name: "Taslağa devam et" })).toBeVisible();
  await expect(page.locator('[data-test="ek-sayac"]')).toContainText("2/5");
  await expect(page.locator('[data-test="ek-listesi"]')).toContainText("taslak-ilk.png");
  await expect(page.locator('[data-test="ek-listesi"]')).toContainText("taslak-ikinci.png");

  // Test verisi açık taslak bırakmasın; gönderim, taslak eklerinin faaliyet
  // ekine dönüştüğünü de gerçek form yolunda kanıtlar.
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);
  await expect(
    page.locator('[data-test="faaliyet-satiri"]').filter({ hasText: baslik }),
  ).toBeVisible();
});

test("taslak iki adımda silinir", async ({ page }) => {
  const silinecek = `Silinecek taslak ${String(Date.now()).slice(-6)}`;
  await girisYap(page, E2E_WORKER.email);

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(silinecek);
  await page.getByLabel("Açıklama").fill("Bu kayıt gönderilmeyecek.");
  await page.getByRole("button", { name: "Taslak olarak kaydet" }).click();
  await expect(page).toHaveURL(/\/drafts/);

  const satir = page
    .locator('[data-test="taslak-satiri"]')
    .filter({ hasText: silinecek });

  // Tek tıkla silinmez: önce onay istenir.
  await satir.getByRole("button", { name: `${silinecek} taslağını sil` }).click();
  await expect(satir.getByText("Silinsin mi?")).toBeVisible();

  // Vazgeçmek gerçekten vazgeçmeli.
  await satir.getByRole("button", { name: "Vazgeç" }).click();
  await expect(satir).toBeVisible();

  await satir.getByRole("button", { name: `${silinecek} taslağını sil` }).click();
  await satir.getByRole("button", { name: "Sil", exact: true }).click();

  await expect(page.locator("#taslak-bilgi")).toContainText("Taslak silindi");
  await expect(page.getByText(silinecek)).toHaveCount(0);
});

test("yazarken kapanan pencerenin metni taslaklarda durur", async ({ page }) => {
  const kazara = `Kazara kalan ${String(Date.now()).slice(-6)}`;
  await girisYap(page, E2E_WORKER.email);

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(kazara);
  await page
    .getByLabel("Açıklama")
    .fill("Pencereye bakacaktım, sekmeyi kapattım.");

  // Otomatik kaydetme yazma durduktan sonra çalışır; durumu ekranda yazıyor.
  await expect(page.locator('[data-test="taslak-durumu"]')).toContainText(
    "Taslak kaydedildi",
    { timeout: 15000 },
  );

  // Kullanıcı hiçbir şeye basmadan sayfadan çıkıyor.
  await dayanikliGoto(page, "/drafts");

  const satir = page
    .locator('[data-test="taslak-satiri"]')
    .filter({ hasText: kazara });
  await expect(satir).toBeVisible();
  // Kazara kalan metin, bilerek bekletilenden ayrılır.
  await expect(satir).toContainText("Otomatik kaydedildi");
});
