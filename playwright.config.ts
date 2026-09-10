import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Kurulum adımı ve uygulama sunucusu E2E_DATABASE_URL'i kullanır; .env'den gelir.
loadEnv();

const port = Number(process.env.E2E_PORT ?? 3100);
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;

// Kabul ölçümü normal paketten **dışarıda**: on binlerce kayıt üretiyor ve
// her koşuya dakikalar ekliyor. Kendi projesiyle, elle çalıştırılır:
//
//   pnpm e2e:kabul
//
// **Kendi projesi var** çünkü `pnpm e2e kabul-olcum.spec.ts` bu dosyayı hiç
// koşturmuyordu (denetim 23.08.2026, bulgu 10 sırasında görüldü):
// `pnpm e2e` iki aşama koşuyor ve komut satırındaki süzgeç yalnız
// **ikinci** aşamaya geçiyor; o aşama da bu dosyayı zaten dışlıyor. Yani
// belgedeki komut ilk aşamada bütün paketi koşturup ölçümü hiç yapmıyordu.
const OLCUM = "**/kabul-olcum.spec.ts";

// Bu dosyalar **paylaşılan durumu** değiştiriyor ve birbirini eziyor.
//
// İki grup var, sebepleri aynı:
//
// 1. Ana sistem ayarları formu bütün ayarları **tek seferde** yazıyor. Bir
//    spec formu açtığında o anki değerleri alıyor; başka bir spec arada
//    kaydettiğinde ilk spec kendi kaydıyla onun değişikliğini geri alıyor.
//    Ayarların bir kısmı küresel kuralı sıkılaştırıyor da — asgari başlık
//    uzunluğu, izinli e-posta alan adları — ve o pencerede paralel koşan
//    başka bir spec reddediliyor.
//
// 2. Altı spec **aynı birimin** ("Kalıphane") onay bayrağını başta açıp
//    sonunda kapatıyor. Paralel koştuklarında biri bayrağı kapatırken
//    diğeri hâlâ ona bağlı çalışıyor. (`liste-suzgecleri.spec.ts` bu tuzağı
//    fark edip kendine bayrağı hiç değişmeyen ayrı bir birim seçmiş; doğru
//    çözüm odur, ama altı spec'i taşımak ayrı bir iş.)
//
// Sonuç, koşuların yaklaşık üçte birinde başka bir testin düştüğü bir
// kararsızlıktı; üç tarayıcıda da görüldü (22–23.08.2026).
//
// Çözüm: bu dosyalar geri kalan her şey bittikten sonra ayrı bir aşamada ve
// **tek işçiyle** koşuyor (bkz. `package.json` → `e2e`). Rastgele düşen bir
// takım, gerçek hatanın da göz ardı edilmesine yol açar; sızıntı toleransı
// sıfır olan bir projede kabul edilemez (§18.4).
const PAYLASILAN_DURUMU_DEGISTIRENLER = [
  // 1 — ana ayarlar formunu kaydedenler
  "**/ayarlar.spec.ts",
  "**/eposta-alan-adi.spec.ts",
  "**/metin-sinirlari.spec.ts",
  "**/skor.spec.ts",
  // 2 — Kalıphane'nin onay bayrağını açıp kapatanlar
  "**/bildirim.spec.ts",
  "**/is-kuyrugu.spec.ts",
  "**/onay.spec.ts",
  "**/profil.spec.ts",
  "**/reddetme.spec.ts",
  "**/toplu-onay.spec.ts",
];

