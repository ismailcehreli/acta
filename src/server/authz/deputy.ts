import type { PrismaClient } from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { CURRENT_PERIOD } from "@/server/absence/period-filter";


//




//


//


//

//





//




//




export type DeputyDb = Pick<PrismaClient, "noActivityPeriod">;

export interface DeputyPeriodRange {

  personId: string;
  startDate: Date;
  endDate: Date;
}


export async function allDeputyPeriods(
  db: DeputyDb,
  deputyId: string,
): Promise<DeputyPeriodRange[]> {
  const rows = await db.noActivityPeriod.findMany({
    where: { deputyId, ...CURRENT_PERIOD },
    select: { userId: true, startDate: true, endDate: true },
  });

  return rows.map((row) => ({
    personId: row.userId,
    startDate: row.startDate,
    endDate: row.endDate,
  }));
}


export async function activeDeputyFor(
  db: DeputyDb,
  deputyId: string,
  now: Date,
): Promise<string[]> {
  const today = toDateValue(companyDay(now));

  const rows = await db.noActivityPeriod.findMany({
    where: {
      deputyId,
      ...CURRENT_PERIOD,
      startDate: { lte: today },
      endDate: { gte: today },
    },
    select: { userId: true },
  });

  return [...new Set(rows.map((row) => row.userId))];
}


export async function activeDeputiesOfMany(
  db: DeputyDb,
  userIds: string[],
  now: Date,
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const today = toDateValue(companyDay(now));

  const rows = await db.noActivityPeriod.findMany({
    where: {
      userId: { in: userIds },
      deputyId: { not: null },
      ...CURRENT_PERIOD,
      startDate: { lte: today },
      endDate: { gte: today },
    },
    select: { deputyId: true },
  });

  return [
    ...new Set(
      rows
        .map((row) => row.deputyId)
        .filter((id): id is string => id !== null),
    ),
  ];
}
