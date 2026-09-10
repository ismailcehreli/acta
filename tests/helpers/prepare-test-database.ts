// Test veritabanının hazırlanma sırası tek yerde tutulur ve sınanabilir olsun
// diye bağımlılıklar dışarıdan verilir.
//
// Sıra bir ayrıntı değil, korumanın kendisidir: **önce adres doğrulanır, sonra
// işaret aranır, en son migration koşar.** Migration zararsız bir ekleme
// değildir — şema değiştirir, veri dönüştürür, kolon düşürebilir. İşaret
// taşımayan bir veritabanına migration uygulandıktan sonra durmak, koruma
// değil; hasar sonrası uyarıdır (denetim 18.08.2026, FAZ 4 bulgu 12).

export interface TestDatabasePreparation {
  /** Adresi doğrular ve kanonik hâlini döndürür. */
  resolveUrl: () => string;
  /** Veritabanı kurulumunun bıraktığı işareti arar; yoksa hata fırlatır. */
  assertSentinel: (url: string) => Promise<void>;
  /** Migration'ları uygular. */
  runMigrations: (url: string) => void;
  /** Migration sonrasında uygulamanın zorunlu şeması duruyor mu? */
  isSchemaReady: (url: string) => Promise<boolean>;
  /** Yalnız sentinel'i doğrulanmış test hedefini baştan kurar. */
  resetDatabase: (url: string) => void;
}

export async function prepareTestDatabase(
  steps: TestDatabasePreparation,
): Promise<void> {
  const url = steps.resolveUrl();
  await steps.assertSentinel(url);
  steps.runMigrations(url);

  if (await steps.isSchemaReady(url)) return;

  // `_prisma_migrations` geçmişi tek başına şemanın varlığını kanıtlamaz:
  // yarım kalmış bir reset/tablo silme sonrası deploy eski migration'ları
  // yeniden çalıştırmaz. Sentinel doğrulandığı için burada yalnız test
  // veritabanını güvenle baştan kurabiliriz.
  steps.resetDatabase(url);

  if (!(await steps.isSchemaReady(url))) {
    throw new Error(
      "Test veritabanı reset sonrasında zorunlu tabloları hâlâ eksik; " +
        "uygulama sunucusu başlatılmadı.",
    );
  }
}
