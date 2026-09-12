import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countOwnActivities, listOwnActivities } from "@/server/activities/read";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// "My Activities" screen filters (Task 11.3).
//
// Screen filters: period, approval status, open questions, and target department.
//
// **Filters cannot broaden scope.** Queries always start with visibility filter and
// `authorId` condition; fields here only narrow the result set (§8.4).

const NOW = new Date("2026-08-19T09:00:00.000Z"); // Wednesday

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupUsers() {
  const root = await createOrgUnit({ name: "Headquarters", type: "Root" });
  const moldShop = await createOrgUnit({ name: "Tooling Workshop", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const worker = await createUser(moldShop.id, { fullName: "Tooling Worker" });
  const otherUser = await createUser(moldShop.id, { fullName: "Other Person" });

  return { root, moldShop, planning, worker, otherUser };
}

const dayDate = (g: string) => new Date(`${g}T00:00:00.000Z`);

describe("period filter", () => {
  it("does not return previous week's record when this week is selected", async () => {
    const { worker } = await setupUsers();

    await createActivity(worker, { title: "This week", activityDate: dayDate("2026-08-18") });
    await createActivity(worker, { title: "Last week", activityDate: dayDate("2026-08-14") });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const result = await listOwnActivities(testDb, viewer, {
      period: "week",
      now: NOW,
    });

    expect(result.map((a) => a.title)).toEqual(["This week"]);
  });

  it("does not set period boundary when all is selected", async () => {
    const { worker } = await setupUsers();

    await createActivity(worker, { title: "This week", activityDate: dayDate("2026-08-18") });
    await createActivity(worker, { title: "Last week", activityDate: dayDate("2026-08-14") });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const result = await listOwnActivities(testDb, viewer, { period: "all", now: NOW });

    expect(result).toHaveLength(2);
  });
});

describe("status filter", () => {
  it("only returns records in selected approval status", async () => {
    const { worker } = await setupUsers();

    await createActivity(worker, { title: "Approved", approvalStatus: "APPROVED" });
    await createActivity(worker, { title: "Cancelled", approvalStatus: "CANCELLED" });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const result = await listOwnActivities(testDb, viewer, {
      period: "all",
      now: NOW,
      status: "CANCELLED",
    });

    expect(result.map((a) => a.title)).toEqual(["Cancelled"]);
  });
});

describe("open question filter", () => {
  it("only returns own record with open question", async () => {
    const { worker, otherUser } = await setupUsers();
    const withQuestion = await createActivity(worker, { title: "With question" });
    const withoutQuestion = await createActivity(worker, { title: "Without question" });

    await testDb.conversation.create({
      data: {
        activityId: withQuestion.id,
        askerId: otherUser.id,
        responsibleId: worker.id,
        status: "OPEN",
      },
    });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const filters = { period: "all" as const, now: NOW, openQuestions: true };
    const [activities, count] = await Promise.all([
      listOwnActivities(testDb, viewer, filters),
      countOwnActivities(testDb, viewer, filters),
    ]);

    expect(activities.map((activity) => activity.id)).toEqual([withQuestion.id]);
    expect(activities.map((activity) => activity.id)).not.toContain(withoutQuestion.id);
    expect(count).toBe(activities.length);
  });

  it("question asked by user is not counted as awaiting answer in own archive", async () => {
    const { worker, otherUser } = await setupUsers();
    const ownQuestion = await createActivity(worker, { title: "Own question" });

    await testDb.conversation.create({
      data: {
        activityId: ownQuestion.id,
        askerId: worker.id,
        responsibleId: otherUser.id,
        status: "OPEN",
      },
    });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const filters = { period: "all" as const, now: NOW, openQuestions: true };
    const [activities, count] = await Promise.all([
      listOwnActivities(testDb, viewer, filters),
      countOwnActivities(testDb, viewer, filters),
    ]);

    expect(activities).toHaveLength(0);
    expect(count).toBe(0);
  });
});

describe("target department filter", () => {
  it("only returns records where that department is targeted", async () => {
    const { moldShop, planning, worker } = await setupUsers();

    const toPlanning = await createActivity(worker, { title: "To planning" });
    const toTooling = await createActivity(worker, { title: "To tooling" });
    await testDb.activityTargetDept.createMany({
      data: [
        { activityId: toPlanning.id, orgUnitId: planning.id },
        { activityId: toTooling.id, orgUnitId: moldShop.id },
      ],
    });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const result = await listOwnActivities(testDb, viewer, {
      period: "all",
      now: NOW,
      targetOrgUnitId: planning.id,
    });

    expect(result.map((a) => a.title)).toEqual(["To planning"]);
  });
});

describe("counter and list use same filter", () => {
  it("counter also applies narrowing filter", async () => {
    const { worker } = await setupUsers();

    await createActivity(worker, { title: "Approved", approvalStatus: "APPROVED" });
    await createActivity(worker, { title: "Cancelled", approvalStatus: "CANCELLED" });

    const viewer = { id: worker.id, isSystemAdmin: false };

    expect(
      await countOwnActivities(testDb, viewer, {
        period: "all",
        now: NOW,
        status: "CANCELLED",
      }),
    ).toBe(1);
  });
});

describe("filters do not expand scope", () => {
  // No filter combination can ever include another user's activity in "My Activities".
  it("never returns another person's record with any filter", async () => {
    const { worker, otherUser } = await setupUsers();

    await createActivity(otherUser, { title: "Other person's record" });
    await createActivity(worker, { title: "Own record" });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const result = await listOwnActivities(testDb, viewer, { period: "all", now: NOW });

    expect(result.map((a) => a.title)).toEqual(["Own record"]);
  });
});
