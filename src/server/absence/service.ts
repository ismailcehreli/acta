import type {
  NoActivityDecisionRoute,
  NoActivityPeriodStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { toDateValue } from "@/server/activities/date-rules";
import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit, type AuditDb } from "@/server/audit/log";
import { isExclusionViolation } from "@/server/db-errors";

import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";

import {
  absenceDecisionRoute,
  resolveAbsenceApproversForUser,
  visibleAbsenceUserIds,
} from "./approval-routing";
import { CURRENT_PERIOD } from "./period-filter";

export {
  listAbsenceDeputies,
  managedAbsenceEmployeeIds,
  visibleAbsenceUserIds,
} from "./approval-routing";







export type AbsenceDb = Pick<
  PrismaClient,
  | "noActivityPeriod"
  | "user"
  | "orgUnit"
  | "notificationQueue"
  | "systemSetting"
  | "$transaction"
  | "$executeRaw"
  | "$queryRaw"
> & AuditDb;

export interface AbsenceInput {
  userId: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
  note?: string;

  deputyId?: string;
}

export type AbsenceError =

  | "not_subordinate"

  | "deputy_is_self"

  | "absent_not_manager"

  | "deputy_not_manager"

  | "overlaps"
  | "invalid_range"

  | "reason_required"

  | "not_found"

  | "too_long_for_self"

  | "manager_not_found";

export type AbsenceResult =
  | { ok: true; id: string; status: NoActivityPeriodStatus }
  | { ok: false; error: AbsenceError; message: string };

const MESSAGES: Record<AbsenceError, string> = {
  not_subordinate: "You cannot enter a record for this person.",
  overlaps: "A record already exists for this person on these dates.",
  invalid_range: "The end date cannot be before the start date.",
  deputy_is_self: "A person cannot be their own deputy.",
  absent_not_manager:
    "A deputy can only be assigned to a unit manager. A non-manager has no approval queue to delegate.",
  deputy_not_manager:
    "The deputy must also be a unit manager because delegation grants the covered manager's visibility scope.",
  reason_required: "A cancellation reason is required.",
  not_found: "Record not found.",
  too_long_for_self:
    "You cannot enter a period this long for yourself; your manager can enter it.",
  manager_not_found:
    "No active manager was found to decide this request. Contact a system administrator.",
};

function fail(error: AbsenceError): AbsenceResult {
  return { ok: false, error, message: MESSAGES[error] };
}

export interface AbsenceView {
  id: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  note: string | null;
  deputyName: string | null;

  cancelledReason: string | null;
  /** Decision status of the request. */
  status: NoActivityPeriodStatus;

  decisionReason: string | null;
  decidedAt: Date | null;

  decidedByName: string | null;

  decisionRoute: NoActivityDecisionRoute | null;

  canDecide?: boolean;

  canCancel?: boolean;

  markedBySelf?: boolean;
}


export interface AbsenceFilters {
  userId?: string;

  status?: "active" | "pending" | "rejected" | "cancelled";
}


