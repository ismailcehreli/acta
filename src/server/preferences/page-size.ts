import { cookies } from "next/headers";

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_COOKIE,
  normalizePageSize,
  type PageSize,
} from "@/shared/page-size";

// Listelerde "sayfada kaç kayıt" tercihinin sunucu tarafı.
//
// **Neden çerez, neden veritabanı değil:** bu bir ekran tercihi, bir iş kaydı
// değil. Kullanıcı adına satır açmak her listede fazladan sorgu demek olurdu;
// üstelik aynı kişi masaüstünde 100, telefonda 25 isteyebilir ve çerez cihaza
// ait olduğu için bunu doğal olarak karşılar.
//
// Tercih **hatırlanır**: bir kez seçildiğinde diğer listelerde ve sonraki
// oturumlarda da geçerlidir.

export { PAGE_SIZE_COOKIE };

/**
 * Geçerli sayfa boyu: önce adres çubuğu, sonra çerez, sonra varsayılan.
 *
 * Adres çubuğu çerezden önce gelir; paylaşılan bir bağlantı karşı taraftaki
 * tercihi ezmeden çalışır.
 *
 * Sınır **sunucuda** uygulanıyor: istemciden gelen bir sayı doğrudan `take`
 * değeri olsaydı, adres çubuğuna 100000 yazan biri veritabanını tek istekle
 * yorabilirdi.
 */
export async function resolvePageSize(
  fromQuery: string | undefined,
): Promise<PageSize> {
  const adresten = normalizePageSize(fromQuery);
  if (adresten) return adresten;

  const store = await cookies();
  return normalizePageSize(store.get(PAGE_SIZE_COOKIE)?.value) ?? DEFAULT_PAGE_SIZE;
}
