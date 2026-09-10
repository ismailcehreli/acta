import type { Prisma } from "@prisma/client";

// "Faaliyet beklenmiyor" döneminin **geçerli** olup olmadığı tek yerde
// tanımlıdır (denetim 21.08.2026, bulgu 7).
//
// İptal edilmiş veya henüz onaylanmamış dönem **geçerli** sayılmaz:
// hatırlatmayı durdurmaz, katılım paydasından düşmez, vekâlet kapsamı açmaz.
//
// Süzgecin ayrı bir dosyada durmasının sebebi, onu okuyan **sekiz** ayrı yol
// olmasıdır: vekâlet kapsamı, onay kuyruğu, katılım sayacı, kabuk menüsü,
// akşam hatırlatması, vekâlet sayfası, ekip listesi ve görünürlük modülü.
// Her birine ayrı ayrı `cancelledAt: null` yazmak, unutulan tek satırın
// sessiz hata olması demekti — ve bu hatanın belirtisi yok: iptal edilmiş bir
// dönem yaşıyormuş gibi davranır, kimse fark etmez.

/** Geçerli (iptal edilmemiş) dönem koşulu. */
export const GECERLI_DONEM = {
  cancelledAt: null,
  status: "APPROVED",
} satisfies Prisma.NoActivityPeriodWhereInput;

/**
 * Bir kişinin verilen günü kapsayan geçerli dönemleri.
 *
 * `User` üzerinden ilişkisel süzgeç kuran çağıranlar için (`noActivityPeriods:
 * { none: ... }` gibi) hazır parça.
 */
export function gunuKapsayanDonem(gun: Date): Prisma.NoActivityPeriodWhereInput {
  return {
    ...GECERLI_DONEM,
    startDate: { lte: gun },
    endDate: { gte: gun },
  };
}
