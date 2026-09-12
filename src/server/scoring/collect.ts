import type { FollowUpEventKind, PrismaClient } from "@prisma/client";

import {
  companyDay,
  companyDayStart,
  nextCompanyDayStart,
  toDateValue,
} from "@/shared/format/date-time";
import { activityMaintenanceReader } from "@/server/authz/activity-repository";
import {
  visibleActivityWhere,
  type VisibilityDb,
  type Viewer,
} from "@/server/authz/visibility";
import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import type { CompanyWorkCalendar } from "@/server/calendar/work-calendar";
import {
  loadUnitCalendarIndex,
  resolveUnitWorkWindowFrom,
  type UnitCalendarIndex,
} from "@/server/calendar/unit-calendar";
import {
  SETTING_KEYS,
  readNumericSetting,
} from "@/server/settings/system-settings";

import type { ScoreInput } from "./compute";


export type ScoreInputWithFacts = ScoreInput & { facts: ScoreFactRow[] };


export interface ScoreFactRow {
  activityId: string;
  kind: "WRITTEN" | "ACCEPTED" | "DECISION" | "OBLIGATION" | "APPRECIATION";
  /** `YYYY-MM-DD`. */
  happenedOn: string;
  onTime: boolean;
}
import {
  answerResponsibilities,
  isInPeriod,
  itemClosure,
  itemLastMovement,
} from "./follow-up-discipline";


//

//





//


export type ScoreCollectDb = VisibilityDb &
  Pick<
  PrismaClient,
  | "activity"
  | "user"
  | "noActivityPeriod"
  | "holiday"
  | "workCalendar"
  | "orgUnit"
  | "orgUnitWorkCalendar"
  | "approvalRound"
  | "followUpItem"
  | "conversation"
  | "conversationMessage"
  | "activityAppreciation"
  | "systemSetting"
  >;


function dayRange(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(from);

  while (cursor <= to) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}


export async function expectedWorkDays(
  db: ScoreCollectDb,
  orgUnitId: string,
  from: Date,
  to: Date,
): Promise<string[]> {
  const [calendarIndex, companyCalendar] = await Promise.all([
    loadUnitCalendarIndex(db),
    loadWorkCalendar(db, from, to),
  ]);

  return expectedWorkDaysFrom(
    calendarIndex,
    orgUnitId,
    from,
    to,
    companyCalendar.holidays,
  );
}


export function expectedWorkDaysFrom(
  calendarIndex: UnitCalendarIndex,
  orgUnitId: string,
  from: Date,
  to: Date,
  holidays: string[],
): string[] {
  const workWindow = resolveUnitWorkWindowFrom(calendarIndex, orgUnitId);
  const holidaySet = new Set(holidays);

  return dayRange(from, to).filter((day) => {
    const isoDay = new Date(`${day}T00:00:00.000Z`).getUTCDay() || 7;
    if (!workWindow.workingDays.includes(isoDay)) return false;

    // A holiday is also a business day for a unit that works on holidays
    // (Task 11.9).
    if (holidaySet.has(day) && !workWindow.worksOnHolidays) return false;

    return true;
  });
}

/**
 * A person's score input for a period.
 *
 * **Days, not records**, are counted: five records on one day count as one
 * day. Counting records would reward splitting one piece of work into five
 * entries and reduce content quality as the system fills up.
 */
export async function collectScoreInput(
  db: ScoreCollectDb,
  viewer: Viewer,
  userId: string,
  /** First day of the period (date-only field). */
  from: Date,
  /** Last day of the period (date-only field). */
  to: Date,
  /**
   * The **exclusive** upper instant for timestamped events. In a live period
   * this is `now`; in a closed period it is the start of the company day
   * after the period's last date.
   *
   * A date-only field and a timestamp cannot use the same boundary: August 31
   * is inclusive for a date field, while midnight on that day excludes the
   * rest of the day for a timestamp (audit finding P3-3, 23.08.2026).
   */
  until: Date = nextCompanyDayStart(companyDay(to)),
): Promise<ScoreInputWithFacts> {
  // **The single-person path also uses the batch path** (merged during the
  // 25.08.2026 P8-2 audit).
  // Separate collectors could drift when a rule changed in only one of them.
  // The closure job uses the single-person path while the screen uses the
  // batch path, so the drift directly changed the displayed closed score.
  const ctx = await loadScoreContext(db, viewer);
  const inputs = await collectScoreInputs(db, ctx, [userId], from, to, until);

  return inputs.get(userId) ?? EMPTY_SCORE_INPUT;
}

