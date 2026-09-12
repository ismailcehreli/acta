import { ActivityApprovalStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});


/** Reason fields; required by constraint on CHANGES_REQUESTED and REJECTED. */
async function reasonFields(status: ActivityApprovalStatus) {
  if (status !== "CHANGES_REQUESTED" && status !== "REJECTED") return {};

  const reason = await testDb.approvalReason.upsert({
    where: { kind_label: { kind: status, label: "Test reason" } },
    create: { kind: status, label: "Test reason" },
    update: {},
  });

  return { approvalReasonId: reason.id, approvalReasonKind: status } as const;
}

async function newActivity(status?: ActivityApprovalStatus) {
  const unit = await createOrgUnit();
  const user = await createUser(unit.id);
  const approver = await createUser(unit.id, { fullName: "Approver" });

  return createActivity(
    user,
    status
      ? {
          approvalStatus: status,
          approverId: approver.id,
          ...(await reasonFields(status)),
        }
      : {},
  );
}

describe("target department limit constraint", () => {
  it("allows adding five target departments", async () => {
    const activity = await newActivity();
    const root = await testDb.orgUnit.findFirstOrThrow();

    for (let i = 0; i < 4; i += 1) {
      const dept = await createOrgUnit({ parentId: root.id });
      await testDb.activityTargetDept.create({
        data: { activityId: activity.id, orgUnitId: dept.id },
      });
    }
    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: root.id },
    });

    const count = await testDb.activityTargetDept.count({
      where: { activityId: activity.id },
    });
    expect(count).toBe(5);
  });

  it("rejects sixth target department", async () => {
    const activity = await newActivity();
    const root = await testDb.orgUnit.findFirstOrThrow();

    for (let i = 0; i < 5; i += 1) {
      const dept = await createOrgUnit({ parentId: root.id });
      await testDb.activityTargetDept.create({
        data: { activityId: activity.id, orgUnitId: dept.id },
      });
    }

    const sixth = await createOrgUnit({ parentId: root.id });
    await expect(
      testDb.activityTargetDept.create({
        data: { activityId: activity.id, orgUnitId: sixth.id },
      }),
    ).rejects.toThrow(/ACTIVITY_TARGET_LIMIT/);
  });
});

// State diagram in §5.4. Database rejects any invalid status transition.
describe("approval status transitions", () => {
  const allowed: [ActivityApprovalStatus, ActivityApprovalStatus][] = [
    ["DRAFT", "PENDING_APPROVAL"],
    ["PENDING_APPROVAL", "APPROVED"],
    ["PENDING_APPROVAL", "CHANGES_REQUESTED"],
    ["PENDING_APPROVAL", "MANAGER_NOT_FOUND"],
    ["CHANGES_REQUESTED", "PENDING_APPROVAL"],
    ["CHANGES_REQUESTED", "MANAGER_NOT_FOUND"],
    ["MANAGER_NOT_FOUND", "PENDING_APPROVAL"],
    ["APPROVED", "CANCELLED"],
  ];

  const rejected: [ActivityApprovalStatus, ActivityApprovalStatus][] = [
    // Cancellation is irreversible (§5.5)
    ["CANCELLED", "APPROVED"],
    ["CANCELLED", "DRAFT"],
    // Activities with missing managers cannot be auto-approved (§4.4)
    ["MANAGER_NOT_FOUND", "APPROVED"],
    // Approved activity does not return to approval queue
    ["APPROVED", "PENDING_APPROVAL"],
    ["APPROVED", "CHANGES_REQUESTED"],
    // Cannot skip approval step
    ["PENDING_APPROVAL", "DRAFT"],
    ["CHANGES_REQUESTED", "APPROVED"],
  ];

  it.each(allowed)("allows transition %s → %s", async (from, to) => {
    const activity = await newActivity(from);

    const updated = await testDb.activity.update({
      where: { id: activity.id },
      data: {
        approvalStatus: to,
        ...(await reasonFields(to)),
        ...(to === "CHANGES_REQUESTED" || to === "REJECTED"
          ? {}
          : { approvalReasonId: null, approvalReasonKind: null }),
      },
    });

    expect(updated.approvalStatus).toBe(to);
  });

  it.each(rejected)("rejects transition %s → %s", async (from, to) => {
    const activity = await newActivity(from);

    await expect(
      testDb.activity.update({
        where: { id: activity.id },
        data: {
          approvalStatus: to,
          ...(await reasonFields(to)),
          ...(to === "CHANGES_REQUESTED" || to === "REJECTED"
            ? {}
            : { approvalReasonId: null, approvalReasonKind: null }),
        },
      }),
    ).rejects.toThrow(/ACTIVITY_INVALID_STATUS_TRANSITION/);
  });

  it("allows updates that do not change status", async () => {
    const activity = await newActivity("APPROVED");

    const updated = await testDb.activity.update({
      where: { id: activity.id },
      data: { title: "Updated title" },
    });

    expect(updated.title).toBe("Updated title");
  });
});
