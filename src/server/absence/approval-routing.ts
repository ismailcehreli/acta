import type {
  NoActivityDecisionRoute,
  PrismaClient,
} from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";

import { CURRENT_PERIOD } from "./period-filter";

const MAX_LEVELS = 20;

type AbsenceRoutingDb = Pick<
  PrismaClient,
  "user" | "orgUnit" | "noActivityPeriod" | "$queryRaw"
>;

export interface AbsenceApprover {
  id: string;
  route: NoActivityDecisionRoute;
}

interface ManagerRow {
  id: string;
  orgUnitId: string;
}

export interface AbsenceDeputyOption {
  id: string;
  fullName: string;
}

function uniqueApprovers(approvers: AbsenceApprover[]): AbsenceApprover[] {
  const seen = new Set<string>();
  return approvers.filter((approver) => {
    if (seen.has(approver.id)) return false;
    seen.add(approver.id);
    return true;
  });
}

async function activeManagerIds(
  db: AbsenceRoutingDb,
  managerIds: string[],
  day: Date,
): Promise<Set<string>> {
  if (managerIds.length === 0) return new Set();

  const rows = await db.noActivityPeriod.findMany({
    where: {
      userId: { in: managerIds },
      ...CURRENT_PERIOD,
      startDate: { lte: day },
      endDate: { gte: day },
    },
    select: { userId: true },
  });

  return new Set(rows.map((row) => row.userId));
}

async function currentManagerAbsences(
  db: AbsenceRoutingDb,
  managerIds: string[],
  day: Date,
): Promise<{ userId: string; deputyId: string | null }[]> {
  if (managerIds.length === 0) return [];

  return db.noActivityPeriod.findMany({
    where: {
      userId: { in: managerIds },
      ...CURRENT_PERIOD,
      startDate: { lte: day },
      endDate: { gte: day },
    },
    select: { userId: true, deputyId: true },
  });
}

async function availableDeputies(
  db: AbsenceRoutingDb,
  deputyIds: string[],
  day: Date,
): Promise<string[]> {
  const uniqueIds = [...new Set(deputyIds)];
  if (uniqueIds.length === 0) return [];

  const [people, absentIds] = await Promise.all([
    db.user.findMany({
      where: {
        id: { in: uniqueIds },
        isActive: true,
        isUnitManager: true,
      },
      select: { id: true },
      orderBy: { id: "asc" },
    }),
    activeManagerIds(db, uniqueIds, day),
  ]);

  return people
    .map((person) => person.id)
    .filter((id) => !absentIds.has(id));
}

async function parentUnitId(
  db: AbsenceRoutingDb,
  unitId: string,
): Promise<string | null> {
  const unit = await db.orgUnit.findUnique({
    where: { id: unitId },
    select: { parentId: true },
  });

  return unit?.parentId ?? null;
}


export async function listAbsenceDeputies(
  db: Pick<PrismaClient, "user">,
  excludedId: string,
): Promise<AbsenceDeputyOption[]> {
  return db.user.findMany({
    where: {
      id: { not: excludedId },
      isActive: true,
      isUnitManager: true,
    },
    select: { id: true, fullName: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });
}


export async function resolveAbsenceApprovers(
  db: AbsenceRoutingDb,
  departmentId: string,
  now: Date = new Date(),
): Promise<AbsenceApprover[]> {
  const day = toDateValue(companyDay(now));
  let unitId: string | null = departmentId;
  let firstLevel = true;

  for (let level = 0; level < MAX_LEVELS && unitId !== null; level += 1) {
    const managers: ManagerRow[] = await db.user.findMany({
      where: { orgUnitId: unitId, isUnitManager: true, isActive: true },
      select: { id: true, orgUnitId: true },
      orderBy: { id: "asc" },
    });

    if (managers.length > 0) {
      const managerIds = managers.map((manager) => manager.id);
      const [absentManagerIds, absences] = await Promise.all([
        activeManagerIds(db, managerIds, day),
        currentManagerAbsences(db, managerIds, day),
      ]);

      const available = managers.filter(
        (manager) => !absentManagerIds.has(manager.id),
      );
      if (available.length > 0) {
        return available.map((manager) => ({
          id: manager.id,
          route: firstLevel ? "DIRECT_MANAGER" : "UPPER_MANAGER",
        }));
      }

      const deputies = await availableDeputies(
        db,
        absences
          .map((absence) => absence.deputyId)
          .filter((id): id is string => id !== null),
        day,
      );
      if (deputies.length > 0) {
        return deputies.map((id) => ({ id, route: "DEPUTY" }));
      }
    }

    unitId = await parentUnitId(db, unitId);
    firstLevel = false;
  }

  return [];
}


export async function resolveAbsenceApproversForUser(
  db: AbsenceRoutingDb,
  userId: string,
  now: Date = new Date(),
): Promise<AbsenceApprover[]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { orgUnitId: true, isActive: true, isUnitManager: true },
  });

  if (!user?.isActive || user.isUnitManager) return [];
  return resolveAbsenceApprovers(db, user.orgUnitId, now);
}


