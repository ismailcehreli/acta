import { companyDay } from "@/server/activities/date-rules";
import { companyMinuteOfDay } from "@/shared/format/date-time";
import { isBusinessDay } from "@/server/calendar/business-days";
import type { CompanyWorkCalendar } from "@/server/calendar/work-calendar";

// Mesai saati hesapları (§12.1). Saf fonksiyonlar: hatırlatmalar sahte saatle
// sınanabilsin diye veritabanına dokunmazlar.
//
// Şirket saati Europe/Istanbul'dur (§16.6); gün ve saat her zaman oradan
// okunur, sunucunun yerel saatinden değil.

// Dakika hesabı `@/shared/format/date-time` içindedir ve buradan yeniden dışa
// verilir: zaman dilimi tanımı tek yerde durmalı (Görev 11.1).
export { companyMinuteOfDay } from "@/shared/format/date-time";

export interface WorkDayState {
  /** Bugün çalışma günü mü (hafta sonu ve resmî tatil değil). */
  isWorkingDay: boolean;
  /** Mesai bitişi geçti mi. */
  afterWorkEnd: boolean;
  /** `YYYY-MM-DD`, şirket saatiyle. */
  day: string;
}

export function describeWorkDay(
  now: Date,
  calendar: CompanyWorkCalendar,
  workEndMinute: number,
): WorkDayState {
  const day = companyDay(now);

  return {
    day,
    isWorkingDay: isBusinessDay(day, {
      workingDays: calendar.workingDays,
      holidays: calendar.holidays,
    }),
    afterWorkEnd: companyMinuteOfDay(now) >= workEndMinute,
  };
}

/**
 * Mesai sonu hatırlatması gönderilecek mi? Üç koşul birlikte: bugün çalışma
 * günü olmalı, mesai bitmiş olmalı ve kişi bugün faaliyet girmemiş olmalı.
 * "Faaliyet beklenmiyor" işareti ayrıca sorulur (§12.1).
 */
export function shouldRemindForMissingActivity(state: WorkDayState): boolean {
  return state.isWorkingDay && state.afterWorkEnd;
}
