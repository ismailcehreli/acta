import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { askQuestion } from "@/server/conversations/service";
import { openFollowUp, touchFollowUps } from "@/server/follow-ups/service";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Follow-up item movement/touch tests.
// Movement must record when it occurred and who performed it.
// Additionally, lastMovedAt cannot move backwards.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const tooling = await createOrgUnit({ name: "Tooling", parentId: root.id });
  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const employee = await createUser(tooling.id, { fullName: "Worker" });
  const activity = await createActivity(employee, {
    activityDate: new Date("2026-08-03T00:00:00.000Z"),
  });

  const followUp = await openFollowUp(
    testDb,
    { id: employee.id, isSystemAdmin: false },
    { activityId: activity.id, nextStep: "Pending parts" },
    new Date("2026-08-03T09:00:00.000Z"),
  );
  if (!followUp.ok) throw new Error("Failed to open follow-up");

  return { manager, employee, activity, item: followUp.item };
}

describe("follow-up touch event", () => {
  it("records the actor who initiated the movement", async () => {
    const { manager, activity, item } = await setupCompany();

    // Manager asks a question on employee's activity
    await askQuestion(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      { activityId: activity.id, text: "What is the status here?" },
      new Date("2026-08-05T09:00:00.000Z"),
    );

    const event = await testDb.followUpItemEvent.findFirstOrThrow({
      where: { followUpId: item.id, kind: "TOUCHED" },
    });

    expect(event.actorId).toBe(manager.id);
  });

  it("lastMovedAt does not move backwards", async () => {
    const { manager, activity, item } = await setupCompany();

    await touchFollowUps(
      testDb,
      activity.id,
      manager.id,
      new Date("2026-08-05T09:00:00.000Z"),
    );
    // Delayed request arrives with an older timestamp
    await touchFollowUps(
      testDb,
      activity.id,
      manager.id,
      new Date("2026-08-04T09:00:00.000Z"),
    );

    const fresh = await testDb.followUpItem.findUniqueOrThrow({
      where: { id: item.id },
    });

    expect(fresh.lastMovedAt.toISOString()).toBe("2026-08-05T09:00:00.000Z");
  });

  it("closed item is not touched by subsequent movement", async () => {
    const { manager, employee, activity, item } = await setupCompany();
    await testDb.followUpItem.update({
      where: { id: item.id },
      data: {
        status: "CLOSED",
        closedAt: new Date("2026-08-04T09:00:00.000Z"),
        closedById: employee.id,
        closingNote: "Resolved",
      },
    });

    await touchFollowUps(
      testDb,
      activity.id,
      manager.id,
      new Date("2026-08-05T09:00:00.000Z"),
    );

    const eventsCount = await testDb.followUpItemEvent.count({
      where: { followUpId: item.id, kind: "TOUCHED" },
    });

    expect(eventsCount).toBe(0);
  });
});

describe("race between close and touch", () => {
  it("touch event is skipped if close transaction wins", async () => {
    const { manager, employee, activity, item } = await setupCompany();

    let markCloseReady = () => {};
    const closeReady = new Promise<void>((resolve) => (markCloseReady = resolve));
    let continueClose = () => {};
    const closeHold = new Promise<void>((resolve) => (continueClose = resolve));

    const closeTransaction = testDb.$transaction(async (tx) => {
      await tx.followUpItem.update({
        where: { id: item.id },
        data: {
          status: "CLOSED",
          closedAt: new Date("2026-08-04T09:00:00.000Z"),
          closedById: employee.id,
          closingNote: "Resolved",
        },
      });
      markCloseReady();
      await closeHold;
    });

    await closeReady;

    const touchPromise = touchFollowUps(
      testDb,
      activity.id,
      manager.id,
      new Date("2026-08-05T09:00:00.000Z"),
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    continueClose();
    await closeTransaction;
    await touchPromise;

    const eventsCount = await testDb.followUpItemEvent.count({
      where: { followUpId: item.id, kind: "TOUCHED" },
    });
    const fresh = await testDb.followUpItem.findUniqueOrThrow({
      where: { id: item.id },
    });

    expect(eventsCount).toBe(0);
    expect(fresh.lastMovedAt.toISOString()).not.toBe("2026-08-05T09:00:00.000Z");
  });
});
