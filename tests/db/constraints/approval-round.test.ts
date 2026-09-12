import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Approval round database constraints (audit 23.08.2026, P3-R2-1).
//
// Proves constraints are enforced by the database even when application logic is bypassed.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupRecord() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const unit = await createOrgUnit({
    name: "Workshop",
    parentId: root.id,
    requiresApproval: true,
  });
  const manager = await createUser(unit.id, {
    fullName: "Manager",
    isUnitManager: true,
  });
  const author = await createUser(unit.id, { fullName: "Author" });
  const activity = await createActivity(author, {
    approvalStatus: "PENDING_APPROVAL",
    approverId: manager.id,
    approvalSubmittedAt: new Date("2026-08-03T08:00:00.000Z"),
  });

  return { activity, manager };
}

describe("approval round constraints", () => {
  it("cannot have two open rounds on the same activity", async () => {
    const { activity } = await setupRecord();

    // Second open round: partial unique index protects only one open round per activity.
    await expect(
      testDb.$executeRaw`
        INSERT INTO "ApprovalRound" ("id", "activityId", "roundNo", "submittedAt")
        VALUES (gen_random_uuid(), ${activity.id}, 2, '2026-08-04T08:00:00Z')
      `,
    ).rejects.toThrow(/23505[\s\S]*Key \("activityId"\)/);
  });

  it("decided round requires decision author", async () => {
    const { activity } = await setupRecord();

    await expect(
      testDb.$executeRaw`
        INSERT INTO "ApprovalRound" ("id", "activityId", "roundNo", "submittedAt", "decidedAt")
        VALUES (gen_random_uuid(), ${activity.id}, 1, '2026-08-03T08:00:00Z', '2026-08-04T09:00:00Z')
      `,
    ).rejects.toThrow(/ApprovalRound_decision_consistency/);
  });

  it("decision cannot predate submission", async () => {
    const { activity, manager } = await setupRecord();

    await expect(
      testDb.$executeRaw`
        INSERT INTO "ApprovalRound"
          ("id", "activityId", "roundNo", "submittedAt", "decidedAt", "decidedById", "decision")
        VALUES (gen_random_uuid(), ${activity.id}, 1,
                '2026-08-04T09:00:00Z', '2026-08-03T08:00:00Z', ${manager.id}, 'APPROVED')
      `,
    ).rejects.toThrow(/ApprovalRound_decision_after_submission/);
  });

  it("decided round is not treated as open", async () => {
    const { activity, manager } = await setupRecord();

    // Decide open round: no longer covered by open round partial index
    await testDb.approvalRound.updateMany({
      where: { activityId: activity.id, decidedAt: null },
      data: {
        decidedAt: new Date("2026-08-04T09:00:00.000Z"),
        decidedById: manager.id,
        decision: "CHANGES_REQUESTED",
      },
    });

    const secondRound = await testDb.approvalRound.create({
      data: {
        activityId: activity.id,
        roundNo: 2,
        submittedAt: new Date("2026-08-05T08:00:00.000Z"),
      },
    });

    expect(secondRound.roundNo).toBe(2);
  });

  // Immutability (audit 23.08.2026, P3-R3-1)
  it("cannot delete approval round", async () => {
    const { activity } = await setupRecord();

    await expect(
      testDb.$executeRaw`DELETE FROM "ApprovalRound" WHERE "activityId" = ${activity.id}`,
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("cannot overwrite decided round", async () => {
    const { activity, manager } = await setupRecord();

    await testDb.approvalRound.updateMany({
      where: { activityId: activity.id, decidedAt: null },
      data: {
        decidedAt: new Date("2026-08-04T09:00:00.000Z"),
        decidedById: manager.id,
        decision: "APPROVED",
      },
    });

    await expect(
      testDb.$executeRaw`
        UPDATE "ApprovalRound"
        SET "decidedAt" = '2026-08-05T09:00:00Z'
        WHERE "activityId" = ${activity.id}
      `,
    ).rejects.toThrow(/APPROVAL_ROUND_IMMUTABLE/);
  });

  it("cannot modify round submission timestamp", async () => {
    const { activity } = await setupRecord();

    await expect(
      testDb.$executeRaw`
        UPDATE "ApprovalRound"
        SET "submittedAt" = '2026-07-01T09:00:00Z',
            "decidedAt" = '2026-08-04T09:00:00Z'
        WHERE "activityId" = ${activity.id}
      `,
    ).rejects.toThrow(/APPROVAL_ROUND_IMMUTABLE/);
  });

  it("cannot record cancellation as approval decision", async () => {
    const { activity, manager } = await setupRecord();

    await expect(
      testDb.$executeRaw`
        UPDATE "ApprovalRound"
        SET "decidedAt" = '2026-08-04T09:00:00Z',
            "decidedById" = ${manager.id},
            "decision" = 'CANCELLED'
        WHERE "activityId" = ${activity.id}
      `,
    ).rejects.toThrow(/ApprovalRound_valid_decision/);
  });
});
