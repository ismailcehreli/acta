import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cancelActivity } from "@/server/activities/cancel";
import { createActivity } from "@/server/activities/write";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Activity cancellation rules.
// Cancellation is available to the author or any manager above them in hierarchy.
// Reason is mandatory, rows are not physically deleted, and cancellations cannot be undone.

const NOW = new Date("2026-08-17T09:00:00.000Z");
const REASON = "Logged to incorrect shift, corrected entry will be filed.";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/**
 * Three-tier tree: General Management → Directorate → Tooling Department.
 * Author is in Tooling; director and general manager are in upper chain; peer is
 * manager of a sibling department.
 */
async function setup() {
  const root = await createOrgUnit({ name: "General Management", type: "ROOT" });
  const directorate = await createOrgUnit({
    name: "Production Directorate",
    type: "DIRECTORATE",
    parentId: root.id,
  });
  const department = await createOrgUnit({
    name: "Tooling Department",
    type: "DEPARTMENT",
    parentId: directorate.id,
  });
  const peerDepartment = await createOrgUnit({
    name: "Planning Department",
    type: "DEPARTMENT",
    parentId: directorate.id,
  });

  const generalManager = await createUser(root.id, { isUnitManager: true });
  const director = await createUser(directorate.id, { isUnitManager: true });
  const author = await createUser(department.id, { isUnitManager: true });
  const peer = await createUser(peerDepartment.id, { isUnitManager: true });
  const teammate = await createUser(department.id);

  const created = await createActivity(
    testDb,
    { id: author.id, orgUnitId: department.id, requiresApproval: false },
    {
      activityDate: "2026-08-17",
      title: "Tooling maintenance",
      description: "Crack repaired.",
      targetDepartmentIds: [department.id],
    },
    NOW,
  );
  if (!created.ok) throw new Error(`setup failed: ${created.error}`);

  return {
    root,
    directorate,
    department,
    generalManager,
    director,
    author,
    peer,
    teammate,
    activity: created.activity,
  };
}

describe("cancellation authorization", () => {
  it("allows author to cancel their own activity", async () => {
    const { author, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("allows direct manager to cancel activity", async () => {
    const { director, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: director.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("allows higher manager in chain to cancel activity", async () => {
    const { generalManager, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: generalManager.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("prevents peer manager from cancelling activity", async () => {
    const { peer, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: peer.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_allowed");

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("APPROVED");
  });

  it("prevents subordinate in same unit from cancelling activity", async () => {
    const { teammate, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: teammate.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_allowed");
  });
});

describe("mandatory cancellation reason", () => {
  it("rejects cancellation with empty reason", async () => {
    const { author, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      "   ",
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("reason_required");
  });

  it("records cancellation reason in database", async () => {
    const { author, activity } = await setup();

    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    const record = await testDb.cancellationRecord.findUniqueOrThrow({
      where: { activityId: activity.id },
    });
    expect(record.reason).toBe(REASON);
    expect(record.cancelledById).toBe(author.id);
  });
});

describe("cancellation consequences", () => {
  it("transitions activity to cancelled state without deleting record", async () => {
    const { author, activity } = await setup();

    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("CANCELLED");
    expect(stored.title).toBe("Tooling maintenance");
  });

  it("enforces immutable cancellation status at database level", async () => {
    const { author, activity } = await setup();
    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    await expect(
      testDb.activity.update({
        where: { id: activity.id },
        data: { approvalStatus: "APPROVED" },
      }),
    ).rejects.toThrow(/ACTIVITY_INVALID_STATUS_TRANSITION/);
  });

  it("rejects duplicate cancellation attempts", async () => {
    const { author, activity } = await setup();
    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_cancelled");
  });

  it("returns not_found when attempting to cancel non-existent activity", async () => {
    const { author } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      "00000000-0000-0000-0000-000000000000",
      REASON,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });
});

describe("closing open conversations upon cancellation", () => {
  async function withOpenConversation() {
    const context = await setup();
    const conversation = await testDb.conversation.create({
      data: {
        activityId: context.activity.id,
        askerId: context.director.id,
        responsibleId: context.author.id,
      },
    });
    return { ...context, conversation };
  }

  it("closes open conversations with CANCELLED_ACTIVITY close type", async () => {
    const { author, activity, conversation } = await withOpenConversation();

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.closedConversationCount).toBe(1);

    const stored = await testDb.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(stored.status).toBe("CLOSED");
    expect(stored.closeType).toBe("CANCELLED_ACTIVITY");
    expect(stored.closeReason).toBeNull();
    expect(stored.closedById).toBe(author.id);
  });

  it("enqueues notification to the other party of the conversation", async () => {
    const { author, director, activity } = await withOpenConversation();

    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    const notifications = await testDb.notificationQueue.findMany();

    // Actor does not receive notification for their own action.
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe(director.id);
    expect(notifications[0].eventType).toBe("activity_cancelled");
    expect(notifications[0].status).toBe("PENDING");
  });

  it("does not re-close already closed conversations or enqueue extra notifications", async () => {
    const { author, activity, conversation } = await withOpenConversation();
    await testDb.conversation.update({
      where: { id: conversation.id },
      data: { status: "CLOSED", closedAt: NOW, closedById: author.id },
    });

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.closedConversationCount).toBe(0);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });
});

describe("cancellation is only defined for approved activities", () => {
  it("rejects cancelling draft activity with clear error", async () => {
    const { author, department } = await setup();
    const draft = await testDb.activity.create({
      data: {
        authorId: author.id,
        authorOrgUnitId: department.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Draft activity",
        description: "Description",
        approvalStatus: "DRAFT",
      },
    });

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      draft.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_cancellable");
  });

  it("accepts short reason without minimum length constraint", async () => {
    const { author, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      "Duplicate",
      NOW,
    );

    expect(result.ok).toBe(true);
  });
});

describe("concurrent cancellations", () => {
  it("only allows one of two concurrent cancellations to succeed", async () => {
    const { author, activity } = await setup();
    const actor = { id: author.id, isSystemAdmin: false };

    const [first, second] = await Promise.all([
      cancelActivity(testDb, actor, activity.id, "First reason.", NOW),
      cancelActivity(testDb, actor, activity.id, "Second reason.", NOW),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);

    expect(await testDb.cancellationRecord.count()).toBe(1);
  });
});