/** A missing person means an **unmeasured** period, not zero. */
const EMPTY_SCORE_INPUT: ScoreInputWithFacts = {
  expectedDays: 0,
  writtenDays: 0,
  writtenCount: 0,
  approvedCount: 0,
  decidedCount: 0,
  decidedOnTimeCount: 0,
  followUpTotal: 0,
  followUpHandled: 0,
  appreciationCount: 0,
  appreciationPointsPer: 0,
  facts: [],
};

/**
 * Calculates one person's period input **without additional queries**.
 *
 * Collection and calculation were separated after audit finding 9
 * (23.08.2026): both single-person and batch paths call this same calculation,
 * so the team list and profile cannot show different scores.
 */
export function calculateScoreInput(input: {
  userId: string;
  instantStart: Date;
  until: Date;
  measurementInstant: Date;
  workDays: string[];
  absences: { startDate: Date; endDate: Date }[];
  records: {
    id: string;
    activityDate: Date;
    approvalStatus: string;
    approverId: string | null;
    /** The **last** decision made by the period end, or null. */
    approvalRounds: { decision: string | null; decidedAt: Date | null }[];
  }[];
  decisions: { activityId: string; submittedAt: Date; decidedAt: Date | null }[];
  followUpItems: {
    activityId: string;
    openedAt: Date;
    events: { kind: FollowUpEventKind; createdAt: Date }[];
  }[];
  conversations: {
    activityId: string;
    askerId: string;
    openedAt: Date;
    closedAt: Date | null;
    activity: { authorId: string };
    messages: { authorId: string; createdAt: Date }[];
  }[];
  appreciations: { activityId: string; createdAt: Date }[];
  calendarSetting: { workingDays: number[] };
  companyCalendar: { holidays: string[] };
  approvalThreshold: number;
  answerThreshold: number;
  followUpThreshold: number;
  appreciationPointsPer: number;
}): ScoreInputWithFacts {
  const {
    userId,
    instantStart,
    until,
    measurementInstant,
    workDays,
    absences,
    records,
    decisions,
    followUpItems,
    conversations,
    appreciations,
    appreciationPointsPer,
    calendarSetting,
    companyCalendar,
    approvalThreshold,
    answerThreshold,
    followUpThreshold,
  } = input;

  const calendar = {
    workingDays: calendarSetting.workingDays,
    holidays: companyCalendar.holidays,
  };

  // Absence days are removed from the denominator.
  const absenceDays = new Set<string>();
  for (const leave of absences) {
    for (const day of dayRange(leave.startDate, leave.endDate)) {
      absenceDays.add(day);
    }
  }
  const expectedDays = workDays.filter((day) => !absenceDays.has(day));

  // Count **days**, not records.
  //
  // Intersect the numerator with denominator days (audit finding 10,
  // 23.08.2026). The denominator removes weekends, holidays, and no-activity
  // periods. Previously the numerator counted every record date, so entries
  // on leave, weekends, or holidays increased the numerator while shrinking
  // the denominator and could push the ratio above 100%.
  //
  // This was not only a wrong number: the `UserScorePeriod_valid_days`
  // constraint rejected `writtenDays > expectedDays`, so the **period-closure
  // worker failed** and wrote no scores for anyone that month.
  //
  // Regularity asks how many expected days received an entry; writing on an
  // unexpected day does not answer that question. The record remains in the
  // feed, list, and search; it is simply excluded from this **ratio**.
  const expectedDaySet = new Set(expectedDays);
  const writtenDays = new Set(
    records
      .map((record) =>
        companyDay(toDateValue(record.activityDate.toISOString().slice(0, 10))),
      )
      .filter((day) => expectedDaySet.has(day)),
  );

  // **Acceptance is evaluated using the period-end truth** (audit 25.08.2026,
  // P8-2).
  //
  // The current `approvalStatus` used to be read first: an approval given
  // after the period ended could change a historical score. For approval-
  // required records, acceptance comes from **decision turns**; a record in
  // a unit without approval is approved at creation and has no turn.
  const acceptedAtPeriodEnd = (record: (typeof records)[number]): boolean => {
    if (record.approverId === null) {
      // A unit without approval creates approved records. Cancelled records
      // do not reach this point because an in-period cancellation is filtered.
      return record.approvalStatus !== "REJECTED";
    }
    return record.approvalRounds[0]?.decision === "APPROVED";
  };

  const approved = records.filter(acceptedAtPeriodEnd).length;
  const approvedRecordIds = new Set(
    records.filter(acceptedAtPeriodEnd).map((record) => record.id),
  );
  const validAppreciations = appreciations.filter((appreciation) =>
    approvedRecordIds.has(appreciation.activityId),
  );

  // **Approval time is measured** (audit finding 6, 23.08.2026).
  //
  // Previously `decidedOnTimeCount` always equaled the decision count: the
  // submission and decision instants were selected, but business days between
  // them were never calculated, giving every late manager full credit.
  //
  // The counter uses the **company-wide** calendar (design line 440), and the
  // threshold is the same setting used by reminders. Divergence would let the
  // reminder say "late" while the score said "on time".
  const onTimeDecisions = decisions.filter(
    (decision) =>
      businessDaysBetween(
        decision.submittedAt,
        decision.decidedAt!,
        calendar,
      ) < approvalThreshold,
  ).length;

  // **Follow-up discipline means handling items on time.**
  //
  // An item is successful if it is closed by period end, or is still open but
  // below the threshold. Measurement starts at **opening** because the design
  // measures closure. The current `lastMovedAt` is not used: later movement
  // would change historical results after period close (P3-2).
  const periodItems = followUpItems
    .map((item) => {
      const view = { openedAt: item.openedAt, events: item.events };
      return {
        activityId: item.activityId,
        openedAt: item.openedAt,
        closure: itemClosure(view),
        lastMovement: itemLastMovement(view),
      };
    })
    .filter(({ closure }) => closure === null || closure >= instantStart);

  const itemHandled = ({
    closure,
    lastMovement,
  }: {
    closure: Date | null;
    lastMovement: Date;
  }): boolean =>
    closure !== null
      ? true
      : businessDaysBetween(lastMovement, measurementInstant, calendar) < followUpThreshold;

  const handledItems = periodItems.filter(itemHandled).length;

  // Each round opened by the other side creates an answer obligation. Duties
  // intersecting the period form the denominator; those closed before the
  // threshold form the numerator.
  const obligations = conversations
    .flatMap((conversation) =>
      answerResponsibilities(
        {
          askerId: conversation.askerId,
          respondentId: conversation.activity.authorId,
          openedAt: conversation.openedAt,
          closure: conversation.closedAt,
          messages: conversation.messages,
        },
        userId,
        measurementInstant,
      ).map((obligation) => ({ ...obligation, activityId: conversation.activityId })),
    )
    .filter((obligation) => isInPeriod(obligation, instantStart, until))
    // **A question closed without an answer is excluded** (product decision,
    // 23.08.2026; audit P3-R2-2). The asker or a system administrator can
    // close a conversation, removing the person's opportunity to answer.
    // Counting success would depend on **someone else's** action; counting
    // failure would penalize the person for something they did not do.
    .filter((obligation) => obligation.end !== "CLOSED");

  const obligationOnTime = (obligation: { startedAt: Date; endedAt: Date }): boolean =>
    businessDaysBetween(obligation.startedAt, obligation.endedAt, calendar) < answerThreshold;

  const answeredQuestions = obligations.filter(obligationOnTime).length;

  // ── Fact rows ──────────────────────────────────────────────────────────
  // The same calculation also produces **facts** (P3-R2-4). Period closure
  // stores them; closed periods are not recalculated, but the rows still pass
  // through the viewer's visibility filter. Counts and facts must share one
  // source so live and closed periods cannot silently diverge.
  const facts: ScoreFactRow[] = [
    ...records.map((record) => {
      const day = companyDay(
        toDateValue(record.activityDate.toISOString().slice(0, 10)),
      );
      return {
        activityId: record.id,
        kind: "WRITTEN" as const,
        happenedOn: day,
        // Only records on an **expected day** enter the regularity numerator;
        // the acceptance denominator contains every record.
        onTime: expectedDaySet.has(day),
      };
    }),
    ...records
      .filter(acceptedAtPeriodEnd)
      .map((record) => ({
        activityId: record.id,
        kind: "ACCEPTED" as const,
        happenedOn: companyDay(
          toDateValue(record.activityDate.toISOString().slice(0, 10)),
        ),
        onTime: true,
      })),
    ...decisions.map((decision) => ({
      activityId: decision.activityId,
      kind: "DECISION" as const,
      happenedOn: companyDay(decision.decidedAt!),
      onTime:
        businessDaysBetween(
          decision.submittedAt,
          decision.decidedAt!,
          calendar,
        ) < approvalThreshold,
    })),
    ...periodItems.map((item) => ({
      activityId: item.activityId,
      kind: "OBLIGATION" as const,
      happenedOn: companyDay(item.closure ?? item.openedAt),
      onTime: itemHandled(item),
    })),
    ...obligations.map((obligation) => ({
      activityId: obligation.activityId,
      kind: "OBLIGATION" as const,
      happenedOn: companyDay(obligation.endedAt),
      onTime: obligationOnTime(obligation),
    })),
    ...validAppreciations.map((appreciation) => ({
      activityId: appreciation.activityId,
      kind: "APPRECIATION" as const,
      happenedOn: companyDay(appreciation.createdAt),
      onTime: true,
    })),
  ];

  return {
    expectedDays: expectedDays.length,
    writtenDays: writtenDays.size,
    writtenCount: records.length,
    approvedCount: approved,
    // A record without a submission instant is counted **nowhere**. Including
    // an unmeasurable decision in the denominator would turn missing data
    // into an apparent manager failure.
    decidedCount: decisions.length,
    decidedOnTimeCount: onTimeDecisions,
    followUpTotal: periodItems.length + obligations.length,
    followUpHandled: handledItems + answeredQuestions,
    appreciationCount: validAppreciations.length,
    appreciationPointsPer,
    facts,
  };
}


