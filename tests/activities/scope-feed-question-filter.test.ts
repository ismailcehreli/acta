import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  countScopeActivities,
  listScopeActivities,
} from "@/server/activities/scope-feed";
import { subordinateUserIds } from "@/server/authz/visibility";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Scope feed question filter and counter.
// Displays activities requiring response.
// Open questions never expand visibility scope beyond authorization bounds.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Headquarters", type: "ROOT" });
  const moldShop = await createOrgUnit({ name: "Tooling Department", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning Department", parentId: root.id });

  const manager = await createUser(moldShop.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const worker = await createUser(moldShop.id, { fullName: "Tooling Worker" });
  const otherDeptWorker = await createUser(planning.id, { fullName: "Planning Worker" });

  return { root, moldShop, planning, manager, worker, otherDeptWorker };
}

async function openQuestion(activityId: string, askerId: string, responsibleId: string) {
  return testDb.conversation.create({
    data: { activityId, askerId, responsibleId, status: "OPEN" },
  });
}

describe("open question filter", () => {
  it("only returns activities that have open questions requiring answers", async () => {
    const { manager, worker, otherDeptWorker } = await setupCompany();

    const withQuestion = await createActivity(worker, {
      title: "Activity with question",
    });
    const withClosedQuestion = await createActivity(worker, {
      title: "Activity with closed question",
    });
    await createActivity(worker, { title: "Activity without question" });

    await openQuestion(withQuestion.id, otherDeptWorker.id, worker.id);
    await testDb.conversation.create({
      data: {
        activityId: withClosedQuestion.id,
        askerId: otherDeptWorker.id,
        responsibleId: worker.id,
        status: "CLOSED",
        closedById: manager.id,
        closedAt: NOW,
        closeType: "NORMAL",
      },
    });

    const viewer = { id: manager.id, isSystemAdmin: false };
    const subordinates = await subordinateUserIds(testDb, manager.id);

    const result = await listScopeActivities(
      testDb,
      viewer,
      { period: "all", openQuestions: true },
      NOW,
      { subordinates },
    );

    expect(result.items.map((i) => i.title)).toEqual(["Activity with question"]);
  });

  it("applies the identical filter to activity count", async () => {
    const { manager, worker, otherDeptWorker } = await setupCompany();

    const withQuestion = await createActivity(worker, { title: "Has question" });
    await createActivity(worker, { title: "No question" });
    await openQuestion(withQuestion.id, otherDeptWorker.id, worker.id);

    const viewer = { id: manager.id, isSystemAdmin: false };
    const subordinates = await subordinateUserIds(testDb, manager.id);

    expect(
      await countScopeActivities(
        testDb,
        viewer,
        { period: "all", openQuestions: true },
        NOW,
        { subordinates },
      ),
    ).toBe(1);
  });

  it("deduplicates activities with multiple open questions", async () => {
    const { manager, worker, otherDeptWorker } = await setupCompany();

    const withTwoQuestions = await createActivity(worker, { title: "Two questions" });
    await openQuestion(withTwoQuestions.id, otherDeptWorker.id, worker.id);
    await openQuestion(withTwoQuestions.id, otherDeptWorker.id, worker.id);
    await createActivity(worker, { title: "No questions" });

    const viewer = { id: manager.id, isSystemAdmin: false };
    const subordinates = await subordinateUserIds(testDb, manager.id);

    const result = await listScopeActivities(
      testDb,
      viewer,
      { period: "all", openQuestions: true },
      NOW,
      { subordinates },
    );

    expect(result.items).toHaveLength(1);
  });

  it("does not expose out-of-scope activities just because they have open questions", async () => {
    const { manager, worker, otherDeptWorker } = await setupCompany();

    const externalActivity = await createActivity(otherDeptWorker, {
      title: "External unit activity",
    });
    await openQuestion(externalActivity.id, otherDeptWorker.id, otherDeptWorker.id);

    const ownActivity = await createActivity(worker, { title: "Own activity" });
    await openQuestion(ownActivity.id, otherDeptWorker.id, worker.id);
    await createActivity(worker, { title: "In-scope without question" });

    const viewer = { id: manager.id, isSystemAdmin: false };
    const subordinates = await subordinateUserIds(testDb, manager.id);

    const result = await listScopeActivities(
      testDb,
      viewer,
      { period: "all", openQuestions: true },
      NOW,
      { subordinates },
    );

    expect(result.items.map((i) => i.title)).toEqual(["Own activity"]);
  });

  it("excludes questions asked by the user themselves from their answer-needed queue", async () => {
    const { manager, worker } = await setupCompany();
    const selfAsked = await createActivity(worker, { title: "Self asked" });
    await openQuestion(selfAsked.id, manager.id, worker.id);

    const viewer = { id: manager.id, isSystemAdmin: false };
    const subordinates = await subordinateUserIds(testDb, manager.id);
    const filters = { period: "all" as const, openQuestions: true };

    const [list, count] = await Promise.all([
      listScopeActivities(testDb, viewer, filters, NOW, { subordinates }),
      countScopeActivities(testDb, viewer, filters, NOW, { subordinates }),
    ]);

    expect(list.items).toHaveLength(0);
    expect(count).toBe(0);
  });

  it("includes activity once when it has both self-asked and third-party questions", async () => {
    const { manager, worker, otherDeptWorker } = await setupCompany();
    const activity = await createActivity(worker, { title: "Mixed questions" });
    await openQuestion(activity.id, manager.id, worker.id);
    await openQuestion(activity.id, otherDeptWorker.id, worker.id);

    const viewer = { id: manager.id, isSystemAdmin: false };
    const subordinates = await subordinateUserIds(testDb, manager.id);
    const filters = { period: "all" as const, openQuestions: true };

    const [list, count] = await Promise.all([
      listScopeActivities(testDb, viewer, filters, NOW, { subordinates }),
      countScopeActivities(testDb, viewer, filters, NOW, { subordinates }),
    ]);

    expect(list.items.map((item) => item.id)).toEqual([activity.id]);
    expect(count).toBe(1);
  });
});
