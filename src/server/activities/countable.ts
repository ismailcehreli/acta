import type { Prisma } from "@prisma/client";

// "Kaç faaliyet" sorusunun tek tanımı (ürün sahibi kararı, 03.09.2026).
//
// İptal edilen kayıt **yapılmamış** sayılır; reddedilen kayıt ise yönetime
// sunulmaya uygun bulunmamıştır. İkisi de üretilen işin sayısına girmez.
//
// Tanım tek yerde duruyor çünkü üç yerde ayrı ayrı yazılmıştı ve ayrışmıştı:
// skor (`scoring/collect.ts`) ikisini de dışlıyor, departman özeti yalnız
// iptali dışlıyor, dashboard sayaçları ise ikisini de sayıyordu. Aynı kişi
// aynı ay için dashboard'da ve karnesinde farklı sayı görüyordu.
//
// **Nerede kullanılmaz — bilerek:**
//
//   · Katılım ("bugün faaliyet girdi mi"): kişi kaydı yazmıştır, müdürün
//     reddi kişinin o gün çalışmadığı anlamına gelmez. Skorun katılım
//     hesabı da yalnız iptali dışlıyor; ikisi aynı kalmalı.
//   · Durum dağılımı grafiği: grafiğin konusu zaten durumlardır; iptal ve
//     ret dilimlerini çıkarmak grafiği kendi sorusuna cevap veremez hâle
//     getirirdi.
//   · Onay kuyruğu ve iş listeleri: orada karar bekleyen kayıt aranıyor.

/** Sayıma girmeyen durumlar. */
export const UNCOUNTABLE_APPROVAL_STATUSES = ["CANCELLED", "REJECTED"] as const;

/** Sayaç ve grafiklerin faaliyet koşulu. */
export function countableActivityWhere(): Prisma.ActivityWhereInput {
  return { approvalStatus: { notIn: [...UNCOUNTABLE_APPROVAL_STATUSES] } };
}
