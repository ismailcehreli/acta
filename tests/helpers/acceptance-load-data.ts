
import { PrismaClient } from "@prisma/client";

import { assertTestDatabaseUrl } from "./assert-test-database";
import { hashPassword } from "@/server/auth/password";
import { saveDraft } from "@/server/activities/drafts";
import { createActivity } from "@/server/activities/write";
import { markNoActivityPeriod } from "@/server/absence/service";
import { openFollowUp, closeFollowUp } from "@/server/follow-ups/service";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";


export const TARGET_ACTIVE_PEOPLE = 40;
const MONTH_COUNT = 12;


export function missingLoadPeople(currentActivePeople: number): number {
  if (
    !Number.isInteger(currentActivePeople) ||
    currentActivePeople < 0
  ) {
    throw new Error(`Invalid active-people count: ${currentActivePeople}`);
  }

  if (currentActivePeople > TARGET_ACTIVE_PEOPLE) {
    throw new Error(
      `Current active-people count (${currentActivePeople}) exceeds the target ` +
        `${TARGET_ACTIVE_PEOPLE}.`,
    );
  }

  return TARGET_ACTIVE_PEOPLE - currentActivePeople;
}

/**
 * Number of **pending** business days in the approval queue.
 *
 * Leaving the entire history pending would be unrealistic: decisions in an
 * approval unit are made within a few days, and no company has a twelve-month
 * queue. The benchmark measures how a realistic queue opens.
 */
const PENDING_BUSINESS_DAYS = 15;

/** Number of follow-up items; half are closed. */
const FOLLOW_UP_COUNT = 240;
/** Measured person's draft list; maximum `MAX_DRAFTS_PER_USER` is 50. */
const DRAFT_COUNT = 40;
/** Number of periods for the team leave screen. */
const LEAVE_PERIOD_COUNT = 60;
/** Number of notifications for the bell and home screen. */
const NOTIFICATION_COUNT = 300;
/** Additional audit rows for the audit screen. */
const AUDIT_RECORD_COUNT = 4000;

export interface LoadSummary {
  /** Total active people in the database, including global setup accounts. */
  personCount: number;
  activityCount: number;
  /** Pending approval records (the measured `/approvals` screen reads this). */
  pendingApproval: number;
  /** Decided approval rounds; the approval-duration card reads this. */
  decidedApprovalRounds: number;
  followUpItem: number;
  draft: number;
  leavePeriod: number;
  notification: number;
  auditRecord: number;
  scorePeriod: number;
  durationSeconds: number;
}

function isWeekday(day: Date): boolean {
  const g = day.getUTCDay();
  return g !== 0 && g !== 6;
}

