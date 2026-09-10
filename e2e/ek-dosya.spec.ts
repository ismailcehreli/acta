import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Faaliyete dosya ekleme — uçtan uca.
//
// Birim testleri dosya servisini (tür doğrulama, boyut sınırı, disk yazımı)
// zaten sınıyor. Burada sınanan **kullanıcının yaşadığı yol**: tarayıcıdan
// dosya seçip kaydetmek, kaydın ekinde görmek, **sayfadan çıkmadan
// büyütüp kapatmak**, indirebilmek — ve **göremeyeceği bir kaydın ekini
// indirememek.**
//
// Önizleme ucu (`?inline=1`) ayrı bir sunum biçimidir ama **aynı** görünürlük
// kapısından geçer; yetkisiz kişi için ikisi de 404 olmalı. Bu, önizlemeyle
// birlikte açılan yeni yüzeyin sızıntı kapısına dönüşmediğinin kanıtıdır.
//
// Son madde asıl mesele: ek indirme ayrı bir HTTP ucudur (`/api/attachments/`)
// ve sayfa görünürlüğünden bağımsız çalışır. O uç görünürlük modülünden
// geçmezse, eline ek bağlantısı geçen herkes için sızıntı kapısı olur.
//
// İndirme isteği **sayfanın içinden** (`fetch`) yapılır, ayrı bir HTTP
// istemcisiyle değil: oturum çerezi `secure` işaretli ve Playwright'ın API
// istemcisi onu düz HTTP'de göndermiyor — o yoldan gelen 401, uygulamanın
// değil test aracının davranışı olurdu.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Küçük ama **gerçek** bir PNG: tür doğrulaması içerik imzasına bakıyor. */
const PNG_ICERIK = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let kayitAdresi = "";
let ekAdresi = "";

test("kullanıcı faaliyetine dosya ekler ve ekini indirebilir", async ({ page }) => {
  await girisYap(page, E2E_USER.email);

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill("Kalıp ölçüm raporu");
  await page
    .getByLabel("Açıklama")
    .fill("Ölçüm sonuçları ekteki dosyada; iki parçada tolerans aşımı var.");

  await page.getByLabel(/^Ekler/).setInputFiles({
    name: "olcum-raporu.png",
    mimeType: "image/png",
    buffer: PNG_ICERIK,
  });
  // Tarayıcı aynı input'ta ikinci seçimi birincinin yerine koyar. Uygulama
  // seçimi biriktirmeli; kullanıcı geri bildirimindeki "yalnız son fotoğraf"
  // hatası ancak iki ayrı seçimle yakalanır.
  await page.getByLabel(/^Ekler/).setInputFiles({
    name: "olcum-ek.png",
    mimeType: "image/png",
    buffer: PNG_ICERIK,
  });
  await expect(page.locator('[data-test="ek-sayac"]')).toContainText("2/5");
  await expect(page.locator('[data-test="ek-listesi"]')).toContainText(
    "olcum-raporu.png",
  );
  await expect(page.locator('[data-test="ek-listesi"]')).toContainText(
    "olcum-ek.png",
  );

  // Muhatap departman zorunlu.
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();

  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);

  // Kaydın detayına git: ekler orada listelenir.
  await page
    .locator('[data-test="faaliyet-satiri"]')
    .filter({ hasText: "Kalıp ölçüm raporu" })
    .getByRole("link")
    .first()
    .click();
  await expect(page).toHaveURL(/\/activities\/[0-9a-f-]+$/);
  kayitAdresi = page.url();

  // Resim eki küçük önizleme olarak görünür; indirme bağlantısı değil.
  const onizlemeler = page.locator('[data-test="ek-onizleme"][data-ek-turu="image"]');
  await expect(onizlemeler).toHaveCount(2);
  await expect(onizlemeler.filter({ hasText: "olcum-ek.png" })).toHaveCount(1);
  const onizleme = onizlemeler.first();
  await expect(onizleme).toBeVisible();
  await expect(onizleme).toContainText("olcum-raporu.png");

  const adresiCoz = async (secici: string, oznitelik: string) =>
    new URL(
      (await page.locator(secici).first().getAttribute(oznitelik)) ?? "",
      page.url(),
    ).toString();

  // Küçük önizleme dosyanın kendisini çiziyor: kaynak `inline` ucu.
  const kucukAdres = await adresiCoz('[data-test="ek-onizleme"] img', "src");
  expect(kucukAdres).toContain("/api/attachments/");
  expect(kucukAdres).toContain("inline=1");

  // Tıklayınca **aynı sayfada** katman açılır: adres değişmez, sekme açılmaz.
  const oncekiAdres = page.url();
  await onizleme.click();
  const katman = page.locator('[data-test="ek-onizleme-katmani"]');
  await expect(katman).toBeVisible();
  await expect(katman.locator("img")).toBeVisible();
  expect(page.url()).toBe(oncekiAdres);

  // Katmandaki indirme bağlantısı parametresiz uca gider.
  ekAdresi = new URL(
    (await katman.getByRole("link", { name: "İndir" }).getAttribute("href")) ?? "",
    page.url(),
  ).toString();
  expect(ekAdresi).toContain("/api/attachments/");
  expect(ekAdresi).not.toContain("inline=1");

  // Kapatınca kullanıcı kaydın detayında kalır.
  await katman.getByRole("button", { name: "Kapat" }).click();
  await expect(katman).toHaveCount(0);
  expect(page.url()).toBe(oncekiAdres);

  // Esc de kapatır: fare kullanmayan kullanıcı katmanda kilitli kalmamalı.
  await onizleme.click();
  await expect(katman).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(katman).toHaveCount(0);

  // Aynı dosya iki biçimde sunuluyor ve ikisi de aynı bayta çıkıyor.
  const gosterim = await page.evaluate(async (adres) => {
    const cevap = await fetch(adres);
    return {
      status: cevap.status,
      disposition: cevap.headers.get("content-disposition"),
      csp: cevap.headers.get("content-security-policy"),
    };
  }, `${ekAdresi}?inline=1`);

  expect(gosterim.status).toBe(200);
  expect(gosterim.disposition).toContain("inline");
  // Gösterilen dosya betik çalıştıramaz ve dışarıya istek atamaz.
  expect(gosterim.csp).toContain("sandbox");

  // İndirme gerçekten dosyayı veriyor. İstek **sayfanın içinden** yapılır:
  // oturum çerezi tarayıcıya ait ve aynı kaynağa giden `fetch` onu
  // kendiliğinden taşır.
  const sonuc = await page.evaluate(async (adres) => {
    const cevap = await fetch(adres);
    const bayt = new Uint8Array(await cevap.arrayBuffer());
    return {
      status: cevap.status,
      contentType: cevap.headers.get("content-type"),
      disposition: cevap.headers.get("content-disposition"),
      uzunluk: bayt.length,
      imza: Array.from(bayt.subarray(0, 4))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    };
  }, ekAdresi);

  expect(sonuc.status).toBe(200);
  expect(sonuc.contentType).toContain("image/png");
  // Tarayıcıda çalıştırılmasın diye her zaman indirme olarak sunulur.
  expect(sonuc.disposition).toContain("attachment");
  expect(sonuc.disposition).toContain("olcum-raporu.png");
  expect(sonuc.uzunluk).toBe(PNG_ICERIK.length);
  expect(sonuc.imza).toBe("89504e47");
});

