import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Administrative conversation closure requires a reason enforced by constraint
// (`Conversation_close_reason_matches_type`).

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function openConversation() {
  const unit = await createOrgUnit();
  const asker = await createUser(unit.id);
  const author = await createUser(unit.id);
  const activity = await createActivity(author, { approvalStatus: "APPROVED" });

  return testDb.conversation.create({
    data: {
      activityId: activity.id,
      askerId: asker.id,
      responsibleId: author.id,
      status: "OPEN",
    },
  });
}

describe("conversation close reason constraint", () => {
  it("rejects administrative close without reason", async () => {
    const conversation = await openConversation();

    await expect(
      testDb.conversation.update({
        where: { id: conversation.id },
        data: { status: "CLOSED", closedAt: new Date(), closeType: "ADMINISTRATIVE" },
      }),
    ).rejects.toThrow(/Conversation_close_reason_matches_type/);
  });

  it("rejects whitespace only reason", async () => {
    const conversation = await openConversation();

    await expect(
      testDb.conversation.update({
        where: { id: conversation.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closeType: "ADMINISTRATIVE",
          closeReason: "   ",
        },
      }),
    ).rejects.toThrow(/Conversation_close_reason_matches_type/);
  });

  it("accepts administrative close with valid reason", async () => {
    const conversation = await openConversation();

    const closed = await testDb.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closeType: "ADMINISTRATIVE",
        closeReason: "Party left company.",
      },
    });

    expect(closed.closeReason).toBe("Party left company.");
  });

  it.each(["NORMAL", "CANCELLED_ACTIVITY"] as const)(
    "rejects reason on %s closure",
    async (closeType) => {
      const conversation = await openConversation();

      await expect(
        testDb.conversation.update({
          where: { id: conversation.id },
          data: {
            status: "CLOSED",
            closedAt: new Date(),
            closeType,
            closeReason: "should not be set",
          },
        }),
      ).rejects.toThrow(/Conversation_close_reason_matches_type/);

      const closed = await testDb.conversation.update({
        where: { id: conversation.id },
        data: { status: "CLOSED", closedAt: new Date(), closeType },
      });
      expect(closed.closeType).toBe(closeType);
    },
  );
});
