import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Approval workflow invariants enforced at database level (AGENTS.md).
//
// Proves constraints hold even when application layer is bypassed:
// these tests test database tables directly.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupUsers() {
  const unit = await createOrgUnit({ name: "Workshop" });
  const author = await createUser(unit.id, { fullName: "Worker" });
  const approver = await createUser(unit.id, {
    fullName: "Manager",
    isUnitManager: true,
  });
  return { unit, author, approver };
}

function baseActivity(author: { id: string; orgUnitId: string }) {
  return {
    authorId: author.id,
    authorOrgUnitId: author.orgUnitId,
    activityDate: new Date("2026-08-18T00:00:00.000Z"),
    title: "Record",
    description: "content",
  };
}

describe("approval constraints", () => {
  it("rejects PENDING_APPROVAL record without approver", async () => {
    const { author } = await setupUsers();

    // Activities without approver would be orphaned and lost
    await expect(
      testDb.activity.create({
        data: { ...baseActivity(author), approvalStatus: "PENDING_APPROVAL" },
      }),
    ).rejects.toThrow(/Activity_approver_required_in_approval/);
  });

  it("author cannot be their own approver (§4.4)", async () => {
    const { author } = await setupUsers();

    await expect(
      testDb.activity.create({
        data: {
          ...baseActivity(author),
          approvalStatus: "PENDING_APPROVAL",
          approverId: author.id,
        },
      }),
    ).rejects.toThrow(/Activity_approver_is_not_author/);
  });

  it("rejects CHANGES_REQUESTED without reason", async () => {
    const { author, approver } = await setupUsers();

    await expect(
      testDb.activity.create({
        data: {
          ...baseActivity(author),
          approvalStatus: "CHANGES_REQUESTED",
          approverId: approver.id,
        },
      }),
    ).rejects.toThrow(/Activity_approval_reason_matches_status/);
  });

  it("rejects REJECTED without reason", async () => {
    const { author, approver } = await setupUsers();

    await expect(
      testDb.activity.create({
        data: {
          ...baseActivity(author),
          approvalStatus: "REJECTED",
          approverId: approver.id,
        },
      }),
    ).rejects.toThrow(/Activity_approval_reason_matches_status/);
  });

  it("reason cannot be attached to other statuses", async () => {
    const { author, approver } = await setupUsers();
    const reason = await createApprovalReason("CHANGES_REQUESTED");

    await expect(
      testDb.activity.create({
        data: {
          ...baseActivity(author),
          approvalStatus: "APPROVED",
          approverId: approver.id,
          approvalReasonId: reason.id,
        },
      }),
    ).rejects.toThrow(/Activity_approval_reason_matches_status/);
  });

  it("reason kind must match decision status", async () => {
    const { author, approver } = await setupUsers();
    const rejectionReason = await createApprovalReason("REJECTED");

    await expect(
      testDb.activity.create({
        data: {
          ...baseActivity(author),
          approvalStatus: "CHANGES_REQUESTED",
          approverId: approver.id,
          approvalReasonId: rejectionReason.id,
          approvalReasonKind: "REJECTED",
        },
      }),
    ).rejects.toThrow(/Activity_approval_reason_kind_matches_status/);
  });

  it("approval note requires reason", async () => {
    const { author, approver } = await setupUsers();

    await expect(
      testDb.activity.create({
        data: {
          ...baseActivity(author),
          approvalStatus: "APPROVED",
          approverId: approver.id,
          approvalReasonNote: "Note without category",
        },
      }),
    ).rejects.toThrow(/Activity_approval_note_requires_reason/);
  });

  it("cannot select nonexistent reason", async () => {
    const { author, approver } = await setupUsers();

    await expect(
      testDb.activity.create({
        data: {
          ...baseActivity(author),
          approvalStatus: "REJECTED",
          approverId: approver.id,
          approvalReasonId: "11111111-1111-4111-8111-111111111111",
          approvalReasonKind: "REJECTED",
        },
      }),
    ).rejects.toThrow(/foreign key|Activity_approvalReasonId/i);
  });

  it("accepts valid record complying with rules", async () => {
    const { author, approver } = await setupUsers();
    const reason = await createApprovalReason("CHANGES_REQUESTED");

    const record = await testDb.activity.create({
      data: {
        ...baseActivity(author),
        approvalStatus: "CHANGES_REQUESTED",
        approverId: approver.id,
        approvalReasonId: reason.id,
        approvalReasonKind: "CHANGES_REQUESTED",
        approvalReasonNote: "Add details.",
      },
    });

    expect(record.approvalStatus).toBe("CHANGES_REQUESTED");
  });

  it("rejected record must have an approver", async () => {
    const { author } = await setupUsers();
    const reason = await createApprovalReason("REJECTED");

    await expect(
      testDb.activity.create({
        data: {
          ...baseActivity(author),
          approvalStatus: "REJECTED",
          approverId: null,
          approvalReasonId: reason.id,
          approvalReasonKind: "REJECTED",
        },
      }),
    ).rejects.toThrow(/Activity_approver_required_in_approval/);
  });
});
