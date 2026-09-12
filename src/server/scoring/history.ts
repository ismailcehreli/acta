import type { Prisma } from "@prisma/client";

import {
  DEFAULT_WORK_CALENDAR,
} from "@/server/calendar/settings";
import {
  type UnitCalendarIndex,
} from "@/server/calendar/unit-calendar";
import { findSetting } from "@/server/settings/registry";
import {
  SETTING_KEYS,
} from "@/server/settings/system-settings";
import { companyDay, nextCompanyDayStart } from "@/shared/format/date-time";

import type { ScoreWeights } from "./compute";

export interface HistoricalScoreUser {
  id: string;
  createdAt: Date;
  activeFrom: Date;
  activeTo: Date;
  isUnitManager: boolean;
  orgUnitId: string;
  requiresApproval: boolean;
}

export interface HistoricalScoreEnvironment {
  users: HistoricalScoreUser[];
  unitCalendarIndex: UnitCalendarIndex;
  companyCalendar: { workingDays?: number[]; holidays: string[] };
  weights: ScoreWeights;
  appreciationPointsPer: number;
  approvalThreshold: number;
  answerThreshold: number;
  followUpThreshold: number;
}


export async function retroactiveEntryDaysAtPeriodEnd(
  db: Prisma.TransactionClient,
  periodEnd: Date,
): Promise<number> {
  const definition = findSetting(SETTING_KEYS.retroactiveEntryDays);
  if (!definition) {
    throw new Error("The backdated-entry setting is not defined in the registry.");
  }




  const until = nextCompanyDayStart(companyDay(periodEnd));
  const event = await db.scoreSettingEvent.findFirst({
    where: {
      key: SETTING_KEYS.retroactiveEntryDays,
      effectiveAt: { lt: until },
    },
    orderBy: [
      { effectiveAt: "desc" },
      { recordedAt: "desc" },
      { id: "desc" },
    ],
    select: { value: true },
  });
  const value = Number(event?.value ?? definition.defaultValue);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("The backdated-entry setting at period end is invalid.");
  }
  return value;
}

function day(date: Date): Date {
  return new Date(`${companyDay(date)}T00:00:00.000Z`);
}

function previousDay(date: Date): Date {
  const result = day(date);
  result.setUTCDate(result.getUTCDate() - 1);
  return result;
}

function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}

function minDate(a: Date, b: Date): Date {
  return a < b ? a : b;
}

function latestBy<T>(
  rows: T[],
  key: (row: T) => string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) result.set(key(row), row);
  return result;
}

function eligible(state: {
  isActive: boolean;
  isScored: boolean;
  writesActivities: boolean;
}): boolean {
  return state.isActive && state.isScored && state.writesActivities;
}

/**
 * Build the user/organization/calendar view as of the end of a given month.
 * Events are deterministically ordered by effective date, recorded date, and id;
 * a reasoned correction recorded later on the same effective date wins.
 */