// ── Batch collection ─────────────────────────────────────────────────────
// The team list used to run a multi-table calculation separately for every
// person (audit finding 9, 23.08.2026): about 49 queries per person. The design
// explicitly forbids that cost.
//
// This path loads each table once with `userId IN (…)`, groups rows in memory,
// and calls the same `calculateScoreInput` function as the single-person path.

/** Context loaded once per request, independent of person count. */
export interface ScoreContext {
  /** Predicate for records visible to the viewer; resolved once. */
  scope: Awaited<ReturnType<typeof visibleActivityWhere>>;
  calendarIndex: UnitCalendarIndex;
  calendarSetting: { workingDays: number[] };
  approvalThreshold: number;
  answerThreshold: number;
  followUpThreshold: number;
  appreciationPointsPer: number;
}

export async function loadScoreContext(
  db: ScoreCollectDb,
  viewer: Viewer,
): Promise<ScoreContext> {
  const [
    scope,
    calendarIndex,
    calendarSetting,
    approvalThreshold,
    answerThreshold,
    followUpThreshold,
    appreciationPointsPer,
  ] =
    await Promise.all([
      visibleActivityWhere(db, viewer),
      loadUnitCalendarIndex(db),
      readWorkCalendar(db),
      readNumericSetting(db, SETTING_KEYS.pendingApprovalBusinessDays),
      readNumericSetting(db, SETTING_KEYS.overdueAnswerBusinessDays),
      readNumericSetting(db, SETTING_KEYS.followUpStaleBusinessDays),
      readNumericSetting(db, SETTING_KEYS.scoringAppreciationPoints),
    ]);

  return {
    scope,
    calendarIndex,
    calendarSetting: { workingDays: calendarSetting.workingDays },
    approvalThreshold,
    answerThreshold,
    followUpThreshold,
    appreciationPointsPer,
  };
}