export async function absenceDecisionRoute(
  db: AbsenceRoutingDb,
  actorId: string,
  userId: string,
  now: Date = new Date(),
): Promise<NoActivityDecisionRoute | null> {
  const approvers = await resolveAbsenceApproversForUser(db, userId, now);
  return approvers.find((approver) => approver.id === actorId)?.route ?? null;
}


export async function managedAbsenceEmployeeIds(
  db: AbsenceRoutingDb,
  managerId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const manager = await db.user.findUnique({
    where: { id: managerId },
    select: { orgUnitId: true, isUnitManager: true, isActive: true },
  });
  if (!manager?.isUnitManager || !manager.isActive) return [];

  const ownEmployees = await db.user.findMany({
    where: {
      orgUnitId: manager.orgUnitId,
      isUnitManager: false,
    },
    select: { id: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });

  const currentManagerPeriods = await db.noActivityPeriod.findMany({
    where: {
      ...CURRENT_PERIOD,
      startDate: { lte: toDateValue(companyDay(now)) },
      endDate: { gte: toDateValue(companyDay(now)) },
      user: { isUnitManager: true, isActive: true },
    },
    select: { user: { select: { orgUnitId: true } } },
  });

  const delegatedEmployees: string[] = [];
  const seenDepartments = new Set<string>();
  for (const period of currentManagerPeriods) {
    const departmentId = period.user.orgUnitId;
    if (seenDepartments.has(departmentId)) continue;

    const approvers = await resolveAbsenceApprovers(db, departmentId, now);
    if (!approvers.some((approver) => approver.id === managerId)) continue;

    seenDepartments.add(departmentId);
    const employees = await db.user.findMany({
      where: { orgUnitId: departmentId, isUnitManager: false },
      select: { id: true },
    });
    delegatedEmployees.push(...employees.map((employee) => employee.id));
  }

  return [...new Set([...ownEmployees.map((employee) => employee.id), ...delegatedEmployees])];
}


export async function visibleAbsenceUserIds(
  db: AbsenceRoutingDb,
  managerId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const manager = await db.user.findUnique({
    where: { id: managerId },
    select: { orgUnitId: true, isUnitManager: true, isActive: true },
  });
  if (!manager?.isUnitManager || !manager.isActive) return [];

  const subtreeUsers = await db.$queryRaw<{ id: string }[]>`
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
    WHERE u."id" <> ${managerId}
  `;

  const day = toDateValue(companyDay(now));
  const delegatedPeriods = await db.noActivityPeriod.findMany({
    where: {
      ...CURRENT_PERIOD,
      startDate: { lte: day },
      endDate: { gte: day },
      deputyId: managerId,
    },
    select: { user: { select: { orgUnitId: true } } },
  });

  const delegatedUnitIds = [
    ...new Set(delegatedPeriods.map((period) => period.user.orgUnitId)),
  ];
  const delegatedUsers = delegatedUnitIds.length
    ? await db.user.findMany({
        where: { orgUnitId: { in: delegatedUnitIds }, id: { not: managerId } },
        select: { id: true },
      })
    : [];

  return [
    ...new Set([
      ...subtreeUsers.map((person) => person.id),
      ...delegatedUsers.map((person) => person.id),
    ]),
  ];
}

/** Returns a worker only once when multiple manager routes reach them. */
export function dedupeAbsenceApprovers(
  approvers: AbsenceApprover[],
): AbsenceApprover[] {
  return uniqueApprovers(approvers);
}
