import type { Prisma, PrismaClient } from "@prisma/client";

import {
  COMPANY_TIME_ZONE,
  companyDay,
  toDateValue,
} from "@/server/activities/date-rules";

import {
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";

import { CURRENT_PERIOD } from "./period-filter";


export type DeputyReadDb = Pick<
  PrismaClient,
  "noActivityPeriod" | "auditLog"
> & ActivityRepositoryDb;

export interface DeputyPeriod {
  id: string;
  personId: string;
  personName: string;
  personUnitName: string;
  startDate: Date;
  endDate: Date;
  note: string | null;
  active: boolean;
  decisionCount: number;
}

export interface DeputyDecision {
  activityId: string;
  activityNo: number;
  activityTitle: string;
  authorName: string;
  action: string;
  at: Date;
  actorName: string;
  onBehalfOfName: string | null;
}

const DECISION_ACTIONS = [
  "activity_approved",
  "activity_changes_requested",
  "activity_rejected",
];


export interface DeputyPeriodFilters {
  personId?: string;
}


function deputyPeriodWhere(
  deputyId: string,
  filters: DeputyPeriodFilters,
): Prisma.NoActivityPeriodWhereInput[] {
  const conditions: Prisma.NoActivityPeriodWhereInput[] = [
    { deputyId },
    CURRENT_PERIOD,
  ];

  if (filters.personId) conditions.push({ userId: filters.personId });

  return conditions;
}


export async function listDeputyPeriods(
  db: DeputyReadDb,
  deputyId: string,
  now: Date = new Date(),
  filters: DeputyPeriodFilters = {},
  options: { limit?: number; skip?: number } = {},
): Promise<DeputyPeriod[]> {
  const today = toDateValue(companyDay(now));

  const rows = await db.noActivityPeriod.findMany({
    where: { AND: deputyPeriodWhere(deputyId, filters) },
    ...(options.limit === undefined ? {} : { take: options.limit }),
    ...(options.skip === undefined ? {} : { skip: options.skip }),
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      userId: true,
      startDate: true,
      endDate: true,
      note: true,
      user: { select: { fullName: true, orgUnit: { select: { name: true } } } },
    },
  });

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      personId: row.userId,
      personName: row.user.fullName,
      personUnitName: row.user.orgUnit.name,
      startDate: row.startDate,
      endDate: row.endDate,
      note: row.note,
      active: row.startDate <= today && row.endDate >= today,
      decisionCount: await db.auditLog.count({
        where: {
          userId: deputyId,
          actualUserId: row.userId,
          action: { in: DECISION_ACTIONS },
          createdAt: periodRange(row.startDate, row.endDate),
        },
      }),
    })),
  );
}

export async function countDeputyPeriods(
  db: DeputyReadDb,
  deputyId: string,
  filters: DeputyPeriodFilters = {},
): Promise<number> {
  return db.noActivityPeriod.count({
    where: { AND: deputyPeriodWhere(deputyId, filters) },
  });
}

export async function listDeputyDecisions(
  db: DeputyReadDb,
  period: { personId: string; deputyId: string; startDate: Date; endDate: Date },
  viewerId: string,
  now: Date = new Date(),
): Promise<DeputyDecision[]> {
  const auditEntries = await db.auditLog.findMany({
    where: {
      userId: period.deputyId,
      actualUserId: period.personId,
      action: { in: DECISION_ACTIONS },
      createdAt: periodRange(period.startDate, period.endDate),
    },
    orderBy: { createdAt: "desc" },
    select: {
      objectId: true,
      action: true,
      createdAt: true,
      user: { select: { fullName: true } },
      actualUser: { select: { fullName: true } },
    },
  });

  if (auditEntries.length === 0) return [];

  const records = await listVisibleActivities(db, {
    id: viewerId,
    isSystemAdmin: false,
  }, {
    where: { id: { in: [...new Set(auditEntries.map((entry) => entry.objectId))] } },
    select: {
      id: true,
      activityNo: true,
      title: true,
      author: { select: { fullName: true } },
    },
  }, undefined, now);

  const recordsById = new Map(records.map((record) => [record.id, record]));

  return auditEntries.flatMap((entry) => {
    const record = recordsById.get(entry.objectId);

    if (!record) return [];

    return [
      {
        activityId: record.id,
        activityNo: record.activityNo,
        activityTitle: record.title,
        authorName: record.author.fullName,
        action: entry.action,
        at: entry.createdAt,
        actorName: entry.user?.fullName ?? "Unknown user",
        onBehalfOfName: entry.actualUser?.fullName ?? null,
      },
    ];
  });
}

export async function listCoveredPeriods(
  db: DeputyReadDb,
  userId: string,
): Promise<DeputyPeriod[]> {
  const rows = await db.noActivityPeriod.findMany({
    where: { userId, deputyId: { not: null }, ...CURRENT_PERIOD },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      deputyId: true,
      startDate: true,
      endDate: true,
      note: true,
      deputy: { select: { fullName: true, orgUnit: { select: { name: true } } } },
    },
  });

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      personId: row.deputyId ?? "",
      personName: row.deputy?.fullName ?? "—",
      personUnitName: row.deputy?.orgUnit.name ?? "—",
      startDate: row.startDate,
      endDate: row.endDate,
      note: row.note,
      active: false,
      decisionCount: await db.auditLog.count({
        where: {
          userId: row.deputyId ?? "",
          actualUserId: userId,
          action: { in: DECISION_ACTIONS },
          createdAt: periodRange(row.startDate, row.endDate),
        },
      }),
    })),
  );
}


function periodRange(startDate: Date, endDate: Date): { gte: Date; lt: Date } {
  return {
    gte: companyDayStart(startDate),
    lt: companyDayStart(nextDay(endDate)),
  };
}


function companyDayStart(dayValue: Date): Date {
  const day = dayValue.toISOString().slice(0, 10);

  const defaultInstant = new Date(`${day}T00:00:00.000Z`);
  const offsetMinutes = istanbulOffsetMinutes(defaultInstant);

  return new Date(defaultInstant.getTime() - offsetMinutes * 60_000);
}

function nextDay(day: Date): Date {
  const nextDate = new Date(day);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate;
}

/**
 * Returns the Europe/Istanbul offset from UTC at the given instant, in minutes.
 *
 * This is the only `Intl.DateTimeFormat` use outside `date-time.ts`. It
 * measures an offset with `formatToParts`; it does not format user-facing
 * text, so it remains here instead of entering the formatting module.
 */
function istanbulOffsetMinutes(instant: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );

  const localTime = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return (localTime - instant.getTime()) / 60_000;
}
