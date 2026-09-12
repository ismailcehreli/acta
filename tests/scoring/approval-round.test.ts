import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  approveActivity,
  rejectActivity,
  requestChanges,
} from "@/server/activities/approval";
import { createActivity, updateActivity } from "@/server/activities/write";
import { collectScoreInput } from "@/server/scoring/collect";

import { createApprovalReason, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Approval duration is measured from the real approval flow (audit 23.08.2026, P3-R2-1).
//
// Measurement previously checked `Activity.approvalSubmittedAt` and `approvalDecidedAt` columns.
// In production, `approveActivity`, `requestChanges`, and `rejectActivity` clear
// `approvalSubmittedAt` when writing the decision timestamp: that column means
// "how long has it currently been waiting". The result was that every decided activity
// dropped out of measurement and the manager received full weight for approval duration.
//
// The test missed this because it set up the row manually: an `APPROVED` record with both
// timestamps populated never exists in production. This file calls production services only.

const PERIOD_START = new Date("2026-08-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-08-31T00:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupTeam() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const unit = await createOrgUnit({
    name: "Tooling Shop",
    parentId: root.id,
    requiresApproval: true,
  });
  const manager = await createUser(unit.id, {
    fullName: "Shop Manager",
    isUnitManager: true,
  });
  const author = await createUser(unit.id, { fullName: "Worker Kadir" });

  return {
    manager,
    author,
    unit,
    createTestActivity: async (dateStr: string, timestampStr: string) => {
      const result = await createActivity(
        testDb,
        { id: author.id, orgUnitId: unit.id, requiresApproval: true },
        {
          activityDate: dateStr,
          title: "Mold maintenance performed",
          description: "Mold disassembled, cleaned, and reassembled.",
          targetDepartmentIds: [unit.id],
        },
        new Date(timestampStr),
      );
      if (!result.ok) throw new Error(`activity could not be created: ${result.error}`);
      return result.activity;
    },
  };
}

const asUser = (id: string) => ({ id, isSystemAdmin: false });

const getInput = (userId: string) =>
  collectScoreInput(testDb, asUser(userId), userId, PERIOD_START, PERIOD_END);

describe("approval duration measured from real flow", () => {
  it("measures timely decision", async () => {
    const { manager, createTestActivity } = await setupTeam();
    const activity = await createTestActivity("2026-08-03", "2026-08-03T08:00:00.000Z");

    const decision = await approveActivity(
      testDb,
      manager.id,
      activity.id,
      new Date("2026-08-04T09:00:00.000Z"),
    );
    expect(decision.ok).toBe(true);

    const input = await getInput(manager.id);

    expect(input.decidedCount).toBe(1);
    expect(input.decidedOnTimeCount).toBe(1);
  });

  it("measures late decision and does not count as timely", async () => {
    const { manager, createTestActivity } = await setupTeam();
    const activity = await createTestActivity("2026-08-03", "2026-08-03T08:00:00.000Z");

    // Submitted Monday, approved next Monday: 5 work days, threshold 2.
    await approveActivity(
      testDb,
      manager.id,
      activity.id,
      new Date("2026-08-10T09:00:00.000Z"),
    );

    const input = await getInput(manager.id);

    expect(input.decidedCount).toBe(1);
    expect(input.decidedOnTimeCount).toBe(0);
  });

  it("revision and resubmission count as two distinct rounds", async () => {
    const { manager, author, unit, createTestActivity } = await setupTeam();
    const activity = await createTestActivity("2026-08-05", "2026-08-05T08:00:00.000Z");
    const reason = await createApprovalReason("CHANGES_REQUESTED");

    // Round 1: fast change request.
    const changeRequest = await requestChanges(
      testDb,
      manager.id,
      activity.id,
      { reasonId: reason.id },
      new Date("2026-08-05T10:00:00.000Z"),
    );
    expect(changeRequest.ok).toBe(true);

    // Author revises and resubmits: work is back before manager.
    const revision = await updateActivity(
      testDb,
      author.id,
      {
        id: activity.id,
        activityDate: "2026-08-05",
        title: "Mold maintenance performed and calibrated",
        description: "Mold disassembled, cleaned, calibrated, and reassembled.",
        targetDepartmentIds: [unit.id],
      },
      new Date("2026-08-05T11:00:00.000Z"),
    );
    if (!revision.ok) throw new Error(`revision rejected: ${revision.error}`);

    // Round 2: late decision this time (5 work days).
    await approveActivity(
      testDb,
      manager.id,
      activity.id,
      new Date("2026-08-12T09:00:00.000Z"),
    );

    const input = await getInput(manager.id);

    // A single column could not hold two rounds; both decisions are measured.
    expect(input.decidedCount).toBe(2);
    expect(input.decidedOnTimeCount).toBe(1);
  });

  it("undecided round is not included in measurement", async () => {
    const { manager, createTestActivity } = await setupTeam();
    await createTestActivity("2026-08-03", "2026-08-03T08:00:00.000Z");

    const input = await getInput(manager.id);

    expect(input.decidedCount).toBe(0);
  });
});

// Lack of an open round cannot be swallowed on a PENDING activity (audit 23.08.2026, P3-R3-2).
//
// `rejectActivity` accepts both pending and changes-requested activities, but previously
// gave "skip if no open round" to both. For pending activities, a round is mandatory:
// swallowing its absence means the decision is never recorded to history and the manager
// gets full score for an unmeasured dimension.
describe("mandatory round in rejection path", () => {
  it("activity with changes requested is rejected without requiring open round", async () => {
    const { manager, createTestActivity } = await setupTeam();
    const activity = await createTestActivity("2026-08-05", "2026-08-05T08:00:00.000Z");
    const changeReason = await createApprovalReason("CHANGES_REQUESTED");

    await requestChanges(
      testDb,
      manager.id,
      activity.id,
      { reasonId: changeReason.id },
      new Date("2026-08-05T10:00:00.000Z"),
    );

    // Work is before author: no open round, but rejection should succeed (19.08.2026 decision).
    const rejectReason = await createApprovalReason("REJECTED");
    const result = await rejectActivity(
      testDb,
      manager.id,
      activity.id,
      { reasonId: rejectReason.id },
      new Date("2026-08-06T09:00:00.000Z"),
    );

    expect(result.ok).toBe(true);
  });

  it("rejection fails if pending activity has no open round", async () => {
    const { manager, createTestActivity } = await setupTeam();
    const activity = await createTestActivity("2026-08-05", "2026-08-05T08:00:00.000Z");

    // Bypass application layer to delete round: simulating corrupt data.
    // (Deletion block is bypassed with demo purge flag; not the subject of this test.)
    await testDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'yes'");
      await tx.approvalRound.deleteMany({ where: { activityId: activity.id } });
    });

    const rejectReason = await createApprovalReason("REJECTED");
    await expect(
      rejectActivity(
        testDb,
        manager.id,
        activity.id,
        { reasonId: rejectReason.id },
        new Date("2026-08-06T09:00:00.000Z"),
      ),
    ).rejects.toThrow(/Approval round not found/);

    // Transaction was rolled back: activity remains pending.
    const fresh = await testDb.activity.findUniqueOrThrow({ where: { id: activity.id } });
    expect(fresh.approvalStatus).toBe("PENDING_APPROVAL");
  });
});
