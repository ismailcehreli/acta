import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";
import {
  E2E_ADMIN,
  E2E_CHAIRMAN,
  E2E_DYE_MANAGER,
  e2ePassword,
} from "./global-setup";
import { yukVerisiUret, type YukOzeti } from "../tests/helpers/kabul-yuk-verisi";

// Kabul koşusu: sayfa süreleri (Görev 6.3).
//
// **Normal uçtan uca paketten ayrı çalıştırılır**: on binlerce kayıt üretiyor
// ve her koşuya dakikalar ekler. Sonuçlar `docs/gelistirme/kabul-raporu.md`
// içinde.
//
//   pnpm e2e:kabul
//
// **Ölçüm neyi ölçtüğünü doğrular** (denetim 23.08.2026, bulgu 10).
// Önceki hâli yalnız herhangi bir `main` öğesinin görünmesini bekliyordu.
// Hata ve "bulunamadı" yüzeyleri de `main` çiziyor; yetkisiz yönlendirme ya
// da beklenmeyen bir hata **hızlı ve başarılı** bir ölçüm olarak
// kaydedilebiliyordu. Rota sonucu, satır sayısı ya da beklenen veri için
// hiçbir iddia yoktu — yani "hepsi 2 saniyenin altında" cümlesi, boş
// ekranların da süresini içeriyordu.
//
// Süre kaydedilmeden önce dördü birden doğrulanıyor:
//
//   1. adres beklenen rota mı,
//   2. hata/durum yüzeyine düşülmemiş mi (`data-durum-yuzeyi` yok),
//   3. rotanın kendi işareti var mı (`main[data-sayfa="…"]`),
//   4. beklenen satır sayısı gerçekten çizilmiş mi.
//
// **Kim ölçüyor:** kapsam okuyan ekranlar **kökteki YK Başkanı** ile
// ölçülüyor. Genel Müdür kökte değil ve yük kullanıcıları kök dâhil bütün
// birimlere dağıldığı için kökteki kişilerin kayıtlarını göremiyordu; "en
// geniş kapsam" iddiası yanlıştı. Onay kuyruğu, kuyruğun gerçek sahibiyle
// (onaya tabi birimin müdürü) ölçülüyor: onay ekranı yalnız **aktif
// onaylayıcısı bu kişi olan** kayıtları getiriyor, dolayısıyla başkasıyla
// ölçmek boş ekran ölçmek olurdu.

test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

interface Beklenti {
  ad: string;
  yol: string;
  /** Rotanın `data-sayfa` işareti. */
  isaret: string;
  /** Ölçümden önce sayılacak öğe ve en az kaç tane olması gerektiği. */
  icerik: { secici: string; enAz: number };
}

/**
 * Sayfanın gerçekten **ölçülmek istenen sayfa** olduğunu doğrular.
 *
 * Bu adım süre kaydedilmeden önce koşar; başarısız olursa o rotanın süresi
 * hiç raporlanmaz. Sessizce boş ekran ölçmektense ölçümün kırılması doğru:
 * kabul raporu bir kanıt belgesi.
 */
async function dogrula(page: Page, b: Beklenti): Promise<void> {
  // Adres, tarayıcının yazdığı biçimde geliyor: `q=çalışma` yüzde kodlu
  // duruyor. Karşılaştırma çözülmüş metin üzerinden yapılıyor ki iddia
  // kodlamayı değil **rotayı** sınasın.
  const suAn = new URL(page.url());
  expect(
    decodeURIComponent(`${suAn.pathname}${suAn.search}`),
    `${b.ad}: beklenen rotada değiliz`,
  ).toBe(decodeURIComponent(b.yol));

  // Hata, "bulunamadı" ve yükleniyor yüzeyleri kendi `main`'ini çiziyor.
  await expect(
    page.locator("[data-durum-yuzeyi]"),
    `${b.ad}: hata/durum yüzeyine düşüldü`,
  ).toHaveCount(0);

  await expect(
    page.locator(`main[data-sayfa="${b.isaret}"]`),
    `${b.ad}: rotanın işareti yok`,
  ).toBeVisible();

  const sayi = await page.locator(b.icerik.secici).count();
  expect(
    sayi,
    `${b.ad}: ${b.icerik.secici} için en az ${b.icerik.enAz} bekleniyordu`,
  ).toBeGreaterThanOrEqual(b.icerik.enAz);
}

