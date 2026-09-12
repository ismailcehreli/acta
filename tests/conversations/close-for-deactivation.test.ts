import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeOpenConversationsForUser } from "@/server/conversations/close-for-deactivation";
import { askQuestion } from "@/server/conversations/service";
import { deactivateUser } from "@/server/users/deactivate";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Plan question 12 (product owner decision 18.08.2026): administrative closure
// belongs to deactivation flow. §4.6 prevents deactivation of users with open
// conversations, §9.3 ties closing to administrative action.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupWithOpenConversation() {
  const root = await createOrgUnit({ name: "Headquarters", type: "Root" });
  const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });

  const director = await createUser(root.id, {
    fullName: "Director",
    isUnitManager: true,
  });
  const author = await createUser(unit.id, {
    fullName: "Manager",
    isUnitManager: true,
  });
  const sysAdmin = await createUser(root.id, {
    fullName: "System Admin",
    isSystemAdmin: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: unit.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Title",
      description: "Description",
      approvalStatus: "APPROVED",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  const question = await askQuestion(
    testDb,
    { id: director.id, isSystemAdmin: false },
    { activityId: activity.id, text: "What is the status?" },
    NOW,
  );
  if (!question.ok) throw new Error("setup failed");

  return { director, author, sysAdmin, conversation: question.value };
}

const admin = (user: { id: string }) => ({ id: user.id, isSystemAdmin: true });

describe("closing conversations blocking deactivation", () => {
  it("closes with justification and unblocks deactivation", async () => {
    const { author, sysAdmin } = await setupWithOpenConversation();

    // Must be blocked initially.
    const blockedResult = await deactivateUser(testDb, author.id, NOW);
    expect(blockedResult.ok).toBe(false);
    if (blockedResult.ok) return;
    expect(blockedResult.reason).toBe("blocked");

    const result = await closeOpenConversationsForUser(
      testDb,
      admin(sysAdmin),
      author.id,
      "User departed from company.",
      NOW,
    );

    expect(result).toEqual({ closed: 1, failed: 0 });

    const closed = await testDb.conversation.findFirstOrThrow();
    expect(closed.status).toBe("CLOSED");
    expect(closed.closeType).toBe("ADMINISTRATIVE");
    expect(closed.closeReason).toBe("User departed from company.");
    expect(closed.closedById).toBe(sysAdmin.id);

    // Can now be deactivated.
    const subsequentDeactivate = await deactivateUser(testDb, author.id, NOW);
    expect(subsequentDeactivate.ok).toBe(true);
  });

  it("also works for the asking party", async () => {
    const { director, sysAdmin } = await setupWithOpenConversation();

    const result = await closeOpenConversationsForUser(
      testDb,
      admin(sysAdmin),
      director.id,
      "Role reassignment.",
      NOW,
    );

    expect(result).toEqual({ closed: 1, failed: 0 });
  });

  it("call without reason closes zero conversations", async () => {
    const { director, sysAdmin } = await setupWithOpenConversation();

    const result = await closeOpenConversationsForUser(
      testDb,
      admin(sysAdmin),
      director.id,
      "   ",
      NOW,
    );

    expect(result).toEqual({ closed: 0, failed: 1 });
    expect(
      await testDb.conversation.count({ where: { status: "OPEN" } }),
    ).toBe(1);
  });

  it("non-system-admin cannot bulk close", async () => {
    const { director, author } = await setupWithOpenConversation();

    const result = await closeOpenConversationsForUser(
      testDb,
      { id: author.id, isSystemAdmin: false },
      director.id,
      "I want to close.",
      NOW,
    );

    expect(result).toEqual({ closed: 0, failed: 1 });
    expect(
      await testDb.conversation.count({ where: { status: "OPEN" } }),
    ).toBe(1);
  });

  it("completes silently if no conversations need closing", async () => {
    const { sysAdmin } = await setupWithOpenConversation();

    const result = await closeOpenConversationsForUser(
      testDb,
      admin(sysAdmin),
      sysAdmin.id,
      "Reason.",
      NOW,
    );

    expect(result).toEqual({ closed: 0, failed: 0 });
  });
});
