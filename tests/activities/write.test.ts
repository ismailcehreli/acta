import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity } from "@/server/activities/write";
import { SETTING_KEYS } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §5: activity creation, editing, and revisions. Time is mocked in all tests:
// tests relying on wall clock fail around midnight.

const NOW = new Date("2026-08-17T09:00:00.000Z");
const TODAY = "2026-08-17";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setup() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const department = await createOrgUnit({
    name: "Tooling Workshop",
    type: "Department",
    parentId: root.id,
  });
  const other = await createOrgUnit({
    name: "Planning",
    type: "Department",
    parentId: root.id,
  });
  const user = await createUser(department.id);

  return {
    root,
    department,
    other,
    author: {
      id: user.id,
      orgUnitId: department.id,
      requiresApproval: false,
    },
  };
}

function input(overrides: Partial<Parameters<typeof createActivity>[2]> = {}) {
  return {
    activityDate: TODAY,
    title: "Tooling maintenance completed",
    description: "Crack detected, repair scheduled.",
    targetDepartmentIds: [] as string[],
    ...overrides,
  };
}

describe("activity creation", () => {
  it("creates activity directly as approved when unit does not require approval (§5.4)", async () => {
    const { author, department } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.approvalStatus).toBe("APPROVED");
  });

  it("creates activity in pending approval status when unit requires approval", async () => {
    const { author, department, root } = await setup();
    const manager = await createUser(root.id, {
      fullName: "General Manager",
      isUnitManager: true,
    });

    const result = await createActivity(
      testDb,
      { ...author, requiresApproval: true },
      input({ targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.approvalStatus).toBe("PENDING_APPROVAL");
    expect(result.activity.approverId).toBe(manager.id);
  });

  it("creates unit manager activity directly as approved even in units requiring approval", async () => {
    // Unit managers do not require approval for their own activities.
    const { department, root } = await setup();
    await createUser(root.id, { fullName: "General Manager", isUnitManager: true });
    const manager = await createUser(department.id, {
      fullName: "Tooling Manager",
      isUnitManager: true,
    });

    const result = await createActivity(
      testDb,
      { id: manager.id, orgUnitId: department.id, requiresApproval: true },
      input({ targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.approvalStatus).toBe("APPROVED");
    expect(result.activity.approverId).toBeNull();

    const rounds = await testDb.approvalRound.count({
      where: { activityId: result.activity.id },
    });
    expect(rounds).toBe(0);

    const approvers = await testDb.activityApprover.count({
      where: { activityId: result.activity.id },
    });
    expect(approvers).toBe(0);
  });

  it("freezes author org unit at time of creation (§4.6)", async () => {
    const { author, department, root } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: [department.id] }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Even if user transfers units later, activity retains unit it was authored under.
    await testDb.user.update({
      where: { id: author.id },
      data: { orgUnitId: root.id },
    });

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: result.activity.id },
    });
    expect(stored.authorOrgUnitId).toBe(department.id);
  });

  it("initial creation produces first revision", async () => {
    const { author, department } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: [department.id] }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const revisions = await testDb.activityRevision.findMany({
      where: { activityId: result.activity.id },
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revisionNo).toBe(1);
    expect(revisions[0].targetOrgUnitIds).toEqual([department.id]);
  });
});

describe("target department rules (§5.3)", () => {
  it("allows selecting up to five departments", async () => {
    const { author, root } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const unit = await createOrgUnit({ parentId: root.id });
      ids.push(unit.id);
    }

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: ids }),
      NOW,
    );

    expect(result.ok).toBe(true);
    const count = await testDb.activityTargetDept.count();
    expect(count).toBe(5);
  });

  it("sixth department is rejected by database constraint", async () => {
    const { author, root } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const unit = await createOrgUnit({ parentId: root.id });
      ids.push(unit.id);
    }

    // Database constraint holds even if schema validation is bypassed.
    await expect(
      createActivity(testDb, author, input({ targetDepartmentIds: ids }), NOW),
    ).rejects.toThrow(/ACTIVITY_TARGET_LIMIT/);
  });

  it("peer department can also be selected as target", async () => {
    const { author, other } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: [other.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("rejects inactive department as target", async () => {
    const { author, root } = await setup();
    const passive = await createOrgUnit({ parentId: root.id });
    await testDb.orgUnit.update({
      where: { id: passive.id },
      data: { isActive: false },
    });

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: [passive.id] }),
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_department");
  });

  it("rejects non-existent department as target", async () => {
    const { author } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({
        targetDepartmentIds: ["00000000-0000-0000-0000-000000000000"],
      }),
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unknown_department");
  });
});

describe("retroactive entry limits (§5.6)", () => {
  it("permits yesterday's activity (default 1 day)", async () => {
    const { author, department } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ activityDate: "2026-08-16", targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("rejects activity from two days ago", async () => {
    const { author, department } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ activityDate: "2026-08-15", targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("date_too_old");
  });

  it("rejects future dates", async () => {
    const { author, department } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ activityDate: "2026-08-18", targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("future_date");
  });

  it("reads boundary from system settings, not hardcoded", async () => {
    const { author, department } = await setup();

    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.retroactiveEntryDays,
        value: "7",
        description: "Retroactive entry window (days)",
      },
    });

    const result = await createActivity(
      testDb,
      author,
      input({ activityDate: "2026-08-12", targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
  });
});