/** Sayfayı altı kez açar; ilk açılış ayrı, kalanların ortancası ve en kötüsü. */
async function olc(
  page: Page,
  b: Beklenti,
): Promise<{ ilk: number; ortanca: number; enKotu: number }> {
  // **İlk açılış ayrıca ölçülüyor.** Next rotayı ilk istekte hazırlıyor ve
  // Postgres sorgu planını ilk koşuda kuruyor; bunu ortalamaya karıştırmak
  // hem soğuk hem sıcak durumu gizler. İkisi de raporlanıyor.
  const ilkBas = Date.now();
  await dayanikliGoto(page, b.yol, { waitUntil: "domcontentloaded" });
  await page.locator(`main[data-sayfa="${b.isaret}"]`).waitFor({ state: "visible" });
  const ilk = Date.now() - ilkBas;
  await dogrula(page, b);

  const sureler: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const bas = Date.now();
    await dayanikliGoto(page, b.yol, { waitUntil: "domcontentloaded" });
    // Rotanın kendi işareti bekleniyor: sunucu bileşeni tamamlanmadan
    // gelmiyor ve hata yüzeyi bu işareti hiç çizmiyor.
    await page
      .locator(`main[data-sayfa="${b.isaret}"]`)
      .waitFor({ state: "visible" });
    const sure = Date.now() - bas;

    // Süre **doğrulamadan sonra** listeye giriyor.
    await dogrula(page, b);
    sureler.push(sure);
  }

  sureler.sort((a, b) => a - b);
  return { ilk, ortanca: sureler[2] ?? 0, enKotu: sureler[4] ?? 0 };
}