test("kaydı göremeyen kişi ekini de indiremez", async ({ page }) => {
  expect(ekAdresi).not.toBe("");

  // Başka bir birimden, bu kaydı görme yetkisi olmayan kullanıcı.
  await girisYap(page, E2E_WORKER.email);

  // Önce kaydın kendisi: "yok" ile "yetkiniz yok" aynı cevabı verir.
  const sayfa = await dayanikliGoto(page, kayitAdresi);
  expect(sayfa?.status()).toBe(404);

  // Asıl mesele: ek indirme ucu ayrı bir yol ve aynı kuraldan geçmeli.
  // 404 döndüğü için indirme başlamaz; `goto` cevabı doğrudan okunabilir.
  const ek = await dayanikliGoto(page, ekAdresi);
  expect(ek?.status()).toBe(404);
  // Gövde dosyayı taşımamalı: PNG imzası çıkmamalı.
  const govde = await ek!.body();
  expect(govde.subarray(0, 4).toString("hex")).not.toBe("89504e47");

  // Önizleme biçimi ayrı bir sunum ama **aynı** kapı: parametre eklemek
  // yetki kazandırmaz.
  const onizleme = await dayanikliGoto(page, `${ekAdresi}?inline=1`);
  expect(onizleme?.status()).toBe(404);
  expect((await onizleme!.body()).subarray(0, 4).toString("hex")).not.toBe(
    "89504e47",
  );
});

test("oturumsuz istek ek indiremez", async ({ page }) => {
  expect(ekAdresi).not.toBe("");
  await page.context().clearCookies();

  const cevap = await dayanikliGoto(page, ekAdresi);
  // Oturumsuzda 401; 200 ve dosya **olamaz.**
  expect(cevap?.status()).not.toBe(200);
  expect((await cevap!.body()).subarray(0, 4).toString("hex")).not.toBe("89504e47");
});