/** Groups rows by key; a missing key produces an empty array. */
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const existing = result.get(groupKey);
    if (existing) existing.push(row);
    else result.set(groupKey, [row]);
  }
  return result;
}

/**
 * Period inputs for multiple people with a query count **independent of the
 * number of people**.
 *
 * There is one viewer: scope is resolved once and the same predicate is
 * applied to everyone. All scores are calculated from that viewer's point of
 * view.
 */
export async function collectScoreInputs(
  db: ScoreCollectDb,
  ctx: ScoreContext,
  userIds: string[],
  from: Date,
  to: Date,
  until: Date = nextCompanyDayStart(companyDay(to)),
  overrides?: {
  /** The person's unit during the period at historical close. */
    orgUnitByUser?: Map<string, string>;
    /** Historical company calendar and holiday set. */
    companyCalendar?: CompanyWorkCalendar;
  },
): Promise<Map<string, ScoreInputWithFacts>> {
  const result = new Map<string, ScoreInputWithFacts>();
  if (userIds.length === 0) return result;

  const instantStart = companyDayStart(companyDay(from));
  const measurementInstant = new Date(until.getTime() - 1);

  const [
    people,
    absences,
    records,
    decisions,
    followUpItems,
    conversations,
    appreciations,
  ] =
    await Promise.all([
      db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, orgUnitId: true },
      }),
      db.noActivityPeriod.findMany({
        where: {
          userId: { in: userIds },
          // Pending and rejected requests do not affect the measurement.
          // Approved requests are evaluated by their cancellation time.
          status: "APPROVED",
          // **Cancellation is evaluated at period end** (audit 25.08.2026,
          // P8-2). The current-state predicate only says "not cancelled
          // today"; leave cancelled after the period was valid during it and
          // must reduce the denominator. Looking at today's state would grow a
          // closed period's denominator after a late cancellation.
          OR: [{ cancelledAt: null }, { cancelledAt: { gte: until } }],
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: { userId: true, startDate: true, endDate: true },
      }),
      activityMaintenanceReader(db).findMany({
        where: {
          AND: [
            ctx.scope,
            { authorId: { in: userIds } },
            { activityDate: { gte: from, lte: to } },
            // **Cancellation uses the period end** (audit 25.08.2026, P8-2).
            // Reading only the status would let a late cancellation erase a
            // historical record. The cancellation row is timestamped: a
            // cancellation during the period is excluded; a later one stays.
            {
              OR: [
                { approvalStatus: { not: "CANCELLED" } },
                { cancellation: { createdAt: { gte: until } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          authorId: true,
          activityDate: true,
          approvalStatus: true,
          approverId: true,
          createdAt: true,
          // Acceptance comes from the decision **made by period end**: the
          // status column describes today, while turn history describes that
          // date.
          approvalRounds: {
            where: { decidedAt: { not: null, lt: until } },
            orderBy: { roundNo: "desc" },
            take: 1,
            select: { decision: true, decidedAt: true },
          },
          cancellation: { select: { createdAt: true } },
        },
      }),
      db.approvalRound.findMany({
        where: {
          decidedById: { in: userIds },
          decidedAt: { not: null, gte: instantStart, lt: until },
          activity: ctx.scope,
        },
        select: {
          activityId: true,
          decidedById: true,
          submittedAt: true,
          decidedAt: true,
        },
      }),
      db.followUpItem.findMany({
        where: {
          openedById: { in: userIds },
          openedAt: { lt: until },
          OR: [{ closedAt: null }, { closedAt: { gte: instantStart } }],
          activity: ctx.scope,
        },
        select: {
          activityId: true,
          openedById: true,
          openedAt: true,
          events: {
            where: { createdAt: { lt: until } },
            orderBy: { createdAt: "asc" },
            select: { kind: true, createdAt: true },
          },
        },
      }),
      // A person can be **either side** of a conversation (§9.2): the asker or
      // activity author. The batch query fetches both; attribution happens in
      // memory.
      db.conversation.findMany({
        where: {
          AND: [
            { activity: ctx.scope },
            {
              OR: [
                { askerId: { in: userIds } },
                { activity: { authorId: { in: userIds } } },
              ],
            },
            { openedAt: { lt: until } },
            { OR: [{ closedAt: null }, { closedAt: { gte: instantStart } }] },
          ],
        },
        select: {
          activityId: true,
          askerId: true,
          openedAt: true,
          closedAt: true,
          activity: { select: { authorId: true } },
          messages: {
            where: { createdAt: { lt: until } },
            orderBy: { createdAt: "asc" },
            select: { authorId: true, createdAt: true },
          },
        },
      }),
      db.activityAppreciation.findMany({
        where: {
          createdAt: { gte: from, lt: until },
          activity: {
            AND: [
              ctx.scope,
              { authorId: { in: userIds } },
              { activityDate: { gte: from, lte: to } },
            ],
          },
        },
        select: {
          activityId: true,
          createdAt: true,
          activity: { select: { authorId: true } },
        },
      }),
    ]);

  // Load the company calendar **once**, from the oldest relevant instant to
  // period end.
  const anchors: Date[] = [
    from,
    ...decisions.map((decision) => decision.submittedAt),
    ...followUpItems.map((item) => item.openedAt),
    ...conversations.map((conversation) =>
      conversation.messages[0]?.createdAt ?? conversation.openedAt,
    ),
  ];
  const oldestInstant = anchors.reduce(
    (min, instant) => (instant < min ? instant : min),
    from,
  );
  const companyCalendar =
    overrides?.companyCalendar ?? (await loadWorkCalendar(db, oldestInstant, to));

  const absenceIndex = groupBy(absences, (absence) => absence.userId);
  const recordIndex = groupBy(records, (record) => record.authorId);
  const decisionIndex = groupBy(
    decisions,
    (decision) => decision.decidedById ?? "",
  );
  const followUpIndex = groupBy(followUpItems, (item) => item.openedById);
  const appreciationIndex = groupBy(
    appreciations,
    (appreciation) => appreciation.activity.authorId,
  );

  // Load workdays once per unit: people in the same unit share a calendar and
  // the window is resolved from the in-memory index.
  const unitDays = new Map<string, string[]>();
  const getWorkDays = (orgUnitId: string): string[] => {
    const existing = unitDays.get(orgUnitId);
    if (existing) return existing;

    const days = expectedWorkDaysFrom(
      ctx.calendarIndex,
      orgUnitId,
      from,
      to,
      companyCalendar.holidays,
    );
    unitDays.set(orgUnitId, days);
    return days;
  };

  for (const person of people) {
    const orgUnitId = overrides?.orgUnitByUser?.get(person.id) ?? person.orgUnitId;
    result.set(
      person.id,
      calculateScoreInput({
        userId: person.id,
        instantStart,
        until,
        measurementInstant,
        workDays: getWorkDays(orgUnitId),
        absences: absenceIndex.get(person.id) ?? [],
        records: recordIndex.get(person.id) ?? [],
        decisions: decisionIndex.get(person.id) ?? [],
        followUpItems: followUpIndex.get(person.id) ?? [],
        // Keep only conversations where this person is the asker or author.
        conversations: conversations.filter(
          (conversation) =>
            conversation.askerId === person.id ||
            conversation.activity.authorId === person.id,
        ),
        appreciations: appreciationIndex.get(person.id) ?? [],
        calendarSetting: ctx.calendarSetting,
        companyCalendar,
        approvalThreshold: ctx.approvalThreshold,
        answerThreshold: ctx.answerThreshold,
        followUpThreshold: ctx.followUpThreshold,
        appreciationPointsPer: ctx.appreciationPointsPer,
      }),
    );
  }

  return result;
}
