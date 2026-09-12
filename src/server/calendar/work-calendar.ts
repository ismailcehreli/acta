import type { PrismaClient } from "@prisma/client";

import { companyDay } from "@/server/activities/date-rules";



//




export type WorkCalendarDb = Pick<PrismaClient, "workCalendar" | "holiday">;

export interface CompanyWorkCalendar {

  workingDays?: number[];

  holidays: string[];
}


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
