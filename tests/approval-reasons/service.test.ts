import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createReason,
  listActiveReasons,
  listAllReasons,
  setReasonActive,
  updateReason,
} from "@/server/approval-reasons/service";
import { AUDIT_ACTIONS } from "@/server/audit/log";

import { createApprovalReason, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Approval decision reason catalog (product owner decision, 2026-08-19).
//
// Free text cannot be reported on; categories are managed by system admin.
// No physical deletion, only deactivation (§16.6) — past decisions preserve their reason.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function admin() {
  const unit = await createOrgUnit({ name: "Company", type: "Root" });
  return createUser(unit.id, { fullName: "System Admin", isSystemAdmin: true });
}

describe("catalog management", () => {
  it("creates reason and writes audit log", async () => {
    const me = await admin();

    const result = await createReason(
      testDb,
      { kind: "REJECTED", label: "Duplicate entry", sortOrder: 20 },
      me.id,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reason.label).toBe("Duplicate entry");

    const log = await testDb.auditLog.findFirst({
      where: {
        objectId: result.reason.id,
        action: AUDIT_ACTIONS.approvalReasonCreated,
      },
    });
    expect(log).not.toBeNull();
  });

  it("cannot add identical label under same kind twice", async () => {
    const me = await admin();
    await createReason(testDb, { kind: "REJECTED", label: "Duplicate", sortOrder: 0 }, me.id);

    const result = await createReason(
      testDb,
      { kind: "REJECTED", label: "Duplicate", sortOrder: 0 },
      me.id,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("duplicate_label");
  });

  it("permits same label under different kind", async () => {
    const me = await admin();
    await createReason(testDb, { kind: "REJECTED", label: "Other", sortOrder: 0 }, me.id);

    const result = await createReason(
      testDb,
      { kind: "CHANGES_REQUESTED", label: "Other", sortOrder: 0 },
      me.id,
    );

    expect(result.ok).toBe(true);
  });

  it("updates label and sort order; old version preserved in audit log", async () => {
    const me = await admin();
    const reason = await createApprovalReason("REJECTED", "Misspelling");

    const result = await updateReason(
      testDb,
      { id: reason.id, label: "Corrected spelling", sortOrder: 5 },
      me.id,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reason.label).toBe("Corrected spelling");

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { objectId: reason.id, action: AUDIT_ACTIONS.approvalReasonUpdated },
    });
    // When label changes past records reflect it; logging prior state enables auditability.
    expect(JSON.stringify(log.detail)).toContain("Misspelling");
  });
});

describe("deactivation", () => {
  it("deactivated reason is hidden in decision modal but preserved in catalog", async () => {
    const me = await admin();
    const remaining = await createApprovalReason("REJECTED", "Remaining");
    const deactivated = await createApprovalReason("REJECTED", "Deactivated");

    await setReasonActive(testDb, deactivated.id, false, me.id);

    const activeReasons = await listActiveReasons(testDb, "REJECTED");
    expect(activeReasons.map((r) => r.id)).toEqual([remaining.id]);

    // Not deleted (§16.6).
    expect((await listAllReasons(testDb)).length).toBe(2);
  });

  it("cannot deactivate the last active reason of a kind", async () => {
    const me = await admin();
    const soleReason = await createApprovalReason("REJECTED", "Sole reason");

    const result = await setReasonActive(testDb, soleReason.id, false, me.id);

    // Empty catalog would render decisions impossible to submit.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("last_active_reason");

    const updated = await testDb.approvalReason.findUniqueOrThrow({
      where: { id: soleReason.id },
    });
    expect(updated.isActive).toBe(true);
  });

  it("active reasons in another kind do not satisfy constraint", async () => {
    const me = await admin();
    await createApprovalReason("CHANGES_REQUESTED", "Revision reason");
    const soleRejection = await createApprovalReason("REJECTED", "Sole rejection reason");

    const result = await setReasonActive(testDb, soleRejection.id, false, me.id);

    expect(result.ok).toBe(false);
  });

  it("deactivated reason can be reactivated", async () => {
    const me = await admin();
    await createApprovalReason("REJECTED", "Remaining");
    const deactivated = await createApprovalReason("REJECTED", "Deactivated");
    await setReasonActive(testDb, deactivated.id, false, me.id);

    const result = await setReasonActive(testDb, deactivated.id, true, me.id);

    expect(result.ok).toBe(true);
    expect((await listActiveReasons(testDb, "REJECTED")).length).toBe(2);
  });

  it("orders by sortOrder value", async () => {
    await testDb.approvalReason.createMany({
      data: [
        { kind: "REJECTED", label: "Later", sortOrder: 90 },
        { kind: "REJECTED", label: "Earlier", sortOrder: 10 },
      ],
    });

    const list = await listActiveReasons(testDb, "REJECTED");

    expect(list.map((r) => r.label)).toEqual(["Earlier", "Later"]);
  });
});

describe("in-use reasons cannot be deleted", () => {
  it("reason linked to an activity is protected by database", async () => {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const author = await createUser(unit.id, { fullName: "Author" });
    const approver = await createUser(unit.id, { fullName: "Approver" });
    const reason = await createApprovalReason("REJECTED", "In use");

    await testDb.activity.create({
      data: {
        authorId: author.id,
        authorOrgUnitId: unit.id,
        activityDate: new Date("2026-08-18T00:00:00.000Z"),
        title: "Record",
        description: "content",
        approvalStatus: "REJECTED",
        approverId: approver.id,
        approvalReasonId: reason.id,
        approvalReasonKind: "REJECTED",
      },
    });

    // Physical deletion forbidden (§16.6); foreign key prevents deletion.
    await expect(
      testDb.approvalReason.delete({ where: { id: reason.id } }),
    ).rejects.toThrow();
  });
});
