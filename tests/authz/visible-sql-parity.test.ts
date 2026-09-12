import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  visibleActivitySql,
  visibleActivityWhere,
  type Viewer,
} from "@/server/authz/visibility";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// The visibility rule has two representations: Prisma filter (list, detail) and
// SQL fragment (search). Discrepancy between them means a silent leak — this
// file links the two together: they must return the exact same set of IDs.
//
// The test builds a representative company hierarchy with authors across all levels
// and activities across all approval statuses, ensuring parity under every combination.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

const APPROVAL_STATUSES = [
  "APPROVED",
  "CANCELLED",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "REJECTED",
  "MANAGER_NOT_FOUND",
  "DRAFT",
] as const;

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const hq = await createOrgUnit({ name: "Headquarters", parentId: root.id });
  const workshop = await createOrgUnit({ name: "Workshop", parentId: hq.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: hq.id });

  const president = await createUser(root.id, { fullName: "President", isUnitManager: true });
  const generalManager = await createUser(hq.id, { fullName: "General Manager", isUnitManager: true });
  const workshopManager = await createUser(workshop.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const planningManager = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });
  const workshopEmployee = await createUser(workshop.id, { fullName: "Workshop Employee" });
  const systemAdmin = await createUser(hq.id, {
    fullName: "System Admin",
    isSystemAdmin: true,
  });

  const authors = [
    president,
    generalManager,
    workshopManager,
    planningManager,
    workshopEmployee,
    systemAdmin,
  ];

  // Create one activity per author and status combination.
  const { resolveManager } = await import("@/server/org/resolve-manager");
  let day = 1;
  for (const author of authors) {
    for (const status of APPROVAL_STATUSES) {
      const requiresApproval =
        status === "PENDING_APPROVAL" ||
        status === "CHANGES_REQUESTED" ||
        status === "REJECTED";
      const managerResult = requiresApproval
        ? await resolveManager(testDb, author.id)
        : null;
      const approverId =
        managerResult && managerResult.found ? managerResult.managerId : null;
      const actualStatus =
        requiresApproval && approverId === null ? "MANAGER_NOT_FOUND" : status;

      await testDb.activity.create({
        data: {
          authorId: author.id,
          authorOrgUnitId: author.orgUnitId,
          activityDate: new Date(Date.UTC(2026, 7, (day % 28) + 1)),
          title: `${author.fullName} ${status}`,
          description: "Activity description",
          approvalStatus: actualStatus,
          approverId: actualStatus === status ? approverId : null,
          ...(actualStatus === "CHANGES_REQUESTED" || actualStatus === "REJECTED"
            ? {
                approvalReasonId: (
                  await testDb.approvalReason.upsert({
                    where: {
                      kind_label: { kind: actualStatus, label: "Test reason" },
                    },
                    create: { kind: actualStatus, label: "Test reason" },
                    update: {},
                  })
                ).id,
                approvalReasonKind: actualStatus,
              }
            : {}),
        },
      });
      day += 1;
    }
  }

  return { authors };
}

async function fetchPrismaIds(viewer: Viewer): Promise<string[]> {
  const where = await visibleActivityWhere(testDb, viewer);
  const rows = await testDb.activity.findMany({ where, select: { id: true } });
  return rows.map((r) => r.id).sort();
}

async function fetchSqlIds(viewer: Viewer): Promise<string[]> {
  const filter = await visibleActivitySql(testDb, viewer, "a");
  const rows = await testDb.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT a."id" FROM "Activity" a WHERE ${filter}`,
  );
  return rows.map((r) => r.id).sort();
}

describe("visibility representations yield identical result sets", () => {
  it("produces identical results for viewers at every level of the hierarchy", async () => {
    const { authors } = await setupCompany();

    for (const person of authors) {
      const viewer: Viewer = {
        id: person.id,
        isSystemAdmin: person.isSystemAdmin,
      };

      const prismaIds = await fetchPrismaIds(viewer);
      const sqlIds = await fetchSqlIds(viewer);

      expect(sqlIds, `Discrepancy for ${person.fullName}`).toEqual(prismaIds);
      expect(prismaIds.length).toBeGreaterThan(0);
    }
  });

  it("user without subordinates only sees their own records", async () => {
    const { authors } = await setupCompany();
    const employee = authors.find((y) => y.fullName === "Workshop Employee")!;
    const viewer: Viewer = { id: employee.id, isSystemAdmin: false };

    const sqlIds = await fetchSqlIds(viewer);
    const ownRecords = await testDb.activity.findMany({
      where: { authorId: employee.id },
      select: { id: true },
    });

    expect(sqlIds).toEqual(ownRecords.map((r) => r.id).sort());
  });

  it("rejects invalid table alias", async () => {
    const { authors } = await setupCompany();

    await expect(
      visibleActivitySql(testDb, { id: authors[0].id, isSystemAdmin: false }, 'a" OR "1'),
    ).rejects.toThrow(/Invalid table alias/);
  });
});
