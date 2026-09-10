import { businessDaysBetween } from "@/server/calendar/business-days";

// Kapatma kuralları (§9.3). Tablo:
//
//   Soruyu soran            → her zaman
//   Sorunun sorumlusu       → hayır; cevaplar, kapatamaz
//   Soranın üstündeki yönetici → soran 10 iş günü işlem yapmazsa
//   Sistem yöneticisi       → gerekçeli idari kapatma
//
// Faaliyet iptalinin kapattığı konuşmalar bu karardan geçmez; ayrı bir kapanış
// türü (`CANCELLED_ACTIVITY`) alır ve gerekçe iptal kaydında durur.
//
// Kurallar saf fonksiyonda tutulur: sahte saatle ve veritabanı olmadan
// sınanabilsinler diye.

/**
 * Soranın üstünün devreye girmesi için geçmesi gereken iş günü sayısı.
 * Varsayılan; güncel değer sistem ayarlarından gelir (§16.5) ve karar
 * bağlamında taşınır.
 */
export const SUPERVISOR_TAKEOVER_BUSINESS_DAYS = 10;

export type CloseDecision =
  | {
      allowed: true;
      closeType: "NORMAL" | "ADMINISTRATIVE";
      /** İdari kapatmada gerekçe zorunludur (§9.3). */
      requiresReason: boolean;
    }
  | { allowed: false; reason: CloseRefusal };

export type CloseRefusal =
  /** Sorumlu cevaplar, kapatamaz (§9.3). */
  | "responsible_cannot_close"
  /** Soranın üstü henüz devreye giremez. */
  | "supervisor_too_early"
  /** Konuşmayla ilgisi olmayan kişi. */
  | "not_a_party"
  /** İdari kapatma gerekçesiz yapılamaz. */
  | "reason_required"
  | "already_closed";

export interface CloseContext {
  status: "OPEN" | "CLOSED";
  askerId: string;
  /** Konuşmanın hedefi: faaliyeti yazan kişi. Cevapla el değiştirmez. */
  respondentId: string;
  openedAt: Date;
  /** Soranın son işlemi; yoksa açılış anı. */
  lastAskerActionAt: Date;
  now: Date;
  /** Karar veren kişi. */
  actorId: string;
  actorIsSystemAdmin: boolean;
  /** Karar veren, soranın üst zincirinde mi (§4.4). */
  actorIsAskerSupervisor: boolean;
  /** Taraflardan biri pasifleştirildi mi. */
  anyPartyInactive: boolean;
  /** Şirketin çalışma günleri; verilmezse hafta içi varsayılır. */
  workingDays?: number[];
  /** Üstün devreye girmesi için gereken iş günü; verilmezse varsayılan. */
  supervisorTakeoverDays?: number;
  holidays?: string[];
}

export function decideClose(context: CloseContext): CloseDecision {
  if (context.status === "CLOSED") {
    return { allowed: false, reason: "already_closed" };
  }

  // Soran her zaman kapatabilir.
  if (context.actorId === context.askerId) {
    return { allowed: true, closeType: "NORMAL", requiresReason: false };
  }

  // Sorumlu asla kapatamaz: cevap vermek kapatmak değildir. Aksi hâlde soru
  // sahibi tatmin olmadan konuşma kapanırdı.
  if (context.actorId === context.respondentId) {
    return { allowed: false, reason: "responsible_cannot_close" };
  }

  if (context.actorIsAskerSupervisor) {
    const idleBusinessDays = businessDaysBetween(
      context.lastAskerActionAt,
      context.now,
      { workingDays: context.workingDays, holidays: context.holidays },
    );

    const esik =
      context.supervisorTakeoverDays ?? SUPERVISOR_TAKEOVER_BUSINESS_DAYS;

    if (idleBusinessDays >= esik) {
      return { allowed: true, closeType: "NORMAL", requiresReason: false };
    }

    return { allowed: false, reason: "supervisor_too_early" };
  }

  // Sistem yöneticisinin idari kapatması (§9.3), pasifleştirme sürecini mümkün
  // kılmak içindir: §4.6 açık konuşması olan kullanıcının pasifleştirilmesini
  // engelliyor, §9.3 ise idari kapatmayı "taraf pasifleştirildiyse" koşuluna
  // bağlıyor. İkisi birlikte kilit oluşturuyordu — kimse pasifleştirilemiyor,
  // çünkü konuşma kapanamıyor. Kilit, idari kapatmayı sistem yöneticisine
  // açarak çözüldü; karar ürün sahibine soruldu (açık soru 10).
  // Gerekçe zorunludur: içerik görme yetkisi olmayan işlevsel yönetici bir
  // konuşmayı kapatıyorsa, bunun nedeni sonradan okunabilmelidir (ürün sahibi
  // kararı, açık soru 10).
  if (context.actorIsSystemAdmin) {
    return { allowed: true, closeType: "ADMINISTRATIVE", requiresReason: true };
  }

  return { allowed: false, reason: "not_a_party" };
}
