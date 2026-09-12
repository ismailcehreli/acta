import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cancelActivity } from "@/server/activities/cancel";
import { AUDIT_ACTIONS } from "@/server/audit/log";
import { askQuestion } from "@/server/conversations/service";
import { listFollowUps } from "@/server/follow-ups/read";
import {
  closeFollowUp,
  openFollowUp,
  reopenFollowUp,
  transferFollowUp,
} from "@/server/follow-ups/service";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Follow-up items tests.
// Invariants:
//   1. Visibility — an item is never visible if the underlying activity is not visible.
//   2. Closing note is required.
//   3. An activity has at most one open follow-up item at any time.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const executive = await createOrgUnit({ name: "Executive Management", parentId: root.id });
  const tooling = await createOrgUnit({ name: "Tooling", parentId: executive.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: executive.id });

  const ceo = await createUser(executive.id, {
    fullName: "Chief Executive",
    isUnitManager: true,
  });
  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const employee = await createUser(tooling.id, { fullName: "Worker" });
  const peerManager = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });

  return { ceo, manager, employee, peerManager };
}

const viewer = (id: string) => ({ id, isSystemAdmin: false });

async function createApprovedActivity(
  author: { id: string; orgUnitId: string },
  title = "Tooling maintenance",
) {
  return createActivity(author, { title, approvalStatus: "APPROVED" });
}

describe("opening follow-ups", () => {
  it("author can open follow-up and becomes its owner", async () => {
    const { employee } = await setupCompany();
    const activity = await createApprovedActivity(employee);

    const result = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id, nextStep: "Notify when parts arrive" },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.ownerId).toBe(employee.id);
    expect(result.item.nextStep).toBe("Notify when parts arrive");

    const events = await testDb.followUpItemEvent.findMany({
      where: { followUpId: result.item.id },
    });
    expect(events.map((e) => e.kind)).toEqual(["OPENED"]);
  });

  it("user who cannot view activity cannot open follow-up", async () => {
    const { employee, peerManager } = await setupCompany();
    const activity = await createApprovedActivity(employee);

    const result = await openFollowUp(
      testDb,
      viewer(peerManager.id),
      { activityId: activity.id },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("activity_not_found");
  });

  it("an activity cannot have two open follow-ups concurrently", async () => {
    const { employee } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    await openFollowUp(testDb, viewer(employee.id), { activityId: activity.id }, NOW);

    const second = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe("already_open");
  });

  it("cannot open follow-up on cancelled activity", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    await cancelActivity(
      testDb,
      { id: employee.id, isSystemAdmin: false },
      activity.id,
      "Entered incorrectly.",
      NOW,
    );

    const result = await openFollowUp(
      testDb,
      viewer(manager.id),
      { activityId: activity.id },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("activity_closed");
  });
});

