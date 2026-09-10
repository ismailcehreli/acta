import type { PrismaClient } from "@prisma/client";

import { countableActivityWhere } from "@/server/activities/countable";
import { companyDay, toDateValue } from "@/server/activities/date-rules";
import {
  managedAuthorsWhere,
  periodStart,
  type FeedFilters,
} from "@/server/activities/scope-feed";
import {
  groupVisibleActivities,
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import { readBooleanSetting } from "@/server/settings/system-settings";
import { SETTING_KEYS } from "@/server/settings/registry";
import { rollupByOrgUnit } from "@/server/reports/rollup";

// Yönetici dashboard'undaki birim özeti. Satırlar artık düz bir liste değil,
// yöneticinin bağlı olduğu birimden aşağı doğru gelen ağacın görünür dalıdır.
// Sayaçların tamamı faaliyet akışındaki aynı görünürlük kapısından geçer.

export type DepartmentSummaryDb = Pick<
  PrismaClient,
  "user" | "orgUnit" | "systemSetting"
> & ActivityRepositoryDb;

export interface DepartmentSummaryRow {
  orgUnitId: string;
  parentId: string | null;
  name: string;
  /** Bu birimdeki ve alt birimlerdeki aktif kişi sayısı. */
  people: number;
  /** Bu birimdeki ve alt birimlerdeki görünür faaliyet sayısı. */
  activityCount: number;
  /** Yalnız bu birime bağlı aktif kişi sayısı. */
  directPeople: number;
  /** Yalnız bu birimdeki görünür faaliyet sayısı. */
  directActivityCount: number;
  /** Bu satırın altında başka görünür birimler var mı? */
  isRollup: boolean;
  /** Yönetici biriminin altından itibaren girinti seviyesi. */
  depth: number;
  /** Bu birim ve alt birimlerde görülebilen bekleyen onay sayısı. */
  pendingApproval: number;
  /** Katılım özeti ayarı açıksa doğrudan/alt toplam. */
  participation: { wrote: number; expected: number } | null;
}

export interface DepartmentSummaryOptions {
  /** Yönetilen alanın kök satırını da göster. */
  includeRoot?: boolean;
}

type Unit = { id: string; name: string; parentId: string | null; sortOrder: number };
type Aggregate = {
  people: number;
  activityCount: number;
  pendingApproval: number;
  wrote: number;
  expected: number;
};

function emptyAggregate(): Aggregate {
  return { people: 0, activityCount: 0, pendingApproval: 0, wrote: 0, expected: 0 };
}

function mergeAggregate(target: Aggregate, source: Aggregate): void {
  target.people += source.people;
  target.activityCount += source.activityCount;
  target.pendingApproval += source.pendingApproval;
  target.wrote += source.wrote;
  target.expected += source.expected;
}

export async function departmentSummary(
  db: DepartmentSummaryDb,
  viewer: { id: string; isSystemAdmin: boolean },
  subordinates: string[],
  period: FeedFilters["period"],
  now: Date,
  options: DepartmentSummaryOptions = {},
): Promise<DepartmentSummaryRow[]> {
  if (subordinates.length === 0) return [];

  const [actor, people, units, participationEnabled] = await Promise.all([
    db.user.findUnique({ where: { id: viewer.id }, select: { orgUnitId: true } }),
    db.user.findMany({
      where: { id: { in: subordinates }, isActive: true },
      select: { id: true, orgUnitId: true, writesActivities: true },
    }),
    db.orgUnit.findMany({
      where: { isActive: true },
      select: { id: true, name: true, parentId: true, sortOrder: true },
    }),
    readBooleanSetting(db, SETTING_KEYS.managerParticipationSummary),
  ]);

  if (!actor || people.length === 0) return [];

  const unitById = new Map<string, Unit>(units.map((unit) => [unit.id, unit]));
  const childrenByParent = new Map<string | null, Unit[]>();
  for (const unit of units) {
    const children = childrenByParent.get(unit.parentId) ?? [];
    children.push(unit);
    childrenByParent.set(unit.parentId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"),
    );
  }

  const directPeople = new Map<string, number>();
  const expectedPeople = new Map<string, number>();
  for (const person of people) {
    directPeople.set(person.orgUnitId, (directPeople.get(person.orgUnitId) ?? 0) + 1);
    if (person.writesActivities) {
      expectedPeople.set(person.orgUnitId, (expectedPeople.get(person.orgUnitId) ?? 0) + 1);
    }
  }

  const visibleUnitIds = [...directPeople.keys()].filter((id) => unitById.has(id));
  if (visibleUnitIds.length === 0) return [];

  const start = periodStart(period, now);
  const activityWhere = {
    AND: [
      managedAuthorsWhere(subordinates),
      { authorOrgUnitId: { in: visibleUnitIds } },
      // Sayım tanımı tek yerde (karar 03.09.2026): iptal **ve** ret dışarıda.
      // Aşağıdaki katılım okuması bilerek bu tanımı kullanmıyor — reddedilen
      // kayıt, kişinin o gün çalışmadığı anlamına gelmez.
      countableActivityWhere(),
      ...(start ? [{ activityDate: { gte: start } }] : []),
    ],
  };

  const [activityRows, pendingRows, todayWriters] = await Promise.all([
    groupVisibleActivities(
      db,
      viewer,
      { by: ["authorOrgUnitId"], where: activityWhere, _count: { _all: true } },
      subordinates,
    ) as Promise<{ authorOrgUnitId: string; _count: { _all: number } }[]>,
    groupVisibleActivities(
      db,
      viewer,
      {
        by: ["authorOrgUnitId"],
        where: {
          AND: [
            managedAuthorsWhere(subordinates),
            { authorOrgUnitId: { in: visibleUnitIds } },
            { approvalStatus: "PENDING_APPROVAL" },
          ],
        },
        _count: { _all: true },
      },
      subordinates,
    ) as Promise<{ authorOrgUnitId: string; _count: { _all: number } }[]>,
    participationEnabled
      ? listVisibleActivities(
          db,
          viewer,
          {
            where: {
              AND: [
                managedAuthorsWhere(subordinates),
                { authorOrgUnitId: { in: visibleUnitIds } },
                { activityDate: toDateValue(companyDay(now)) },
                { approvalStatus: { not: "CANCELLED" as const } },
              ],
            },
            select: { authorId: true, authorOrgUnitId: true },
            distinct: ["authorId"],
          },
          subordinates,
        )
      : Promise.resolve([]),
  ]);

  const directActivities = new Map(
    activityRows.map((row) => [row.authorOrgUnitId, row._count._all]),
  );
  const directPending = new Map(
    pendingRows.map((row) => [row.authorOrgUnitId, row._count._all]),
  );
  const directWriters = new Map<string, number>();
  for (const writer of todayWriters) {
    directWriters.set(
      writer.authorOrgUnitId,
      (directWriters.get(writer.authorOrgUnitId) ?? 0) + 1,
    );
  }

  const ownUnitId = actor.orgUnitId;
  const directAggregates = new Map<string, Aggregate>();
  for (const unitId of visibleUnitIds) {
    directAggregates.set(unitId, {
      people: directPeople.get(unitId) ?? 0,
      activityCount: directActivities.get(unitId) ?? 0,
      pendingApproval: directPending.get(unitId) ?? 0,
      wrote: directWriters.get(unitId) ?? 0,
      expected: expectedPeople.get(unitId) ?? 0,
    });
  }
  const totals = rollupByOrgUnit(units, ownUnitId, directAggregates, {
    createEmpty: emptyAggregate,
    clone: (value) => ({ ...value }),
    merge: mergeAggregate,
  });

  const hasPeopleBelow = (unitId: string): boolean => {
    if ((directPeople.get(unitId) ?? 0) > 0) return true;
    return (childrenByParent.get(unitId) ?? []).some((child) => hasPeopleBelow(child.id));
  };

  const root = unitById.get(ownUnitId);
  if (!root) return [];

  const rows: DepartmentSummaryRow[] = [];
  const write = (unit: Unit, depth: number): void => {
    const aggregate = totals.get(unit.id) ?? emptyAggregate();
    const include =
      unit.id !== ownUnitId ||
      options.includeRoot === true ||
      (directPeople.get(unit.id) ?? 0) > 0;

    if (include) {
      rows.push({
        orgUnitId: unit.id,
        parentId: unit.parentId,
        name: unit.name,
        people: aggregate.people,
        activityCount: aggregate.activityCount,
        directPeople: directPeople.get(unit.id) ?? 0,
        directActivityCount: directActivities.get(unit.id) ?? 0,
        isRollup: (childrenByParent.get(unit.id) ?? []).some((child) =>
          hasPeopleBelow(child.id),
        ),
        depth,
        pendingApproval: aggregate.pendingApproval,
        participation:
          participationEnabled && aggregate.expected > 0
            ? { wrote: aggregate.wrote, expected: aggregate.expected }
            : null,
      });
    }

    for (const child of childrenByParent.get(unit.id) ?? []) {
      if (hasPeopleBelow(child.id)) {
        write(child, depth + 1);
      }
    }
  };

  write(root, 0);
  return rows;
}
