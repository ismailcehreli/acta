import type { ActivityApprovalStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  canViewActivity,
  subordinateUserIds,
  visibleActivityWhere,
} from "@/server/authz/visibility";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// LIST ↔ DETAIL PARITY
//
// Visibility is represented by two separate functions:
// - `visibleActivityWhere`: filters list queries.
// - `canViewActivity`: evaluates single activity access.
//
// They are two representations of the same invariant:
//   canViewActivity(...) === "full"  ⟺  activity is in visibleActivityWhere
//
// "metadata" is intentionally excluded: System administrators can see MANAGER_NOT_FOUND
// records with metadata only to enable routing interventions (§8.2).
// Metadata access must never leak full content into list views.

const APPROVAL_STATUSES: ActivityApprovalStatus[] = [
  "APPROVED",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "REJECTED",
  "CANCELLED",
  "MANAGER_NOT_FOUND",
];

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/**
 * Company tree:
 *   Acta HQ (root)
 *     ├─ generalManager (root manager)
 *     ├─ secondGM       (root manager — co-manager in same unit)
 *     ├─ boardMember    (employee in root, not a manager)
 *     └─ Workshop
 *          ├─ workshopManager (unit manager)
 *          └─ workshopWorker  (employee)
 *     └─ Planning
 *          └─ planner         (employee in unit without manager)
 */
async function setupCompany() {
  const root = await createOrgUnit({ name: "Acta HQ" });
  const workshop = await createOrgUnit({ name: "Workshop", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const generalManager = await createUser(root.id, {
    email: "gm@example.test",
    isUnitManager: true,
    isSystemAdmin: true,
  });
  const secondGM = await createUser(root.id, {
    email: "gm2@example.test",
    isUnitManager: true,
    isSystemAdmin: true,
  });
  const boardMember = await createUser(root.id, { email: "board@example.test" });
  const workshopManager = await createUser(workshop.id, {
    email: "workshop-mgr@example.test",
    isUnitManager: true,
  });
  const workshopWorker = await createUser(workshop.id, { email: "worker@example.test" });
  const planner = await createUser(planning.id, { email: "planner@example.test" });

  return {
    generalManager,
    secondGM,
    boardMember,
    workshopManager,
    workshopWorker,
    planner,
  };
}

/** Check if record is visible in list query */
async function isInList(
  viewerUser: { id: string; isSystemAdmin?: boolean },
  activityId: string,
): Promise<boolean> {
  const viewer = { id: viewerUser.id, isSystemAdmin: viewerUser.isSystemAdmin ?? false };
  const where = await visibleActivityWhere(testDb, viewer);
  const rows = await testDb.activity.findMany({ where, select: { id: true } });

  return rows.some((row) => row.id === activityId);
}

/** Check detail visibility level */
async function detailVisibilityLevel(
  viewerUser: { id: string; isSystemAdmin?: boolean },
  activity: { id: string; authorId: string; approvalStatus: ActivityApprovalStatus },
) {
  const viewer = { id: viewerUser.id, isSystemAdmin: viewerUser.isSystemAdmin ?? false };
  return canViewActivity(testDb, viewer, activity);
}

describe("list and detail visibility yield consistent answers", () => {
  it("two managers in the same unit can both see and open each other's activities", async () => {
    const { generalManager, secondGM } = await setupCompany();
    const activity = await createActivity(secondGM, { approvalStatus: "APPROVED" });

    expect(await isInList(generalManager, activity.id)).toBe(true);
    expect(
      await detailVisibilityLevel(generalManager, {
        id: activity.id,
        authorId: activity.authorId,
        approvalStatus: activity.approvalStatus,
      }),
    ).toBe("full");
  });

  it("parity holds across all hierarchy levels, approval statuses, and authors", async () => {
    const company = await setupCompany();
    const authors = Object.values(company);
    const viewers = Object.values(company);

    const viewerPerspectives = viewers.flatMap((user) => [
      { id: user.id, isSystemAdmin: false },
      { id: user.id, isSystemAdmin: true },
    ]);

    const mismatches: string[] = [];
    const leakRisks: string[] = [];
    let metadataCount = 0;

    for (const author of authors) {
      for (const status of APPROVAL_STATUSES) {
        const activity = await createStatusActivity(author, status);
        const actualStatus = activity.approvalStatus;

        for (const viewer of viewerPerspectives) {
          const listVisible = await isInList(viewer, activity.id);
          const level = await detailVisibilityLevel(viewer, {
            id: activity.id,
            authorId: activity.authorId,
            approvalStatus: actualStatus,
          });

          const label =
            `author=${author.email} status=${actualStatus} viewer=${viewer.id} ` +
            `sysadmin=${viewer.isSystemAdmin}`;

          // Parity invariant: "full" equals listed.
          if ((level === "full") !== listVisible) {
            mismatches.push(`${label} list=${listVisible} level=${level}`);
          }

          // Metadata-only must NEVER appear in content lists.
          if (level === "metadata") {
            metadataCount += 1;
            if (listVisible) leakRisks.push(`${label} — metadata leaked into content list!`);
          }
        }
      }
    }

    if (mismatches.length > 0) console.log(mismatches.slice(0, 8).join("\n"));
    expect(mismatches).toEqual([]);
    expect(leakRisks).toEqual([]);
    expect(metadataCount).toBeGreaterThan(0);
  });

  it("precomputed subordinates do not alter the result", async () => {
    const { generalManager, workshopWorker } = await setupCompany();
    const activity = await createActivity(workshopWorker, { approvalStatus: "APPROVED" });

    const viewer = { id: generalManager.id, isSystemAdmin: false };
    const subordinates = await subordinateUserIds(testDb, generalManager.id);

    const target = {
      id: activity.id,
      authorId: activity.authorId,
      approvalStatus: activity.approvalStatus,
    };

    const withoutPrecomputed = await canViewActivity(testDb, viewer, target);
    const withPrecomputed = await canViewActivity(testDb, viewer, target, subordinates);

    expect(withPrecomputed).toBe(withoutPrecomputed);
  });
});

/**
 * Creates an activity adhering to database constraints for the given status.
 */
async function createStatusActivity(
  author: { id: string; orgUnitId: string },
  status: ActivityApprovalStatus,
) {
  const requiresApproval =
    status === "PENDING_APPROVAL" ||
    status === "CHANGES_REQUESTED" ||
    status === "REJECTED";

  const approverId = requiresApproval ? await findApprover(author) : null;

  if (requiresApproval && approverId === null) {
    return createActivity(author, { approvalStatus: "MANAGER_NOT_FOUND" });
  }

  const activity = await createActivity(author, {
    approvalStatus: status,
    approverId,
    ...(await reasonFields(status)),
  });

  return activity;
}

async function findApprover(author: { id: string; orgUnitId: string }) {
  const { resolveManagers } = await import("@/server/org/resolve-manager");
  const result = await resolveManagers(testDb, author.id);
  return result.found ? result.managerIds[0] : null;
}

async function reasonFields(status: ActivityApprovalStatus) {
  if (status !== "CHANGES_REQUESTED" && status !== "REJECTED") return {};

  const reason = await testDb.approvalReason.upsert({
    where: { kind_label: { kind: status, label: "Test reason" } },
    create: { kind: status, label: "Test reason" },
    update: {},
  });

  return { approvalReasonId: reason.id, approvalReasonKind: status };
}