export async function loadHistoricalScoreEnvironment(
  db: Prisma.TransactionClient,
  from: Date,
  to: Date,
): Promise<HistoricalScoreEnvironment> {
  const until = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1));

  const [
    currentUsers,
    userEvents,
    currentUnits,
    orgEvents,
    unitCalendarEvents,
    companyCalendarEvents,
    holidayEvents,
    settingEvents,
  ] = await Promise.all([
    db.user.findMany({
      select: {
        id: true,
        createdAt: true,
        isActive: true,
        isScored: true,
        writesActivities: true,
        isUnitManager: true,
        orgUnitId: true,
      },
    }),
    db.scoreUserStateEvent.findMany({
      where: { effectiveAt: { lt: until } },
      orderBy: [{ userId: "asc" }, { effectiveAt: "asc" }, { recordedAt: "asc" }, { id: "asc" }],
    }),
    db.orgUnit.findMany({
      select: {
        id: true,
        parentId: true,
        name: true,
        isActive: true,
        requiresApproval: true,
      },
    }),
    db.scoreOrgUnitStateEvent.findMany({
      where: { effectiveAt: { lt: until } },
      orderBy: [{ orgUnitId: "asc" }, { effectiveAt: "asc" }, { recordedAt: "asc" }, { id: "asc" }],
    }),
    db.scoreUnitCalendarEvent.findMany({
      where: { effectiveAt: { lt: until } },
      orderBy: [{ orgUnitId: "asc" }, { effectiveAt: "asc" }, { recordedAt: "asc" }, { id: "asc" }],
    }),
    db.scoreCompanyCalendarEvent.findMany({
      where: { effectiveAt: { lt: until } },
      orderBy: [{ effectiveAt: "asc" }, { recordedAt: "asc" }, { id: "asc" }],
    }),
    db.scoreHolidayEvent.findMany({
      where: { effectiveAt: { lt: until }, holidayDate: { gte: from, lte: to } },
      orderBy: [{ holidayDate: "asc" }, { effectiveAt: "asc" }, { recordedAt: "asc" }, { id: "asc" }],
    }),
    db.scoreSettingEvent.findMany({
      where: { effectiveAt: { lt: until } },
      orderBy: [{ key: "asc" }, { effectiveAt: "asc" }, { recordedAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const userEventsById = new Map<string, typeof userEvents>();
  for (const event of userEvents) {
    const list = userEventsById.get(event.userId) ?? [];
    list.push(event);
    userEventsById.set(event.userId, list);
  }

  const latestOrg = latestBy(orgEvents, (event) => event.orgUnitId);
  const unitById = new Map(
    currentUnits.map((unit) => {
      const historical = latestOrg.get(unit.id);
      return [
        unit.id,
        {
          id: unit.id,
          parentId: historical?.parentId ?? unit.parentId,
          name: unit.name,
          isActive: historical?.isActive ?? unit.isActive,
          requiresApproval:
            historical?.requiresApproval ?? unit.requiresApproval,
        },
      ] as const;
    }),
  );

  const users: HistoricalScoreUser[] = [];
  for (const current of currentUsers) {
    const events = userEventsById.get(current.id) ?? [];
    const fallback = {
      isActive: current.isActive,
      isScored: current.isScored,
      writesActivities: current.writesActivities,
      isUnitManager: current.isUnitManager,
      orgUnitId: current.orgUnitId,
      effectiveAt: current.createdAt,
    };

    const beforeStart = events.filter((event) => event.effectiveAt <= from).at(-1);
    let state = beforeStart ?? fallback;
    let activeFrom: Date | null = eligible(state)
      ? maxDate(maxDate(from, day(state.effectiveAt)), day(current.createdAt))
      : null;
    let activeTo: Date | null = null;
    let scoreState = eligible(state) ? state : null;

    for (const event of events.filter(
      (candidate) => candidate.effectiveAt > from && candidate.effectiveAt < until,
    )) {
      const wasEligible = eligible(state);
      const isEligible = eligible(event);
      if (!wasEligible && isEligible && activeFrom === null) {
        activeFrom = maxDate(
          maxDate(from, day(event.effectiveAt)),
          day(current.createdAt),
        );
      }
      if (wasEligible && !isEligible && activeFrom !== null && activeTo === null) {
        activeTo = minDate(to, previousDay(event.effectiveAt));
      }
      if (isEligible) scoreState = event;
      state = event;
    }

    if (activeFrom === null) continue;
    activeTo ??= to;
    if (activeFrom > activeTo || !scoreState) continue;

    const unit = unitById.get(scoreState.orgUnitId);
    if (!unit || !unit.isActive) continue;

    users.push({
      id: current.id,
      createdAt: current.createdAt,
      activeFrom,
      activeTo,
      isUnitManager: scoreState.isUnitManager,
      orgUnitId: scoreState.orgUnitId,
      requiresApproval: unit.requiresApproval,
    });
  }

  // The dated tree is the basis for calendar inheritance.
  const unitCalendarIndex: UnitCalendarIndex = {
    units: new Map(
      [...unitById.values()].map((unit) => [
        unit.id,
        { id: unit.id, parentId: unit.parentId, name: unit.name },
      ]),
    ),
    // The current calendar row is not a historical fallback. A unit may have
    // received its own calendar for the first time after the period ended; copying
    // that row here would move the new window backwards in time.
    calendars: new Map(),
    company: { ...DEFAULT_WORK_CALENDAR },
  };

  const latestUnitCalendars = latestBy(
    unitCalendarEvents,
    (event) => event.orgUnitId,
  );
  for (const [orgUnitId, event] of latestUnitCalendars) {
    if (!event.hasOwnCalendar) {
      unitCalendarIndex.calendars.delete(orgUnitId);
      continue;
    }
    unitCalendarIndex.calendars.set(orgUnitId, {
      workingDays: event.workingDays,
      workStartMinute: event.workStartMinute,
      workEndMinute: event.workEndMinute,
      worksOnHolidays: event.worksOnHolidays,
    });
  }

  const historicalCompany = companyCalendarEvents.at(-1);
  const companyWorkingDays =
    historicalCompany?.workingDays ?? DEFAULT_WORK_CALENDAR.workingDays;
  unitCalendarIndex.company = {
    workingDays: companyWorkingDays,
    workStartMinute:
      historicalCompany?.workStartMinute ??
      DEFAULT_WORK_CALENDAR.workStartMinute,
    workEndMinute:
      historicalCompany?.workEndMinute ?? DEFAULT_WORK_CALENDAR.workEndMinute,
  };

  // A holiday's presence in the current table does not prove it was known during
  // the target period. The migration seeds existing holidays with a CUTOVER event;
  // later additions/removals appear only from their effective date.
  const holidayByDay = new Map<string, boolean>();
  for (const event of holidayEvents) {
    holidayByDay.set(day(event.holidayDate).toISOString().slice(0, 10), event.isHoliday);
  }
  const holidays = [...holidayByDay]
    .filter(([, isHoliday]) => isHoliday)
    .map(([date]) => date)
    .sort();

  const settingByKey = latestBy(settingEvents, (event) => event.key);
  const numeric = (key: string): number => {
    const historical = settingByKey.get(key);
    if (historical) return Number(historical.value);

    const definition = findSetting(key);
    if (!definition) throw new Error(`Unknown historical setting key: ${key}`);
    // The current setting cannot be a historical fallback. The migration carries
    // all existing values through a CUTOVER event; settings added later use their
    // catalog default in earlier periods.
    return Number(definition.defaultValue);
  };

  const regularity = numeric(SETTING_KEYS.scoringWeightRegularity);
  const acceptance = numeric(SETTING_KEYS.scoringWeightAcceptance);
  const approval = numeric(SETTING_KEYS.scoringWeightApproval);
  const followUp = numeric(SETTING_KEYS.scoringWeightFollowUp);
  const appreciationPointsPer = numeric(SETTING_KEYS.scoringAppreciationPoints);
  const approvalThreshold = numeric(SETTING_KEYS.pendingApprovalBusinessDays);
  const answerThreshold = numeric(SETTING_KEYS.overdueAnswerBusinessDays);
  const followUpThreshold = numeric(SETTING_KEYS.followUpStaleBusinessDays);

  return {
    users,
    unitCalendarIndex,
    companyCalendar: {
      workingDays: companyWorkingDays.length
        ? companyWorkingDays
        : DEFAULT_WORK_CALENDAR.workingDays,
      holidays,
    },
    weights: { regularity, acceptance, approval, followUp },
    appreciationPointsPer,
    approvalThreshold,
    answerThreshold,
    followUpThreshold,
  };
}