export async function departmentEmployeeIds(
  db: Pick<PrismaClient, "user">,
  managerId: string,
  options: { activeOnly?: boolean } = {},
): Promise<string[]> {
  const manager = await db.user.findUnique({
    where: { id: managerId },
    select: { orgUnitId: true, isUnitManager: true },
  });

  if (!manager?.isUnitManager) return [];

  const people = await db.user.findMany({
    where: {
      orgUnitId: manager.orgUnitId,
      isUnitManager: false,
      ...(options.activeOnly ? { isActive: true } : {}),
    },
    select: { id: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });

  return people.map((person) => person.id);
}


export async function subordinateManagerIds(
  db: Pick<PrismaClient, "user" | "$queryRaw">,
  managerId: string,
): Promise<string[]> {
  const manager = await db.user.findUnique({
    where: { id: managerId },
    select: { orgUnitId: true, isUnitManager: true, isActive: true },
  });
  if (!manager?.isUnitManager || !manager.isActive) return [];

  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree(id) AS (
      SELECT "id" FROM "OrgUnit" WHERE "id" = ${manager.orgUnitId}
      UNION ALL
      SELECT child."id"
      FROM "OrgUnit" child
      JOIN subtree ON child."parentId" = subtree.id
    )
    SELECT u."id"
    FROM "User" u
    JOIN subtree ON u."orgUnitId" = subtree.id
    WHERE u."isUnitManager" = true
      AND u."isActive" = true
  `;

  return rows.map((row) => row.id);
}

async function scopedDepartmentEmployees(
  db: AbsenceDb,
  managerId: string,
  supplied?: string[],
  now: Date = new Date(),
): Promise<string[]> {
  const allowed = await visibleAbsenceUserIds(db, managerId, now);
  if (!supplied) return allowed;

  // A caller may pass a precomputed list. It is never an authorization source;
  // it can only narrow the absence-management scope.
  const suppliedSet = new Set(supplied);
  return allowed.filter((id) => suppliedSet.has(id));
}

/**
 * The team condition and filters are combined with **`AND`**.
 *
 * Object spreading (`{ userId: { in: team }, ...filters }`) caused a leak:
 * when Prisma received the same field twice, **the last value won**, so the
 * person filter replaced the team condition. A manager could put someone
 * outside the team into the URL and view that person's leave records.
 *
 * The `AND` list makes this structurally impossible: conditions can only
 * narrow the result (§8.4). The visibility test caught the original defect.
 */
function absenceWhere(
  team: string[],
  filters: AbsenceFilters,
): Prisma.NoActivityPeriodWhereInput {
  const conditions: Prisma.NoActivityPeriodWhereInput[] = [
    { userId: { in: team } },
  ];

  if (filters.userId) conditions.push({ userId: filters.userId });
  if (filters.status === "active") {
    conditions.push({ cancelledAt: null, status: "APPROVED" });
  }
  if (filters.status === "pending") {
    conditions.push({ cancelledAt: null, status: "PENDING" });
  }
  if (filters.status === "rejected") conditions.push({ status: "REJECTED" });
  if (filters.status === "cancelled") {
    conditions.push({ cancelledAt: { not: null } });
  }

  return { AND: conditions };
}

/** Absence periods entered for a manager's team. */
export async function listTeamAbsences(
  db: AbsenceDb,
  managerId: string,
  subordinates?: string[],
  filters: AbsenceFilters = {},
  options: { limit?: number; skip?: number; now?: Date } = {},
): Promise<AbsenceView[]> {
  const now = options.now ?? new Date();
  const team = await scopedDepartmentEmployees(
    db,
    managerId,
    subordinates,
    now,
  );
  if (team.length === 0) return [];

  // Cancelled records remain visible with a strike-through so users can
  // distinguish history from an accidentally missing record (§16.5).
  const [actor, rows] = await Promise.all([
    db.user.findUnique({
      where: { id: managerId },
      select: { orgUnitId: true, isUnitManager: true, isActive: true },
    }),
    db.noActivityPeriod.findMany({
      where: absenceWhere(team, filters),
      ...(options.limit === undefined ? {} : { take: options.limit }),
      ...(options.skip === undefined ? {} : { skip: options.skip }),
      orderBy: [{ cancelledAt: { sort: "asc", nulls: "first" } }, { startDate: "desc" }],
      select: {
        id: true,
        userId: true,
        startDate: true,
        endDate: true,
        note: true,
        cancellationReason: true,
        status: true,
        decisionReason: true,
        decidedAt: true,
        decisionRoute: true,
        decidedBy: { select: { fullName: true } },
        user: {
          select: { fullName: true, orgUnitId: true, isUnitManager: true },
        },
        deputy: { select: { fullName: true } },
      },
    }),
  ]);

  const decisionRoutes = await Promise.all(
    rows.map((row) =>
      row.status === "PENDING"
        ? absenceDecisionRoute(db, managerId, row.userId, now)
        : Promise.resolve(null),
    ),
  );

  return rows.map((row, index) => ({
    id: row.id,
    userId: row.userId,
    userName: row.user.fullName,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    note: row.note,
    deputyName: row.deputy?.fullName ?? null,
    cancelledReason: row.cancellationReason,
    status: row.status,
    decisionReason: row.decisionReason,
    decidedAt: row.decidedAt,
    decidedByName: row.decidedBy?.fullName ?? null,
    decisionRoute: row.decisionRoute,
    canDecide: decisionRoutes[index] !== null,
    canCancel:
      actor?.isUnitManager === true &&
      actor.isActive &&
      row.user.isUnitManager === false &&
      row.user.orgUnitId === actor.orgUnitId,
  }));
}

/** Count the filtered result; pagination derives its page count from this. */
export async function countTeamAbsences(
  db: AbsenceDb,
  managerId: string,
  subordinates?: string[],
  filters: AbsenceFilters = {},
  now: Date = new Date(),
): Promise<number> {
  const team = await scopedDepartmentEmployees(db, managerId, subordinates, now);
  if (team.length === 0) return 0;

  return db.noActivityPeriod.count({ where: absenceWhere(team, filters) });
}

/**
 * A person's own "no activity expected" period (Task 11.8).
 *
 * Anyone can enter their own period. A non-manager's request goes to active
 * managers in their department. If those managers are away, it is routed to
 * an active deputy, or to the first active manager above them; a manager's own
 * entry is approved directly.
 *
 * Two differences apply:
 *
 *   · Duration limit. A person cannot enter a period longer than the setting;
 *     their manager can enter a longer one. The limit applies only to self-entry
 *     because a manager's entry is already an authorized decision.
 *   · An employee cannot choose a deputy for themselves. Delegation is a
 *     manager-level decision; a unit manager may choose an active manager.
 *
 * A pending record is not effective; once approved, it is excluded from
 * reminders and participation calculations.
 */
export async function markOwnNoActivityPeriod(
  db: AbsenceDb & Pick<PrismaClient, "notificationQueue">,
  userId: string,
  input: {
    startDate: string;
    endDate: string;
    note?: string | null;
    deputyId?: string | null;
  },
  now: Date,
): Promise<AbsenceResult> {
  if (input.endDate < input.startDate) return fail("invalid_range");

  const person = await db.user.findUnique({
    where: { id: userId },
    select: { fullName: true, isUnitManager: true, isActive: true },
  });
  if (!person || !person.isActive) return fail("not_found");

  const deputyId = input.deputyId?.trim() || undefined;
  if (deputyId) {
    if (!person.isUnitManager) return fail("absent_not_manager");
    if (deputyId === userId) return fail("deputy_is_self");

    const deputy = await db.user.findFirst({
      where: { id: deputyId, isActive: true, isUnitManager: true },
      select: { id: true },
    });
    if (!deputy) return fail("deputy_not_manager");
  }

  const maximumDays = await readNumericSetting(db, SETTING_KEYS.selfAbsenceMaxDays);
  const durationDays =
    Math.round(
      (toDateValue(input.endDate).getTime() - toDateValue(input.startDate).getTime()) /
        86_400_000,
    ) + 1;
  if (durationDays > maximumDays) return fail("too_long_for_self");

  const status: NoActivityPeriodStatus = person.isUnitManager
    ? "APPROVED"
    : "PENDING";
  let approvers: { id: string }[] = [];

  if (!person.isUnitManager) {
    approvers = await resolveAbsenceApproversForUser(db, userId, now);
    if (approvers.length === 0) return fail("manager_not_found");
  }

  const result = await save(
    db,
    {
      userId,
      startDate: input.startDate,
      endDate: input.endDate,
      note: input.note ?? undefined,
      ...(deputyId ? { deputyId } : {}),
    },
    userId,
    now,
    person.isUnitManager
      ? {
          status,
          decidedAt: now,
          decidedById: userId,
          decisionRoute: "DIRECT_ENTRY",
        }
      : { status },
  );
  if (!result.ok) return result;

  if (approvers.length > 0) {
    for (const approver of approvers) {
      await enqueueNotification(db, {
        userId: approver.id,
        eventType: NOTIFICATION_EVENTS.absenceRequestSubmitted,
        payload: {
          personName: person.fullName,
          range: `${input.startDate} – ${input.endDate}`,
        },
        idempotencyKey: `absence_request:${result.id}:${approver.id}`,
        now,
      });
    }
  }

  return result;
}

/** A person's own periods; cancelled records remain visible. */
export async function listOwnAbsences(
  db: AbsenceDb,
  userId: string,
  options: { limit?: number; skip?: number } = {},
): Promise<AbsenceView[]> {
  const rows = await db.noActivityPeriod.findMany({
    where: { userId },
    ...(options.limit === undefined ? {} : { take: options.limit }),
    ...(options.skip === undefined ? {} : { skip: options.skip }),
    orderBy: [{ cancelledAt: { sort: "asc", nulls: "first" } }, { startDate: "desc" }],
    select: {
      id: true,
      userId: true,
      startDate: true,
      endDate: true,
      note: true,
      cancellationReason: true,
      status: true,
      decisionReason: true,
      decidedAt: true,
      decisionRoute: true,
      markedById: true,
      user: { select: { fullName: true } },
      decidedBy: { select: { fullName: true } },
      deputy: { select: { fullName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.user.fullName,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    note: row.note,
    deputyName: row.deputy?.fullName ?? null,
    cancelledReason: row.cancellationReason,
    status: row.status,
    decisionReason: row.decisionReason,
    decidedAt: row.decidedAt,
    decidedByName: row.decidedBy?.fullName ?? null,
    decisionRoute: row.decisionRoute,
    markedBySelf: row.markedById === row.userId,
  }));
}

/** Count a person's own periods for pagination. */
export async function countOwnAbsences(
  db: AbsenceDb,
  userId: string,
): Promise<number> {
  return db.noActivityPeriod.count({ where: { userId } });
}

export async function markNoActivityPeriod(
  db: AbsenceDb,
  managerId: string,
  input: AbsenceInput,
  now: Date,
): Promise<AbsenceResult> {
  if (input.endDate < input.startDate) return fail("invalid_range");

  const manager = await db.user.findUnique({
    where: { id: managerId },
    select: { orgUnitId: true, isUnitManager: true, isActive: true },
  });
  if (!manager?.isUnitManager || !manager.isActive) return fail("not_subordinate");

  // A manager can enter their own record through this shared service; it does
  // not wait for approval. Employee selections are limited to active,
  // non-manager people in the same department.
  const ownRecord = input.userId === managerId;
  const team = ownRecord
    ? []
    : await departmentEmployeeIds(db, managerId, { activeOnly: true });
  const deputyManagers = !ownRecord
    ? await subordinateManagerIds(db, managerId)
    : [];
  const managerDelegation =
    !ownRecord && deputyManagers.includes(input.userId);

  // Employee scope is deliberately limited to the direct department here.
  // The only exception records an active manager's absence and deputy for the
  // existing delegation flow; employees cannot use that path.
  if (!ownRecord && !team.includes(input.userId) && !managerDelegation) {
    return fail("not_subordinate");
  }

  if (input.deputyId) {
    // **Delegation is manager-only** (product decision, 2026-08-21). There
    // are two reasons:
    //
    //   · The delegated work is a manager's approval queue. For an employee,
    //     the delegated work is usually open questions, which §9.3 already
    //     handles.
    //   · A deputy gains the covered person's visibility scope. Giving a
    //     department scope to a non-manager would create authority outside
    //     the organization tree.
    if (input.deputyId === input.userId) return fail("deputy_is_self");

    if (!ownRecord && !managerDelegation) return fail("absent_not_manager");
    if (!deputyManagers.includes(input.deputyId)) {
      const deputy = await db.user.findUnique({
        where: { id: input.deputyId },
        select: { isUnitManager: true, isActive: true },
      });
      if (!deputy?.isUnitManager || !deputy.isActive) {
        return fail("deputy_not_manager");
      }
      return fail("not_subordinate");
    }
  }

  return save(db, input, managerId, now, {
    status: "APPROVED",
    decidedAt: now,
    decidedById: managerId,
    decisionRoute: "DIRECT_ENTRY",
  });
}

/**
 * Shared write path for absence records (Task 11.8).
 *
 * Manager-entered and self-entered periods share the same rules, audit trail,
 * and overlap constraint. Separate write paths would let a rule fixed in one
 * path remain broken in the other.
 */
async function save(
  db: AbsenceDb,
  input: AbsenceInput,
  markedById: string,
  now: Date,
  decision: {
    status: NoActivityPeriodStatus;
    decidedAt?: Date;
    decidedById?: string;
    decisionReason?: string | null;
    decisionRoute?: NoActivityDecisionRoute | null;
  } = { status: "APPROVED" },
): Promise<AbsenceResult> {
  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.noActivityPeriod.create({
        data: {
          userId: input.userId,
          startDate: toDateValue(input.startDate),
          endDate: toDateValue(input.endDate),
          note: input.note?.trim() || null,
          deputyId: input.deputyId || null,
          markedById,
          createdAt: now,
          status: decision.status,
          decidedAt: decision.decidedAt ?? null,
          decidedById: decision.decidedById ?? null,
          decisionReason: decision.decisionReason ?? null,
          decisionRoute: decision.decisionRoute ?? null,
        },
      });

      // Assigning a deputy grants authority (§4.5), and authority changes are
      // audited (§15.2). Record both in the same transaction.
      await recordAudit(tx, {
        userId: markedById,
        objectType: AUDIT_OBJECTS.user,
        objectId: input.userId,
        action:
          decision.status === "PENDING"
            ? AUDIT_ACTIONS.absenceRequestSubmitted
            : AUDIT_ACTIONS.absenceMarked,
        detail: {
          periodId: row.id,
          startDate: input.startDate,
          endDate: input.endDate,
          deputyId: input.deputyId ?? null,
          status: decision.status,
        },
        now,
      });

      return row;
    });

    return { ok: true, id: created.id, status: created.status };
  } catch (error) {
    // Overlaps are prevented by the database constraint
    // (`NoActivityPeriod_no_overlap`) so the rule still holds if the app layer
    // is bypassed.
    //
    // Do not match the bare constraint name: bundled sources may contain that
    // text and turn an unrelated database error into an overlap error. The
    // helper checks both SQLSTATE and the quoted constraint name.
    if (isExclusionViolation(error, "NoActivityPeriod_no_overlap")) {
      return fail("overlaps");
    }
    throw error;
  }
}

/**
 * Cancel an absence record (audit finding 7, 2026-08-21).
 *
 * Do not delete it. A deputy's historical visibility derives from this row
 * (§4.5); deleting it would silently remove the covered period's records.
 * Database triggers also prevent physical deletion.
 *
 * Only the manager's own team is in scope. Treat another team's record as
 * missing so the response does not disclose that it exists.
 */
export async function cancelNoActivityPeriod(
  db: AbsenceDb,
  managerId: string,
  periodId: string,
  reason: string,
  now: Date = new Date(),
): Promise<AbsenceResult> {
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) return fail("reason_required");

  return db.$transaction(async (tx) => {
    // Lock row: if two managers cancel the same record simultaneously,
    // the second waits here and prevents duplicate audit logs.
    await tx.$executeRaw`SELECT "id" FROM "NoActivityPeriod" WHERE "id" = ${periodId} FOR UPDATE`;

    const [actor, record] = await Promise.all([
      tx.user.findUnique({
        where: { id: managerId },
        select: {
          fullName: true,
          orgUnitId: true,
          isUnitManager: true,
          isActive: true,
        },
      }),
      tx.noActivityPeriod.findUnique({
        where: { id: periodId },
        select: {
          id: true,
          userId: true,
          deputyId: true,
          status: true,
          user: { select: { orgUnitId: true, isUnitManager: true } },
        },
      }),
    ]);
    if (!record) return fail("not_found");

    const isSelf = record.userId === managerId;
    const isDepartmentEmployee =
      actor?.isUnitManager === true &&
      actor.isActive &&
      record.user.orgUnitId === actor.orgUnitId &&
      record.user.isUnitManager === false;
    const isManagerDeputy =
      record.deputyId !== null &&
      actor?.isUnitManager === true &&
      actor.isActive &&
      record.user.isUnitManager &&
      (await subordinateManagerIds(tx, managerId)).includes(record.userId);

    if (!isSelf && !isDepartmentEmployee && !isManagerDeputy) {
      return fail("not_found");
    }

    const validRecord = await tx.noActivityPeriod.findFirst({
      // A pending request can also be withdrawn by its owner.
      // Both PENDING and APPROVED states must be actionable here.
      where: {
        id: periodId,
        cancelledAt: null,
        status: { in: ["PENDING", "APPROVED"] },
      },
      select: { id: true, userId: true, deputyId: true, status: true },
    });
    if (!validRecord) return fail("not_found");

    await tx.noActivityPeriod.update({
      where: { id: validRecord.id },
      data: {
        cancelledAt: now,
        cancelledById: managerId,
        cancellationReason: trimmedReason,
      },
    });

    // Delegation is an authorization grant; grant and revocation are audited.
    // The reason text is excluded from the audit log to keep audit trails lean.
    await recordAudit(tx, {
      userId: managerId,
      objectType: AUDIT_OBJECTS.user,
      objectId: validRecord.userId,
      action:
        validRecord.status === "PENDING"
          ? AUDIT_ACTIONS.absenceRequestWithdrawn
          : AUDIT_ACTIONS.absenceCancelled,
      detail: {
        periodId: validRecord.id,
        hadDeputy: validRecord.deputyId !== null,
        status: validRecord.status,
      },
      now,
    });

    return {
      ok: true,
      id: validRecord.id,
      status: validRecord.status,
    } satisfies AbsenceResult;
  });
}

export type AbsenceDecision = "APPROVED" | "REJECTED";

/**
 * Decides on a pending employee absence request.
 *
 * The row is locked first, then status and department are re-verified.
 * Ensures that if two managers in the same department click simultaneously,
 * only the first decision is saved.
 */
export async function decideNoActivityPeriod(
  db: AbsenceDb,
  managerId: string,
  periodId: string,
  decision: AbsenceDecision,
  reason = "",
  now: Date = new Date(),
): Promise<AbsenceResult> {
  const trimmedReason = reason.trim();
  if (decision === "REJECTED" && trimmedReason.length === 0) {
    return fail("reason_required");
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT "id" FROM "NoActivityPeriod" WHERE "id" = ${periodId} FOR UPDATE`;

    const [actor, record] = await Promise.all([
      tx.user.findUnique({
        where: { id: managerId },
        select: {
          fullName: true,
          orgUnitId: true,
          isUnitManager: true,
          isActive: true,
        },
      }),
      tx.noActivityPeriod.findUnique({
        where: { id: periodId },
        select: {
          id: true,
          userId: true,
          startDate: true,
          endDate: true,
          status: true,
          cancelledAt: true,
          user: {
            select: { fullName: true, orgUnitId: true, isUnitManager: true },
          },
        },
      }),
    ]);

    if (
      !actor?.isUnitManager ||
      !actor.isActive ||
      !record ||
      record.status !== "PENDING" ||
      record.cancelledAt !== null ||
      record.user.isUnitManager
    ) {
      return fail("not_found");
    }

    // Direct manager, active deputy, and escalation routing all resolve through the same path.
    const route = await absenceDecisionRoute(tx, managerId, record.userId, now);
    if (!route) return fail("not_found");

    const newStatus: NoActivityPeriodStatus = decision;
    await tx.noActivityPeriod.update({
      where: { id: record.id },
      data: {
        status: newStatus,
        decidedAt: now,
        decidedById: managerId,
        decisionReason: decision === "REJECTED" ? trimmedReason : null,
        decisionRoute: route,
      },
    });

    await recordAudit(tx, {
      userId: managerId,
      objectType: AUDIT_OBJECTS.user,
      objectId: record.userId,
      action:
        decision === "APPROVED"
          ? AUDIT_ACTIONS.absenceRequestApproved
          : AUDIT_ACTIONS.absenceRequestRejected,
      detail: {
        periodId: record.id,
        status: newStatus,
        decisionRoute: route,
      },
      now,
    });

    await enqueueNotification(tx, {
      userId: record.userId,
      eventType:
        decision === "APPROVED"
          ? NOTIFICATION_EVENTS.absenceRequestApproved
          : NOTIFICATION_EVENTS.absenceRequestRejected,
      payload: {
        personName: record.user.fullName,
        range: `${record.startDate.toISOString().slice(0, 10)} – ${record.endDate
          .toISOString()
          .slice(0, 10)}`,
        approverName: actor.fullName,
        decisionRoute: route,
      },
      idempotencyKey: `absence_decision:${record.id}:${decision}`,
      now,
    });

    return { ok: true, id: record.id, status: newStatus } satisfies AbsenceResult;
  });
}

/** Check if user has "no activity expected" period on the given day. */
export async function isNoActivityDay(
  db: Pick<PrismaClient, "noActivityPeriod">,
  userId: string,
  day: string,
): Promise<boolean> {
  const date = toDateValue(day);
  const record = await db.noActivityPeriod.findFirst({
    where: { userId, ...CURRENT_PERIOD, startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true },
  });

  return record !== null;
}
