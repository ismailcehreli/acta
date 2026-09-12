import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Follow-up item invariants (§11.1).
//
// The value of the constraint lies in being valid even when the application layer is bypassed:
// a script writing directly to the database cannot bypass these rules.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setup() {
  const unit = await createOrgUnit({ name: "Company", type: "Root" });
  const user = await createUser(unit.id, { fullName: "User" });
  const activity = await createActivity(user, { approvalStatus: "APPROVED" });
  return { user, activity };
}

describe("follow-up item constraints", () => {
  it("rejects a second open follow-up item for the same activity", async () => {
    const { user, activity } = await setup();
    await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: user.id, ownerId: user.id },
    });

    // Prisma translates the uniqueness error and does not show the index name;
    // thus the field name is inspected. Proving the constraint is partial is done in the next test.
    await expect(
      testDb.followUpItem.create({
        data: { activityId: activity.id, openedById: user.id, ownerId: user.id },
      }),
    ).rejects.toThrow(/Unique constraint failed/);
  });

  it("allows opening a new item alongside a closed one", async () => {
    const { user, activity } = await setup();
    const first = await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: user.id, ownerId: user.id },
    });
    await testDb.followUpItem.update({
      where: { id: first.id },
      data: {
        status: "CLOSED",
        closedById: user.id,
        closedAt: new Date(),
        closingNote: "Done.",
      },
    });

    // Partial index covers open items only.
    const second = await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: user.id, ownerId: user.id },
    });
    expect(second.status).toBe("OPEN");
  });

  it("rejects closing without a closing note", async () => {
    const { user, activity } = await setup();
    const item = await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: user.id, ownerId: user.id },
    });

    await expect(
      testDb.followUpItem.update({
        where: { id: item.id },
        data: { status: "CLOSED", closedById: user.id, closedAt: new Date() },
      }),
    ).rejects.toThrow(/FollowUpItem_closing_note_matches_status/);
  });

  it("rejects closing note on an open item", async () => {
    const { user, activity } = await setup();

    await expect(
      testDb.followUpItem.create({
        data: {
          activityId: activity.id,
          openedById: user.id,
          ownerId: user.id,
          closingNote: "Leftover note",
        },
      }),
    ).rejects.toThrow(/FollowUpItem_closing_note_matches_status/);
  });

  it("rejects closing without a closing user", async () => {
    const { user, activity } = await setup();
    const item = await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: user.id, ownerId: user.id },
    });

    // Answering "who closed this" must never become impossible later.
    await expect(
      testDb.followUpItem.update({
        where: { id: item.id },
        data: { status: "CLOSED", closingNote: "Done.", closedAt: new Date() },
      }),
    ).rejects.toThrow(/FollowUpItem_closer_matches_status/);
  });

  it("cannot physically delete a used item", async () => {
    const { user, activity } = await setup();
    const item = await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: user.id, ownerId: user.id },
    });
    await testDb.followUpItemEvent.create({
      data: { followUpId: item.id, kind: "OPENED", actorId: user.id },
    });

    // No physical deletion (§16.6); foreign keys also prevent deletion.
    await expect(
      testDb.followUpItem.delete({ where: { id: item.id } }),
    ).rejects.toThrow();
  });
});
