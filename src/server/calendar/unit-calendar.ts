import type { PrismaClient } from "@prisma/client";

import { readWorkCalendar } from "./settings";


//

//







//     etkilenmiyor.
//



export type UnitCalendarDb = Pick<
  PrismaClient,
  "orgUnitWorkCalendar" | "orgUnit" | "workCalendar" | "holiday"
>;

export type UnitCalendarWriteDb = UnitCalendarDb &
  Pick<PrismaClient, "$transaction" | "$executeRaw">;


export const WORK_WINDOW_LOCK_KEY = "acta:work_window";

export interface UnitWorkWindow {
  workingDays: number[];
  workStartMinute: number;
  workEndMinute: number;
  worksOnHolidays: boolean;

  source: "unit" | "inherited" | "company";

  sourceUnitName: string | null;
}

export interface UnitCalendarInput {
  workingDays: number[];
  workStartMinute: number;
  workEndMinute: number;
  worksOnHolidays: boolean;
}


export interface UnitCalendarIndex {
  units: Map<string, { id: string; parentId: string | null; name: string }>;
  calendars: Map<string, UnitCalendarInput>;
  company: { workingDays: number[]; workStartMinute: number; workEndMinute: number };
}

export async function loadUnitCalendarIndex(
  db: UnitCalendarDb,
): Promise<UnitCalendarIndex> {
  const [units, calendars, company] = await Promise.all([
    db.orgUnit.findMany({ select: { id: true, parentId: true, name: true } }),
    db.orgUnitWorkCalendar.findMany(),
    readWorkCalendar(db),
  ]);

  return {
    units: new Map(units.map((unit) => [unit.id, unit])),
    calendars: new Map(
      calendars.map((calendar) => [
        calendar.orgUnitId,
        {
          workingDays: calendar.workingDays,
          workStartMinute: calendar.workStartMinute,
          workEndMinute: calendar.workEndMinute,
          worksOnHolidays: calendar.worksOnHolidays,
        },
      ]),
    ),
    company: {
      workingDays: company.workingDays,
      workStartMinute: company.workStartMinute,
      workEndMinute: company.workEndMinute,
    },
  };
}


export function resolveUnitWorkWindowFrom(
  index: UnitCalendarIndex,
  orgUnitId: string,
): UnitWorkWindow {
  let currentUnit = index.units.get(orgUnitId);
  let initial = true;

  while (currentUnit) {
    const calendar = index.calendars.get(currentUnit.id);
    if (calendar) {
      return {
        workingDays: [...calendar.workingDays].sort((a, b) => a - b),
        workStartMinute: calendar.workStartMinute,
        workEndMinute: calendar.workEndMinute,
        worksOnHolidays: calendar.worksOnHolidays,
        source: initial ? "unit" : "inherited",
        sourceUnitName: initial ? null : currentUnit.name,
      };
    }

    initial = false;
    currentUnit = currentUnit.parentId
      ? index.units.get(currentUnit.parentId)
      : undefined;
  }



  return {
    workingDays: index.company.workingDays,
    workStartMinute: index.company.workStartMinute,
    workEndMinute: index.company.workEndMinute,
    worksOnHolidays: false,
    source: "company",
    sourceUnitName: null,
  };
}


export async function resolveUnitWorkWindow(
  db: UnitCalendarDb,
  orgUnitId: string,
): Promise<UnitWorkWindow> {
  return resolveUnitWorkWindowFrom(await loadUnitCalendarIndex(db), orgUnitId);
}

/** Saves or updates a unit's work window. */
export async function saveUnitWorkCalendar(
  db: UnitCalendarWriteDb,
  orgUnitId: string,
  input: UnitCalendarInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${WORK_WINDOW_LOCK_KEY}))`;

    await tx.orgUnitWorkCalendar.upsert({
      where: { orgUnitId },
      update: input,
      create: { orgUnitId, ...input },
    });
  });
}

/** Removes a unit's own definition so it inherits from its parent again. */
export async function clearUnitWorkCalendar(
  db: UnitCalendarWriteDb,
  orgUnitId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${WORK_WINDOW_LOCK_KEY}))`;

    await tx.orgUnitWorkCalendar.deleteMany({ where: { orgUnitId } });
  });
}