describe("closing follow-ups", () => {
  it("cannot close without a closing note", async () => {
    const { employee } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("Setup failed");

    const result = await closeFollowUp(testDb, viewer(employee.id), opened.item.id, "   ", NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("note_required");
  });

  it("owner closes with note; note is preserved", async () => {
    const { employee } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("Setup failed");

    const result = await closeFollowUp(
      testDb,
      viewer(employee.id),
      opened.item.id,
      "Parts received and installed on August 22.",
      NOW,
    );

    expect(result.ok).toBe(true);
    const record = await testDb.followUpItem.findUniqueOrThrow({
      where: { id: opened.item.id },
    });
    expect(record.status).toBe("CLOSED");
    expect(record.closingNote).toContain("August 22");
    expect(record.closedById).toBe(employee.id);
  });

  it("owner's manager can also close the item", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("Setup failed");

    const result = await closeFollowUp(
      testDb,
      viewer(manager.id),
      opened.item.id,
      "Resolved at manager level.",
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("unrelated user cannot close the item", async () => {
    const { employee, peerManager } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("Setup failed");

    const result = await closeFollowUp(
      testDb,
      viewer(peerManager.id),
      opened.item.id,
      "Closing attempt.",
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_allowed");
  });

  it("closed item can be reopened with a reason note", async () => {
    const { employee } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("Setup failed");
    await closeFollowUp(testDb, viewer(employee.id), opened.item.id, "Closed.", NOW);

    const result = await reopenFollowUp(
      testDb,
      viewer(employee.id),
      opened.item.id,
      "Defect resurfaced.",
      NOW,
    );

    expect(result.ok).toBe(true);
    const events = await testDb.followUpItemEvent.findMany({
      where: { followUpId: opened.item.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.kind)).toEqual([
      "OPENED",
      "CLOSED",
      "REOPENED",
    ]);
  });
});

describe("transferring ownership", () => {
  it("cannot transfer to user who cannot view the activity", async () => {
    const { employee, peerManager } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("Setup failed");

    const result = await transferFollowUp(
      testDb,
      viewer(employee.id),
      opened.item.id,
      peerManager.id,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("owner_cannot_see");
  });

  it("transfers to eligible user and records audit trail", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("Setup failed");

    const result = await transferFollowUp(
      testDb,
      viewer(employee.id),
      opened.item.id,
      manager.id,
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.ownerId).toBe(manager.id);

    const log = await testDb.auditLog.findFirst({
      where: {
        objectId: opened.item.id,
        action: AUDIT_ACTIONS.followUpTransferred,
      },
    });
    expect(log).not.toBeNull();
  });
});

describe("recent movement updates", () => {
  it("resets idle timer when question is asked on activity", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("Setup failed");

    const later = new Date("2026-08-25T09:00:00.000Z");
    await askQuestion(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      { activityId: activity.id, text: "What is the status?" },
      later,
    );

    const record = await testDb.followUpItem.findUniqueOrThrow({
      where: { id: opened.item.id },
    });
    expect(record.lastMovedAt.toISOString()).toBe(later.toISOString());
  });
});

describe("cancellation side effect", () => {
  it("open item is automatically closed when activity is cancelled", async () => {
    const { employee } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("Setup failed");

    await cancelActivity(
      testDb,
      { id: employee.id, isSystemAdmin: false },
      activity.id,
      "Entered incorrectly.",
      NOW,
    );

    const record = await testDb.followUpItem.findUniqueOrThrow({
      where: { id: opened.item.id },
    });
    expect(record.status).toBe("CLOSED");
    expect(record.closingNote).toBe("Activity cancelled.");
  });
});

describe("listing and visibility", () => {
  it("item is not listed for user who cannot view activity", async () => {
    const { employee, peerManager } = await setupCompany();
    const activity = await createApprovedActivity(employee, "Confidential task");
    await openFollowUp(testDb, viewer(employee.id), { activityId: activity.id }, NOW);

    const list = await listFollowUps(testDb, viewer(peerManager.id), NOW);

    expect(list.items).toHaveLength(0);
  });

  it("item appears in manager's list", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    await openFollowUp(testDb, viewer(employee.id), { activityId: activity.id }, NOW);

    const list = await listFollowUps(testDb, viewer(manager.id), NOW);

    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.ownerId).not.toBe(manager.id);
  });

  it("flags stale items with idle business days", async () => {
    const { employee } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      new Date("2026-08-05T09:00:00.000Z"),
    );
    if (!opened.ok) throw new Error("Setup failed");

    const list = await listFollowUps(testDb, viewer(employee.id), NOW);

    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.stale).toBe(true);
    expect(list.items[0]?.idleBusinessDays).toBeGreaterThanOrEqual(5);
  });

  it("closed item is excluded from active list", async () => {
    const { employee } = await setupCompany();
    const activity = await createApprovedActivity(employee);
    const opened = await openFollowUp(
      testDb,
      viewer(employee.id),
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("Setup failed");
    await closeFollowUp(testDb, viewer(employee.id), opened.item.id, "Done.", NOW);

    const list = await listFollowUps(testDb, viewer(employee.id), NOW);

    expect(list.items).toHaveLength(0);
  });
});
