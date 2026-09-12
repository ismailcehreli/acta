import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity } from "@/server/activities/write";
import { listOwnActivities } from "@/server/activities/read";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Activity sequence numbering.
// Generated via database sequence to guarantee unique and monotonically increasing numbers.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const tooling = await createOrgUnit({ name: "Tooling Department", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning Department", parentId: root.id });

  const toolingUser = await createUser(tooling.id, { fullName: "Tooling Specialist" });
  const planningUser = await createUser(planning.id, { fullName: "Planner Specialist" });

  return { toolingUser, planningUser };
}

async function writeActivity(user: { id: string; orgUnitId: string }, title: string) {
  const result = await createActivity(
    testDb,
    { id: user.id, orgUnitId: user.orgUnitId, requiresApproval: false },
    {
      activityDate: "2026-08-19",
      title,
      description: "Description.",
      targetDepartmentIds: [],
    },
    NOW,
  );
  if (!result.ok) throw new Error(`setup failed: ${result.message}`);
  return result.activity;
}

describe("activity sequence number", () => {
  it("assigns sequential numbers to activities", async () => {
    const { toolingUser } = await setupCompany();

    const first = await writeActivity(toolingUser, "First");
    const second = await writeActivity(toolingUser, "Second");

    expect(first.activityNo).toBeGreaterThan(0);
    expect(second.activityNo).toBe(first.activityNo + 1);
  });

  it("maintains sequence across departments", async () => {
    const { toolingUser, planningUser } = await setupCompany();

    const first = await writeActivity(toolingUser, "Tooling task");
    const second = await writeActivity(planningUser, "Planning task");
    const third = await writeActivity(toolingUser, "Tooling task 2");

    expect([first.activityNo, second.activityNo, third.activityNo]).toEqual([
      first.activityNo,
      first.activityNo + 1,
      first.activityNo + 2,
    ]);
  });

  it("enforces unique constraint on activity number", async () => {
    const { toolingUser } = await setupCompany();
    const record = await writeActivity(toolingUser, "Single");
    const other = await writeActivity(toolingUser, "Other");

    await expect(
      testDb.activity.update({
        where: { id: other.id },
        data: { activityNo: record.activityNo },
      }),
    ).rejects.toThrow();
  });

  it("prevents collisions across concurrent writes", async () => {
    const { toolingUser, planningUser } = await setupCompany();

    const results = await Promise.all([
      writeActivity(toolingUser, "Concurrent 1"),
      writeActivity(planningUser, "Concurrent 2"),
      writeActivity(toolingUser, "Concurrent 3"),
    ]);

    const numbers = results.map((k) => k.activityNo);
    expect(new Set(numbers).size).toBe(3);
  });

  it("includes activity number in list responses", async () => {
    const { toolingUser } = await setupCompany();
    const record = await writeActivity(toolingUser, "Listed task");

    const list = await listOwnActivities(
      testDb,
      { id: toolingUser.id, isSystemAdmin: false },
      { period: "all", now: new Date() },
    );

    expect(list[0].activityNo).toBe(record.activityNo);
  });

  it("preserves activity number when cancelled", async () => {
    const { toolingUser } = await setupCompany();
    const record = await writeActivity(toolingUser, "Cancelled task");

    await testDb.activity.update({
      where: { id: record.id },
      data: { approvalStatus: "CANCELLED" },
    });

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: record.id },
    });

    expect(stored.activityNo).toBe(record.activityNo);
  });
});
