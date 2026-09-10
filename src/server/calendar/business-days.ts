// İş günü hesabı (§12.1). Hafta sonu ve resmî tatillerde sayaç işlemez;
// §9.3'teki "10 iş günü" ve §12.2'deki "3 iş günü" kuralları buradan beslenir.
//
// Tatil listesi parametre olarak alınır: çalışma takvimi yönetimi Görev 5.4'te
// gelecek, o zaman liste veritabanından beslenecek. Kural burada bir kez
// yazıldı; iki yerde ayrı hesap yapmak, ikisinin ayrışması demektir.

import { companyDay } from "@/server/activities/date-rules";

/** ISO gün numarası (1 = Pazartesi … 7 = Pazar). */
function isoWeekday(day: string): number {
  const date = new Date(`${day}T00:00:00.000Z`);
  const jsDay = date.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export interface BusinessDayOptions {
  /** Çalışılan günler; varsayılan Pazartesi–Cuma. */
  workingDays?: number[];
  /** `YYYY-MM-DD` biçiminde resmî tatiller. */
  holidays?: string[];
}

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

export function isBusinessDay(day: string, options: BusinessDayOptions = {}): boolean {
  const workingDays = options.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidays = options.holidays ?? [];

  if (holidays.includes(day)) return false;
  return workingDays.includes(isoWeekday(day));
}

/**
 * İki an arasında geçen **tam iş günü** sayısı. Başlangıç günü sayılmaz:
 * "3 iş günüdür cevap yok" ifadesi, üçüncü iş gününün dolmasını anlatır.
 */
export function businessDaysBetween(
  from: Date,
  to: Date,
  options: BusinessDayOptions = {},
): number {
  const startDay = companyDay(from);
  const endDay = companyDay(to);

  if (endDay <= startDay) return 0;

  let count = 0;
  const cursor = new Date(`${startDay}T00:00:00.000Z`);

  for (let guard = 0; guard < 3650; guard += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.toISOString().slice(0, 10);
    if (day > endDay) break;
    if (isBusinessDay(day, options)) count += 1;
  }

  return count;
}
