import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, updateActivity } from "@/server/activities/write";
import { SETTING_KEYS } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §5.5: approved activity can be edited within a short window after creation
// and **if no one has read it yet**. Afterwards it cannot be changed — higher
// tiers may have read it and subsequent edits destroy trust (Principle 5).

const NOW = new Date("2026-08-17T09:00:00.000Z");
const TODAY = "2026-08-17";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupWithActivity() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const department = await createOrgUnit({
    name: "Tooling Workshop",
    type: "Department",
    parentId: root.id,
  });
  const user = await createUser(department.id);
  const reader = await createUser(root.id);
  const author = { id: user.id, orgUnitId: department.id, requiresApproval: false };

  const created = await createActivity(
    testDb,
    author,
    {
      activityDate: TODAY,
      title: "Initial title",
      description: "Initial description",
      targetDepartmentIds: [department.id],
    },
    NOW,
  );

  if (!created.ok) throw new Error("setup failed");

  return { root, department, author, reader, activity: created.activity };
}

function editInput(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    activityDate: TODAY,
    title: "Edited title",
    description: "Edited description",
    targetDepartmentIds: [] as string[],
    ...overrides,
  };
}

describe("edit window", () => {
  it("can be edited within 15 minutes if unread", async () => {
    const { author, department, activity } = await setupWithActivity();
    const fourteenMinutesLater = new Date(NOW.getTime() + 14 * 60_000);

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      fourteenMinutesLater,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.title).toBe("Edited title");
  });

  it("cannot be edited after 15 minutes", async () => {
    const { author, department, activity } = await setupWithActivity();
    const sixteenMinutesLater = new Date(NOW.getTime() + 16 * 60_000);

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      sixteenMinutesLater,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("window_closed");
  });

  it("reads window duration from system setting", async () => {
    const { author, department, activity } = await setupWithActivity();
    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.editWindowMinutes,
        value: "60",
        description: "Edit window (minutes)",
      },
    });

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 45 * 60_000),
    );

    expect(result.ok).toBe(true);
  });
});

describe("read receipt closes edit window (§10 link)", () => {
  it("cannot be edited within window if read by another user", async () => {
    const { author, department, reader, activity } = await setupWithActivity();

    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: reader.id },
    });

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_read");
  });

  it("author reading own activity does not close edit window", async () => {
    const { author, department, activity } = await setupWithActivity();

    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: author.id },
    });

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(true);
  });
});

describe("edit authorization", () => {
  it("cannot edit another user's activity", async () => {
    const { department, activity } = await setupWithActivity();
    const stranger = await createUser(department.id);

    const result = await updateActivity(
      testDb,
      stranger.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Returns "not_found" externally: returning "not yours" leaks record existence
    // (audit 2026-08-18, finding 1).
    expect(result.error).toBe("not_found");
    expect(result.message).toBe("Activity not found.");

    // Verify stored content was not altered.
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.title).toBe("Initial title");
  });

  it("cannot edit cancelled activity", async () => {
    const { author, department, activity } = await setupWithActivity();
    await testDb.activity.update({
      where: { id: activity.id },
      data: { approvalStatus: "CANCELLED" },
    });

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("cancelled");
  });
});

describe("revision history (§5.5)", () => {
  it("creates new revision for each edit and preserves prior content", async () => {
    const { author, department, activity } = await setupWithActivity();

    await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 60_000),
    );

    const revisions = await testDb.activityRevision.findMany({
      where: { activityId: activity.id },
      orderBy: { revisionNo: "asc" },
    });

    expect(revisions).toHaveLength(2);
    expect(revisions[0].title).toBe("Initial title");
    expect(revisions[1].title).toBe("Edited title");

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.currentRevisionNo).toBe(2);
  });

  it("freezes recipient list snapshot when target departments change", async () => {
    const { author, department, root, activity } = await setupWithActivity();
    const otherDepartment = await createOrgUnit({ parentId: root.id });

    await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, {
        targetDepartmentIds: [otherDepartment.id],
      }),
      new Date(NOW.getTime() + 60_000),
    );

    const revisions = await testDb.activityRevision.findMany({
      where: { activityId: activity.id },
      orderBy: { revisionNo: "asc" },
    });

    expect(revisions[0].targetOrgUnitIds).toEqual([department.id]);
    expect(revisions[1].targetOrgUnitIds).toEqual([otherDepartment.id]);

    // Current target list must also be updated.
    const current = await testDb.activityTargetDept.findMany({
      where: { activityId: activity.id },
    });
    expect(current.map((row) => row.orgUnitId)).toEqual([otherDepartment.id]);
  });

  it("revision records are immutable and cannot be deleted", async () => {
    const { author, activity } = await setupWithActivity();

    const revision = await testDb.activityRevision.findFirstOrThrow({
      where: { activityId: activity.id },
    });

    await expect(
      testDb.activityRevision.delete({ where: { id: revision.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);

    expect(author.id).toBeTruthy();
  });
});
