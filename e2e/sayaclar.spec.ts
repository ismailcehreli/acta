import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_GM, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Ana ekran sayaçları (Görev 11.2).
//
// Sayaçların beşi de **kendi listesini** açar. Önce üçü `/?period=…#kapsam`
// adresine gidiyordu: kullanıcı filtrelenmiş bir liste beklerken aynı sayfada
// aşağı kayıyordu. Sayı bir soruya cevap veriyorsa, tıklama o cevabın
// dayanağını göstermelidir.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("ana ekran iş önceliği sırasını korur", async ({ page }) => {
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/");

  const bloklar = page.locator(
    '[data-test="bana-dusenler"], [data-test="kisisel-durum"], [data-test="yonetilen-alan"]',
  );

  await expect(bloklar).toHaveCount(3);
  await expect(bloklar.nth(0)).toHaveAttribute("data-test", "bana-dusenler");
  await expect(bloklar.nth(1)).toHaveAttribute("data-test", "kisisel-durum");
  await expect(bloklar.nth(2)).toHaveAttribute("data-test", "yonetilen-alan");
});

/** Şeritteki bir ölçümün bağlantısı. */
function olcum(page: Page, etiket: string | RegExp) {
  return page
    .getByRole("link")
    .filter({ has: page.getByText(etiket, { exact: false }) })
    .first();
}

/** Aynı ölçüm kişisel ve yönetilen şeritlerde bulunduğunda yönetilen olanı seçer. */
function yonetilenOlcum(page: Page, etiket: string | RegExp) {
  return page
    .locator('[data-test="yonetilen-alan"]')
    .getByRole("link")
    .filter({ has: page.getByText(etiket, { exact: false }) })
    .first();
}

test("kişisel dönem sayacı kendi arşivini açar", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill("Sayaç denemesi");
  await page.getByLabel("Açıklama").fill("Sayaç bağlantılarını sınamak için yazıldı.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);

  await dayanikliGoto(page, "/");
  await olcum(page, /yazılan/).click();

  // Yönetim akışına karışmaz; kişisel kayıt defterini dönemiyle açar.
  await expect(page).toHaveURL(/\/activities\?.*period=/);
  await expect(page.getByRole("heading", { name: "Faaliyetlerim" })).toBeVisible();
});

test("açık takip sayacı takip listesini açar", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/");

  await olcum(page, "Açık takip").click();
  await expect(page).toHaveURL(/\/follow-ups/);
});

test("sıfır sayaç da tıklanabilir ve boşluğun sebebini söyler", async ({ page }) => {
  // Sıfırken bağlantı verilmiyordu. Boş bir liste yalan söylemez: kullanıcıya
  // nerede olduğunu ve süzgeci nasıl gevşeteceğini gösterir.
  //
  // Sayacın değeri **okunarak** iddia kuruluyor: paralel koşan başka bir spec
  // düzeltme isteyebilir ve "bu sayaç sıfırdır" varsayımı yanlış çıkabilir.
  // Sınanan şey sayının kendisi değil, sıfırın da bağlantılı olması.
  //
  // Yönetici hesabıyla: akış listesi yalnız kapsamı olan kullanıcıda çizilir.
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/");

  const duzeltme = yonetilenOlcum(page, "Düzeltme istenen");
  await expect(duzeltme).toBeVisible();
  const deger = (await duzeltme.locator("dd").innerText()).trim();

  await duzeltme.click();
  await expect(page).toHaveURL(/\/feed\?.*durum=duzeltme/);
  await expect(page.getByText("düzeltme istenenler gösteriliyor")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Daraltmayı kaldır" }),
  ).toBeVisible();

  if (deger === "0") {
    // Boşluğun sebebi metne yansır: dönem değil, durum süzgeci boşaltıyor.
    await expect(
      page.getByRole("heading", { name: /düzeltme istenenler yok/ }),
    ).toBeVisible();
  }
});

test("daraltmayı kaldır bağlantısı süzgeci gerçekten temizler", async ({ page }) => {
  // Bağlantı, daraltmayı koruyan bir adres üretiyordu: tıklamak hiçbir şeyi
  // değiştirmiyordu.
  await girisYap(page, E2E_USER.email);

  await dayanikliGoto(page, "/feed?period=all&durum=onay");
  const daraltma = page.getByText("onay bekleyenler gösteriliyor");
  await expect(daraltma).toBeVisible();

  await page.getByRole("link", { name: "Daraltmayı kaldır" }).click();

  await expect(page).not.toHaveURL(/durum=onay/);
  await expect(daraltma).toHaveCount(0);
});

test("cevap bekleyen faaliyet sayacı gelen sorusu olan kayıtları açar", async ({ page }) => {
  const sorulu = `Sorulacak kayıt ${String(Date.now()).slice(-6)}`;
  const sorusuz = `Sorusuz kayıt ${String(Date.now()).slice(-6)}`;

  await girisYap(page, E2E_WORKER.email);
  for (const baslik of [sorulu, sorusuz]) {
    await dayanikliGoto(page, "/activities/new");
    await page.getByLabel("Başlık").fill(baslik);
    await page.getByLabel("Açıklama").fill(`${baslik} için açıklama.`);
    await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
    await page.getByRole("button", { name: "Gönder" }).click();
    await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);
  }

  // Genel müdür yalnız birine soru sorar. Aynı müdürün kendi sorusu, cevap
  // bekleyen faaliyet sayacında görünmemelidir; sayaç başka bir kişiden gelen
  // soruyu sınar.
  await girisYap(page, E2E_GM.email);
  await dayanikliGoto(page, "/feed?period=all");
  await page
    .locator("a")
    .filter({ hasText: sorulu })
    .first()
    .click();
  await page.getByLabel("Soru sor").fill("Bu iş ne zaman bitecek?");
  await page.getByRole("button", { name: "Soruyu gönder" }).click();
  await expect(page.getByText("Bu iş ne zaman bitecek?")).toBeVisible();

  // Sayaçtan açılan liste: yalnız başkasından gelen sorusu olan faaliyet.
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/");
  const soruSayaci = yonetilenOlcum(page, "Cevap bekleyen faaliyet");
  await expect(soruSayaci.locator("dd")).toHaveText("1");
  await soruSayaci.click();
  await expect(page).toHaveURL(/\/feed\?.*period=all.*durum=soru/);
  await expect(page.getByText(sorulu)).toBeVisible();
  await expect(page.getByText(sorusuz)).toHaveCount(0);
});
