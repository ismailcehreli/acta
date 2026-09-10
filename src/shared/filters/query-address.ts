// Süzgeçleri koruyan adres üretici (Görev 11.3).
//
// Listeleyen her sayfada aynı iş yapılıyor: sayfalama, sayfa boyu ve
// daraltma bağlantıları kullanıcının **mevcut seçimini taşımalı.** Her
// sayfada elle yazıldığında biri unutuluyordu — arama sayfasında sayfalama
// yalnız arama kelimesini taşıyordu ve süzgeç uygulayıp ikinci sayfaya geçen
// kullanıcı bütün daraltmasını kaybediyordu.
//
// Boş değer bir seçim değildir ve yazılmaz: adres çubuğunu `durum=` gibi
// anlamsız parçalarla doldurmak, paylaşılan bağlantıyı okunmaz yapar.

/**
 * @param path      Sayfanın yolu (`/activities`).
 * @param current   Mevcut seçim; boş ve tanımsız değerler atılır.
 * @param extra     Bu bağlantıya özel eklemeler; aynı adı ezer.
 * @param drop      Bilerek düşürülecek parametreler ("daraltmayı kaldır").
 */
export function buildQueryAddress(
  path: string,
  current: Record<string, string | undefined>,
  extra: Record<string, string> = {},
  drop: string[] = [],
): string {
  const sorgu = new URLSearchParams();

  for (const [ad, deger] of Object.entries({ ...current, ...extra })) {
    if (deger === undefined || deger === "") continue;
    if (drop.includes(ad)) continue;
    sorgu.set(ad, deger);
  }

  const metin = sorgu.toString();
  return metin === "" ? path : `${path}?${metin}`;
}