function dayLabel(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/**
 * Activity row for a decided approval history entry.
 *
 * Bulk history does not go through the service: calling `createActivity` plus
 * `approveActivity` for every business day over twelve months would mean
 * thousands of operations and make load generation take minutes. Instead, a
 * dedicated test proves that the row is written **in the same shape as the
 * service output**: `tests/acceptance/load-data-format.test.ts` calls the real
 * services and compares every field with this row. Without that proof, the
 * benchmark would measure an impossible production state (P3-R2-1).
 */
export function approvedHistoryRow(input: {
  authorId: string;
  authorOrgUnitId: string;
  approverId: string;
  activityDate: Date;
  submittedAt: Date;
  decidedAt: Date;
}) {
  return {
    authorId: input.authorId,
    authorOrgUnitId: input.authorOrgUnitId,
    activityDate: input.activityDate,
    title: `Approved work record ${dayLabel(input.activityDate)}`,
    description:
      "A record written in an approval unit and approved by its manager. " +
      "Generated load data for the acceptance benchmark.",
    approvalStatus: "APPROVED" as const,
    approverId: input.approverId,
    // The submission timestamp is **cleared** when a decision is made; the
    // approval duration is read from the immutable `ApprovalRound` row (P3-R2-1).
    approvalSubmittedAt: null,
    approvalDecidedAt: input.decidedAt,
    createdAt: input.submittedAt,
    updatedAt: input.decidedAt,
  };
}

/** Closed approval round for the same history entry. */
export function approvedHistoryType(input: {
  activityId: string;
  decidedById: string;
  submittedAt: Date;
  decidedAt: Date;
}) {
  return {
    activityId: input.activityId,
    roundNo: 1,
    submittedAt: input.submittedAt,
    decidedAt: input.decidedAt,
    decidedById: input.decidedById,
    decision: "APPROVED" as const,
  };
}

export async function generateLoadData(): Promise<LoadSummary> {
  const start = Date.now();

  // Validate the target on every call: writing tens of thousands of fake rows
  // to the application database would irreversibly pollute real data.
  const targetUrl = process.env.E2E_DATABASE_URL ?? "";
  assertTestDatabaseUrl(targetUrl, {
    variableName: "E2E_DATABASE_URL",
    applicationUrl: process.env.DATABASE_URL,
  });

  const prisma = new PrismaClient({ datasources: { db: { url: targetUrl } } });

  try {
    return await generateLoadDataForDatabase(prisma, start);
  } finally {
    await prisma.$disconnect();
  }
}

async function generateLoadDataForDatabase(
  prisma: PrismaClient,
  start: number,
): Promise<LoadSummary> {
  const rootUnit = await prisma.orgUnit.findFirst({ where: { parentId: null } });
  if (!rootUnit) throw new Error("No root unit found; run the E2E setup first.");

  const units = await prisma.orgUnit.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  // The approval unit and its manager produce the pending approval queue.
  const approvalUnit = units.find((unit) => unit.requiresApproval);
  if (!approvalUnit) {
    throw new Error(
      "No approval unit found; the `/approvals` benchmark would measure an empty screen. " +
        "E2E setup makes the Dye Shop permanently require approval.",
    );
  }

  const approver = await prisma.user.findFirst({
    where: { orgUnitId: approvalUnit.id, isUnitManager: true, isActive: true },
    select: { id: true },
  });
  if (!approver) {
    throw new Error(`${approvalUnit.name} has no manager; an approver cannot be resolved.`);
  }

  // Measured person: the root-level board chair. Their company-wide scope
  // produces the largest result sets; personal surfaces such as drafts and
  // leave records are also created for this person.
  const measuredPerson = await prisma.user.findFirst({
    where: { orgUnitId: rootUnit.id, isUnitManager: true, isActive: true },
    select: { id: true, orgUnitId: true },
  });
  if (!measuredPerson) throw new Error("No root manager found; the benchmark scope cannot be created.");

  // Scoring is **enabled explicitly**. When disabled, `/scores` performs no
  // calculation and the benchmark would measure an empty screen. The setting
  // goes through the same service as the administration panel; writing a row
  // directly would bypass weight validation and the audit trail.
  const setting = await saveSettings(
    prisma,
    { [SETTING_KEYS.scoringEnabled]: "true" },
    measuredPerson.id,
  );
  if (!setting.ok) throw new Error(`Could not enable scoring: ${setting.message}`);

  const password = await hashPassword("acceptance-benchmark-password-1234");

  // **People have existed since the beginning of the history.** Period close
  // asks whether a person existed during the period (audit 2026-08-25,
  // P8-R2-3); it does not create historical scorecards for someone hired today.
  // Since the generated company has twelve months of history, these people are
  // also hired at that point in time.
  const now = new Date();
  const hireDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTH_COUNT - 1, 1),
  );

  // ---- People -------------------------------------------------------------
  const currentActivePeople = await prisma.user.count({
    where: { isActive: true },
  });
  const missingPeopleCount = missingLoadPeople(currentActivePeople);
  const generatedPeople: { id: string; orgUnitId: string; requiresApproval: boolean }[] = [];
  for (let i = 0; i < missingPeopleCount; i += 1) {
    const unit = units[i % units.length];
    if (!unit) continue;

    const user = await prisma.user.upsert({
      where: { email: `load-${i}@acceptance.test` },
      update: {},
      create: {
        fullName: `Load User ${i + 1}`,
        title: i % 5 === 0 ? "Specialist" : "Operator",
        email: `load-${i}@acceptance.test`,
        orgUnitId: unit.id,
        createdAt: hireDate,
      },
    });
    await prisma.userCredential.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, passwordHash: password },
    });

    generatedPeople.push({
      id: user.id,
      orgUnitId: unit.id,
      requiresApproval: unit.requiresApproval,
    });
  }

  // Setup accounts also count as existing from the start of the history so the
  // measured person's `/scores` screen is not empty.
  await prisma.user.updateMany({
    where: { createdAt: { gt: hireDate } },
    data: { createdAt: hireDate },
  });

  const totalActivePeople = await prisma.user.count({
    where: { isActive: true },
  });
  if (totalActivePeople !== TARGET_ACTIVE_PEOPLE) {
    throw new Error(
      "Acceptance load could not create the expected company size: " +
        `expected ${TARGET_ACTIVE_PEOPLE}, got ${totalActivePeople}.`,
    );
  }

  // The measured person also writes records. `/activities` lists only that
  // person's records; without any, the benchmark would measure an empty list.
  const writers = [
    ...generatedPeople,
    { id: measuredPerson.id, orgUnitId: measuredPerson.orgUnitId, requiresApproval: rootUnit.requiresApproval },
  ];

  // ---- Business days ------------------------------------------------------
  const today = new Date();
  const initialDay = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - MONTH_COUNT, 1),
  );

  const businessDays: Date[] = [];
  const cursor = new Date(initialDay);
  while (cursor <= today) {
    if (isWeekday(cursor)) businessDays.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // The latest days remain in the approval queue; earlier days form decided history.
  const pendingBoundary = Math.max(0, businessDays.length - PENDING_BUSINESS_DAYS);
  const historyDays = businessDays.slice(0, pendingBoundary);
  const pendingDays = businessDays.slice(pendingBoundary);

  // ---- Bulk history -------------------------------------------------------
  const directRows: ReturnType<typeof directActivityRow>[] = [];
  const approvedRows: ReturnType<typeof approvedHistoryRow>[] = [];

  for (const day of historyDays) {
    for (const person of writers) {
      if (person.requiresApproval) {
        const submittedAt = new Date(day.getTime() + 9 * 3600_000);
        approvedRows.push(
          approvedHistoryRow({
            authorId: person.id,
            authorOrgUnitId: person.orgUnitId,
            approverId: approver.id,
            activityDate: day,
            submittedAt,
            // Decide the next day so the approval-duration card has a measurable value.
            decidedAt: new Date(submittedAt.getTime() + 26 * 3600_000),
          }),
        );
      } else {
        directRows.push(directActivityRow(person, day));
      }
    }
  }

  // Split bulk writes: one `createMany` call would hit the query-parameter
  // limit with tens of thousands of rows.
  const BATCH_SIZE = 2000;
  for (let i = 0; i < directRows.length; i += BATCH_SIZE) {
    await prisma.activity.createMany({ data: directRows.slice(i, i + BATCH_SIZE) });
  }
  for (let i = 0; i < approvedRows.length; i += BATCH_SIZE) {
    await prisma.activity.createMany({ data: approvedRows.slice(i, i + BATCH_SIZE) });
  }

  // **Related rows** for every bulk-written record. In production these are
  // created with the record; omitting them would create an impossible database
  // state and make the benchmark measure a different world:
  //
  //   · target department — the record's subject (§5.3),
  //   · first revision — every save creates an immutable revision (§5.5),
  //   · closed approval round and frozen approver list — the source of approval
  //     duration and visibility.
  //
  // At this point the database's only activity set is the bulk-written history:
  // setup creates no activities, and service-written records come later.
  const bulkRecords = await prisma.activity.findMany({
    select: {
      id: true,
      authorId: true,
      authorOrgUnitId: true,
      title: true,
      description: true,
      createdAt: true,
      approverId: true,
      approvalDecidedAt: true,
    },
  });

  for (let i = 0; i < bulkRecords.length; i += BATCH_SIZE) {
    const batch = bulkRecords.slice(i, i + BATCH_SIZE);

    await prisma.activityTargetDept.createMany({
      data: batch.map((record) => ({
        activityId: record.id,
        orgUnitId: record.authorOrgUnitId,
      })),
    });

    await prisma.activityRevision.createMany({
      data: batch.map((record) => ({
        activityId: record.id,
        revisionNo: 1,
        title: record.title,
        description: record.description,
        targetOrgUnitIds: [record.authorOrgUnitId],
        changedById: record.authorId,
        createdAt: record.createdAt,
      })),
    });

    const approvedRecords = batch.filter((record) => record.approverId !== null);
    if (approvedRecords.length === 0) continue;

    await prisma.approvalRound.createMany({
      data: approvedRecords.map((record) =>
        approvedHistoryType({
          activityId: record.id,
          decidedById: record.approverId ?? approver.id,
          submittedAt: record.createdAt,
          decidedAt: record.approvalDecidedAt ?? record.createdAt,
        }),
      ),
    });
    await prisma.activityApprover.createMany({
      data: approvedRecords.map((record) => ({
        activityId: record.id,
        userId: record.approverId ?? approver.id,
      })),
    });
  }

  // ---- Pending approval queue: through the real service ------------------
  //
  // The measured `/approvals` screen reads these rows. A manually constructed
  // pending row could be impossible in production; the service fills the queue
  // so status, approval round, eligible approvers, and notifications all use
  // the same write path.
  const targetUnitIds = [approvalUnit.id];
  let pendingApproval = 0;
  for (const day of pendingDays) {
    for (const person of writers) {
      if (!person.requiresApproval) {
        // A record in a unit without approval is born approved. It still goes
        // through the real write path so recent data matches production.
        const directActivity = await createActivity(
          prisma,
          { id: person.id, orgUnitId: person.orgUnitId, requiresApproval: false },
          {
            activityDate: dayLabel(day),
            title: `Daily work record ${dayLabel(day)}`,
            description:
              "Work completed during the shift, issues encountered, and their " +
              "solutions. Generated load data for the acceptance benchmark.",
            targetDepartmentIds: [person.orgUnitId],
          },
          new Date(day.getTime() + 9 * 3600_000),
        );
        if (!directActivity.ok) {
          throw new Error(`Could not write daily record (${dayLabel(day)}): ${directActivity.error}`);
        }
        continue;
      }

      const result = await createActivity(
        prisma,
        { id: person.id, orgUnitId: person.orgUnitId, requiresApproval: true },
        {
          activityDate: dayLabel(day),
          title: `Pending approval work record ${dayLabel(day)}`,
          description:
            "A record written in an approval unit waiting for its manager's decision. " +
            "Generated load data for the acceptance benchmark.",
          targetDepartmentIds: targetUnitIds,
        },
        new Date(day.getTime() + 9 * 3600_000),
      );

      if (!result.ok) {
        throw new Error(
          `Could not write pending record (${dayLabel(day)}): ${result.error}`,
        );
      }
      pendingApproval += 1;
    }
  }

  // ---- Follow-up items: through the real service -------------------------
  const followUpCandidates = await prisma.activity.findMany({
    where: { approvalStatus: "APPROVED" },
    select: { id: true, authorId: true },
    orderBy: { activityDate: "desc" },
    take: FOLLOW_UP_COUNT,
  });

  let followUpItem = 0;
  for (const [order, record] of followUpCandidates.entries()) {
    // The opener is the record author: they can always see their own record,
    // and the visibility check still uses the real path.
    const opener = { id: record.authorId, isSystemAdmin: false };
    const opened = await openFollowUp(prisma, opener, {
      activityId: record.id,
      nextStep: "Next step: the topic is being tracked.",
    });
    if (!opened.ok) continue;
    followUpItem += 1;

    // Half are closed: the screen renders both states and the filter count is
    // meaningful only when both are present.
    if (order % 2 === 1) {
      await closeFollowUp(
        prisma,
        opener,
        opened.item.id,
        "Topic completed; generated load data for the acceptance benchmark.",
      );
    }
  }

  // ---- Drafts: through the real service ----------------------------------
  let draft = 0;
  for (let i = 0; i < DRAFT_COUNT; i += 1) {
    const result = await saveDraft(prisma, measuredPerson.id, {
      activityDate: dayLabel(businessDays[businessDays.length - 1] ?? today),
      title: `Incomplete record ${i + 1}`,
      description: "Generated load data for the draft-list benchmark.",
      targetDepartmentIds: [],
      openFollowUp: false,
      savedManually: i % 3 === 0,
    });
    if (result.ok) draft += 1;
  }

  // ---- Leave periods: through the real service ---------------------------
  //
  // The measured person manages the root, so all generated people are in their
  // scope; the service really checks the management relationship.
  let leavePeriod = 0;
  for (let i = 0; i < LEAVE_PERIOD_COUNT; i += 1) {
    const person = generatedPeople[i % generatedPeople.length];
    if (!person) continue;

    // The overlap constraint (`EXCLUDE`) rejects overlapping periods for the
    // same person; each iteration selects a separate week.
    const type = Math.floor(i / generatedPeople.length);
    const start = new Date(initialDay);
    start.setUTCDate(start.getUTCDate() + 30 + type * 21 + (i % 7));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 2);

    const result = await markNoActivityPeriod(
      prisma,
      measuredPerson.id,
      {
        userId: person.id,
        startDate: dayLabel(start),
        endDate: dayLabel(end),
        note: "Annual leave — generated load data for the acceptance benchmark.",
      },
      today,
    );
    if (result.ok) leavePeriod += 1;
  }

  // ---- Notifications ------------------------------------------------------
  //
  // The shell reads the unread count on every page; measuring an empty bell
  // would hide the cost of that query.
  const notificationRecords = await prisma.activity.findMany({
    select: { id: true },
    orderBy: { activityDate: "desc" },
    take: NOTIFICATION_COUNT,
  });
  await prisma.notificationQueue.createMany({
    data: notificationRecords.map((record, i) => ({
      userId: measuredPerson.id,
      eventType: "activity_created",
      activityId: record.id,
      channel: "EMAIL" as const,
      payload: { title: `Load notification ${i + 1}` },
      idempotencyKey: `load-notification:${record.id}:${measuredPerson.id}`,
      status: "SENT" as const,
      sentAt: today,
    })),
    skipDuplicates: true,
  });
  const notification = await prisma.notificationQueue.count({
    where: { userId: measuredPerson.id },
  });

  // ---- Audit trail --------------------------------------------------------
  //
  // Services already create audit rows as they run; add historical rows so the
  // audit screen is measured at a realistic volume.
  const auditCandidates = await prisma.activity.findMany({
    select: { id: true, authorId: true, createdAt: true },
    orderBy: { activityDate: "desc" },
    take: AUDIT_RECORD_COUNT,
  });
  for (let i = 0; i < auditCandidates.length; i += BATCH_SIZE) {
    await prisma.auditLog.createMany({
      data: auditCandidates.slice(i, i + BATCH_SIZE).map((record) => ({
        userId: record.authorId,
        objectType: "activity",
        objectId: record.id,
        action: "activity_created",
        detail: { source: "acceptance-load-data" },
        createdAt: record.createdAt,
      })),
    });
  }
  const auditRecordCount = await prisma.auditLog.count();

  // ---- Score periods: through the real closing worker --------------------
  //
  // Writing `UserScorePeriod` rows manually would bypass the formula and make
  // the benchmark use fabricated values. The closing worker runs once per
  // month, so its rows use the same path as production.
  let scorePeriod = 0;
  for (let month = MONTH_COUNT; month >= 1; month -= 1) {
    // Use the **third** day of the month: closing does not freeze the period
    // before the late-entry window closes (audit 2026-08-25, P8-R2-2). Running
    // on the first would write no period.
    const closureAt = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - month + 1, 3, 3),
    );
    const result = await closeScorePeriod(prisma, closureAt);
    scorePeriod += result.written;
  }

  const activityCount = await prisma.activity.count();
  const decidedApprovalRounds = await prisma.approvalRound.count({
    where: { decidedAt: { not: null } },
  });

  return {
    personCount: totalActivePeople,
    activityCount,
    pendingApproval,
    decidedApprovalRounds,
    followUpItem,
    draft,
    leavePeriod,
    notification,
    auditRecord: auditRecordCount,
    scorePeriod,
    durationSeconds: Number(((Date.now() - start) / 1000).toFixed(1)),
  };
}

/** A record in a unit without approval is born approved (§4.3). */
function directActivityRow(
  person: { id: string; orgUnitId: string },
  day: Date,
) {
  return {
    authorId: person.id,
    // The reporting unit is frozen at the time of writing (§4.6).
    authorOrgUnitId: person.orgUnitId,
    activityDate: day,
    title: `Daily work record ${dayLabel(day)}`,
    description:
      "Work completed during the shift, issues encountered, and their " +
      "solutions. Generated load data for the acceptance benchmark.",
  };
}

// This file can also run as a script. It lives outside **`scripts/`** because
// the production image does not include `tests/`, and a file there importing
// `tests/helpers` would break type checking during `docker build` (Task 6.3).
if (process.argv[1]?.endsWith("acceptance-load-data.ts")) {
  generateLoadData()
    .then((summary) => console.log("Load data ready:", JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