test("sayfa süreleri 12 aylık veriyle ölçülüyor", async ({ page }) => {
  // **Veri test içinde üretiliyor.** İlk denemede yük verisi ayrı bir
  // betikle yazılmıştı ve e2e kurulumu her koşuda `TRUNCATE` yaptığı için
  // ölçüm boş veritabanında yapıldı — hiçbir şey kanıtlamıyordu.
  const yuk: YukOzeti = await yukVerisiUret();
  console.log(`YUK|${JSON.stringify(yuk)}`);

  // Üretilen hacim ölçümün ön koşulu: veri yoksa ölçüm bir şey söylemez.
  expect(yuk.kisiSayisi, "toplam aktif şirket büyüklüğü").toBe(40);
  expect(yuk.faaliyetSayisi, "faaliyet hacmi").toBeGreaterThan(5_000);
  expect(yuk.bekleyenOnay, "onay kuyruğu").toBeGreaterThan(50);
  expect(yuk.takipMaddesi, "takip maddesi").toBeGreaterThan(100);
  expect(yuk.taslak, "taslak").toBeGreaterThan(20);
  expect(yuk.izinDonemi, "izin dönemi").toBeGreaterThan(20);
  expect(yuk.bildirim, "bildirim").toBeGreaterThan(100);
  expect(yuk.denetimKaydi, "denetim kaydı").toBeGreaterThan(1_000);
  expect(yuk.skorDonemi, "skor dönemi").toBeGreaterThan(100);

  const sonuclar: string[] = [];

  async function olcVeYaz(b: Beklenti): Promise<void> {
    const { ilk, ortanca, enKotu } = await olc(page, b);
    sonuclar.push(
      `| ${b.ad} | \`${b.yol}\` | ${ilk} ms | ${ortanca} ms | ${enKotu} ms |`,
    );
    console.log(`OLCUM|${b.ad}|${ilk}|${ortanca}|${enKotu}`);
  }

  // ---- Kapsam okuyan ekranlar: kökteki YK Başkanı ------------------------
  await girisYap(page, E2E_CHAIRMAN.email);

  for (const b of [
    {
      ad: "Ana ekran",
      yol: "/",
      isaret: "ana-ekran",
      icerik: { secici: '[data-test="departman-ozeti"]', enAz: 1 },
    },
    {
      ad: "Kayıt akışı",
      yol: "/feed?period=all",
      isaret: "akis",
      icerik: { secici: '[data-test="akis-satiri"]', enAz: 10 },
    },
    {
      ad: "Faaliyetlerim",
      yol: "/activities?period=all",
      isaret: "faaliyetlerim",
      icerik: { secici: '[data-test="faaliyet-satiri"]', enAz: 10 },
    },
    {
      ad: "Arama",
      yol: "/search?q=çalışma&period=all",
      isaret: "arama",
      icerik: { secici: '[data-test="arama-sonucu"]', enAz: 10 },
    },
    {
      ad: "Takipler",
      yol: "/follow-ups",
      isaret: "takipler",
      icerik: { secici: '[data-test="takip-satiri"]', enAz: 5 },
    },
    {
      ad: "Taslaklar",
      yol: "/drafts",
      isaret: "taslaklar",
      icerik: { secici: '[data-test="taslak-satiri"]', enAz: 10 },
    },
    {
      ad: "Ekip izinleri",
      yol: "/team/absence",
      isaret: "ekip-izinleri",
      icerik: { secici: '[data-test="izin-satiri"]', enAz: 5 },
    },
    {
      ad: "Ekip skorları",
      yol: "/scores",
      isaret: "skorlar",
      icerik: { secici: '[data-test="skor-satiri"]', enAz: 10 },
    },
  ]) {
    await olcVeYaz(b);
  }

  // ---- Onay kuyruğu: kuyruğun gerçek sahibi ------------------------------
  //
  // Onay ekranı yalnız **aktif onaylayıcısı bu kişi olan** kayıtları
  // getiriyor; kapsamı en geniş kişi bile başkasının kuyruğunu görmüyor.
  // Ölçüm bu yüzden onaya tabi birimin müdürüyle yapılıyor.
  await girisYap(page, E2E_DYE_MANAGER.email);
  await olcVeYaz({
    ad: "Onaylar",
    yol: "/approvals",
    isaret: "onaylar",
    icerik: { secici: '[data-test="onay-grubu"]', enAz: 5 },
  });
  // Süzgeçli akış da burada ölçülüyor. `durum=onay` **onay bekleyen**
  // kayıtları arıyor ve onları yalnız aktif onaylayıcı görüyor; kapsamı en
  // geniş kişiyle ölçmek boş liste ölçmek olurdu. Ölçüm bunu kendi
  // iddiasıyla yakaladı: Başkanla koşulduğunda satır sayısı sıfırdı ve eski
  // hâlinde bu "hızlı sayfa" diye kaydedilirdi.
  await olcVeYaz({
    ad: "Kayıt akışı (süzgeçli)",
    yol: "/feed?period=all&durum=onay",
    isaret: "akis",
    icerik: { secici: '[data-test="akis-satiri"]', enAz: 10 },
  });

  // ---- Yönetim ekranları: sistem yöneticisi ------------------------------
  await girisYap(page, E2E_ADMIN.email);

  for (const b of [
    {
      ad: "Kullanıcı yönetimi",
      yol: "/admin/users",
      isaret: "kullanici-yonetimi",
      icerik: { secici: '[data-test="kullanici-satiri"]', enAz: 20 },
    },
    {
      ad: "İşlem kayıtları",
      yol: "/admin/audit",
      isaret: "islem-kayitlari",
      icerik: { secici: '[data-test="denetim-kaydi"]', enAz: 10 },
    },
    {
      ad: "Çalışma takvimi",
      yol: "/admin/calendar?sekme=birimler",
      isaret: "calisma-takvimi",
      // Takvim ekranı liste değil form; birim seçicisinin dolu olması,
      // sayfanın gerçekten kurulduğunun kanıtı.
      icerik: { secici: "#unit-calendar-birim option", enAz: 3 },
    },
  ]) {
    await olcVeYaz(b);
  }

  // Tablo satırları günlüğe basılıyor; kabul raporuna oradan alınıyor.
  console.log(sonuclar.join("\n"));
});
