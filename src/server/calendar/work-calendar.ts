import type { PrismaClient } from "@prisma/client";

import { companyDay } from "@/server/activities/date-rules";

// Çalışma takvimini veritabanından okur (§12.1). İş günü hesabı yapan her yol
// buradan beslenir; takvimi iki ayrı yerde kurmak, ikisinin ayrışması demektir.
//
// Takvim yönetim ekranı Görev 5.4'te gelecek. Kayıt henüz yoksa hafta içi
// varsayılanı kullanılır — bu bir varsayım değil, `business-days.ts` içindeki
// aynı varsayılanın tekrarıdır.

export type WorkCalendarDb = Pick<PrismaClient, "workCalendar" | "holiday">;

export interface CompanyWorkCalendar {
  /** ISO gün numaraları (1 = Pazartesi … 7 = Pazar); kayıt yoksa `undefined`. */
  workingDays?: number[];
  /** `YYYY-MM-DD` biçiminde resmî tatiller. */
  holidays: string[];
}

/**
 * Verilen aralığı kapsayan tatilleri ve çalışma günlerini yükler. Aralık dışı
 * tatiller okunmaz: sayaç yalnız iki an arasında işler.
 */
export async function loadWorkCalendar(
  db: WorkCalendarDb,
  from: Date,
  to: Date,
): Promise<CompanyWorkCalendar> {
  const [calendar, holidays] = await Promise.all([
    db.workCalendar.findFirst({ select: { workingDays: true } }),
    db.holiday.findMany({
      where: {
        date: {
          gte: new Date(`${companyDay(from)}T00:00:00.000Z`),
          lte: new Date(`${companyDay(to)}T00:00:00.000Z`),
        },
      },
      select: { date: true },
    }),
  ]);

  return {
    workingDays: calendar?.workingDays.length ? calendar.workingDays : undefined,
    holidays: holidays.map((row) => row.date.toISOString().slice(0, 10)),
  };
}