/** Bir tarayıcı için iki aşama: önce paket, sonra paylaşılan durumu değiştirenler. */
function tarayiciProjeleri() {
  const tarayicilar = [
    { name: "chromium", device: "Desktop Chrome" },
    { name: "firefox", device: "Desktop Firefox" },
    // WebKit, Safari'nin motoru. Safari'nin kendisi değil ama tarayıcıya
    // özgü hataların çıktığı katman burasıdır.
    { name: "webkit", device: "Desktop Safari" },
  ] as const;

  return tarayicilar.flatMap(({ name, device }) => [
    {
      name,
      use: { ...devices[device] },
      testIgnore: [OLCUM, ...PAYLASILAN_DURUMU_DEGISTIRENLER],
    },
    {
      name: `${name}-ayar`,
      use: { ...devices[device] },
      testMatch: PAYLASILAN_DURUMU_DEGISTIRENLER,
    },
  ]);
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  // Her giriş bir Argon2 doğrulaması demek (bilerek pahalı, §15.3). Daha çok
  // işçi açıldığında işlemci doyuyor ve testler gerçek olmayan zaman
  // aşımlarına düşüyordu.
  workers: 2,
  // Paralel koşuda testler tek sunucuyu paylaşıyor; 5 saniyelik varsayılan
  // bekleme yavaş anlarda gerçek olmayan hatalar üretiyordu. Süreyi uzatmak
  // hatayı gizlemez, yalnız yükün geçmesini bekler.
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    // Kendi imzalı sertifikayla yerelde HTTPS denemesi yapılabilsin diye:
    // yalnız adres https ise gevşer, normal koşuda etkisi yoktur.
    ignoreHTTPSErrors: baseURL.startsWith("https://"),
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    trace: "on-first-retry",
  },
  // Üç tarayıcı tanımlı ama **aynı koşuda ikisi birden çalıştırılmaz.**
  // Testler birbirinden yalıtılmış; aynı testin iki tarayıcıda eşzamanlı
  // koşması ise yeni bir durum: ikisi de aynı kaydı değiştirip birbirini
  // düşürebilir. Bu yüzden tarayıcılar sırayla koşar:
  //
  //   pnpm e2e              → yalnız chromium (günlük geliştirme)
  //   pnpm e2e:tarayicilar  → firefox, sonra webkit (kabul kontrolü)
  //
  // Her tarayıcı **iki aşamada** koşar: önce paket, sonra paylaşılan durumu
  // değiştiren dosyalar tek işçiyle. Sebebi aşağıdaki listenin yorumunda.
  //
  // Chromium varsayılan, çünkü her değişiklikte üç tarayıcı koşturmak geri
  // bildirimi üç katına çıkarır ve kimse çalıştırmaz olur.
  //
  // **WebKit HTTPS ister.** Oturum çerezi `Secure` işaretli (§15.5); Chromium
  // ve Firefox `127.0.0.1` üzerinde böyle bir çerezi kabul ediyor, WebKit
  // etmiyor ve giriş hiç olmuyor. WebKit koşusu için uygulamanın önüne TLS
  // sonlandıran bir vekil konur ve `E2E_BASE_URL=https://…` verilir; nasıl
  // yapıldığı `docs/gelistirme/kabul-raporu.md` içinde.
  projects: [
    ...tarayiciProjeleri(),
    // Ölçüm tek işçiyle koşar: paralel bir test aynı sunucuyu meşgul
    // ederse ölçülen süre uygulamanın değil, yükün süresi olur.
    {
      name: "kabul",
      use: { ...devices["Desktop Chrome"] },
      testMatch: [OLCUM],
    },
  ],
  // E2E_BASE_URL verilmişse sunucu dışarıda çalışıyordur; o ortamın da
  // E2E_DATABASE_URL'e bağlı olması gerekir, aksi hâlde test kullanıcısını
  // bulamaz. Uygulama veritabanına karşı uçtan uca koşu kasten mümkün değildir.
  webServer: externalBaseURL
    ? undefined
    : {
        // **Geliştirme sunucusu değil, üretim derlemesi** (19.08.2026).
        //
        // `next dev` rotaları ilk ziyarette derler. Makine yüklüyken bu tek bir
        // sayfada 30 saniyeyi aşıyordu ve koşuların her birinde **farklı** bir
        // test zaman aşımına düşüyordu; hepsi tek başına koşturulduğunda
        // geçiyordu. Düşen ekranın görüntüsünde Next'in kendi katmanı
        // "Compiling…" yazıyordu.
        //
        // Rastgele düşen bir takım, gerçek hatanın da göz ardı edilmesine yol
        // açar — sızıntı toleransı sıfır olan bir projede kabul edilemez
        // (§18.4). Derleme yaklaşık 20 saniye sürüyor ve koşuyu ayrıca
        // hızlandırıyor. Ek fayda: sınanan şey **üretimde çalışacak olanın
        // aynısı**.
        command: `pnpm build && pnpm start --port ${port}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 300_000,
        env: {
          // Sunucu, testlerin yazdığı veritabanına bakar.
          DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
        },
      },
});
