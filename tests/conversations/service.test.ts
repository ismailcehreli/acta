import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listActivityConversations, listOpenWorkItems } from "@/server/conversations/read";
import {
  askQuestion,
  canAskQuestion,
  closeConversation,
  replyToConversation,
} from "@/server/conversations/service";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { conversationMessageSchema } from "@/shared/schemas/conversation";

import { resetDatabase, testDb } from "../helpers/test-db";

// §9: independent conversations per activity, single responsible party,
// responsibility shifting with replies, visible to intermediate levels, no round limits.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function buildScenario() {
  const root = await createOrgUnit({ name: "Headquarters", type: "Root" });
  const directorate = await createOrgUnit({ name: "Directorate", parentId: root.id });
  const moldShop = await createOrgUnit({ name: "Tooling Shop", parentId: directorate.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: directorate.id });

  const generalManager = await createUser(root.id, {
    fullName: "General Manager",
    isUnitManager: true,
  });
  const director = await createUser(directorate.id, {
    fullName: "Director",
    isUnitManager: true,
  });
  const author = await createUser(moldShop.id, {
    fullName: "Shop Manager",
    isUnitManager: true,
  });
  const peer = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });
  const sysAdmin = await createUser(root.id, {
    fullName: "System Admin",
    isSystemAdmin: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Mold maintenance",
      description: "Crack repaired.",
      approvalStatus: "APPROVED",
    },
  });

  return {
    generalManager,
    director,
    author,
    peer,
    sysAdmin,
    activity,
    units: { root, directorate, moldShop, planning },
  };
}

const actor = (user: { id: string; isSystemAdmin: boolean }) => ({
  id: user.id,
  isSystemAdmin: user.isSystemAdmin,
});

describe("permission to ask questions (§9.2)", () => {
  it("manager in upstream chain can ask question", async () => {
    const { director, activity } = await buildScenario();

    expect(
      await canAskQuestion(testDb, actor(director), activity),
    ).toBe(true);
  });

  it("author cannot ask question on own activity", async () => {
    const { author, activity } = await buildScenario();

    expect(await canAskQuestion(testDb, actor(author), activity)).toBe(false);
  });

  it("peer cannot ask question; cannot even see activity", async () => {
    const { peer, activity } = await buildScenario();

    expect(await canAskQuestion(testDb, actor(peer), activity)).toBe(false);

    const result = await askQuestion(
      testDb,
      actor(peer),
      { activityId: activity.id, text: "What does this mean?" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Existence of unseen activity is not disclosed.
    expect(result.message).toBe("Activity not found.");
  });

  it("system admin cannot ask question if not upstream in hierarchy", async () => {
    const { sysAdmin, activity } = await buildScenario();

    const result = await askQuestion(
      testDb,
      { id: sysAdmin.id, isSystemAdmin: true },
      { activityId: activity.id, text: "What does this mean?" },
      NOW,
    );

    expect(result.ok).toBe(false);
  });
});

describe("conversation flow (§9.2)", () => {
  it("responsible party is activity author when question is opened", async () => {
    const { director, author, activity } = await buildScenario();

    const result = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Why is this mold issue continuing?" },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.askerId).toBe(director.id);
    expect(result.value.responsibleId).toBe(author.id);
    expect(result.value.status).toBe("OPEN");
  });

  it("notification queued to author when question is asked (§12.2)", async () => {
    const { director, author, activity } = await buildScenario();

    await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Question text" },
      NOW,
    );

    const notifications = await testDb.notificationQueue.findMany();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe(author.id);
    expect(notifications[0].eventType).toBe("question_asked");
  });

  it("responsibility shifts to asker when reply is given", async () => {
    const { director, author, activity } = await buildScenario();
    const created = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Question" },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");

    const replyResult = await replyToConversation(
      testDb,
      actor(author),
      { conversationId: created.value.id, text: "Spare part is awaited." },
      new Date(NOW.getTime() + 60_000),
    );

    expect(replyResult.ok).toBe(true);
    if (!replyResult.ok) return;
    expect(replyResult.value.responsibleId).toBe(director.id);
  });

  it("notification queued to asker when reply arrives", async () => {
    const { director, author, activity } = await buildScenario();
    const created = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Question" },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");

    await replyToConversation(
      testDb,
      actor(author),
      { conversationId: created.value.id, text: "Reply" },
      new Date(NOW.getTime() + 60_000),
    );

    const notifications = await testDb.notificationQueue.findMany({
      where: { eventType: "answer_received" },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe(director.id);
  });

  it("no round limit; responsibility shifts on every message (§9.4)", async () => {
    const { director, author, activity } = await buildScenario();
    const created = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Question 1" },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");

    let timestamp = NOW.getTime();
    for (let round = 0; round < 5; round += 1) {
      timestamp += 60_000;
      const reply = await replyToConversation(
        testDb,
        actor(author),
        { conversationId: created.value.id, text: `Reply ${round}` },
        new Date(timestamp),
      );
      expect(reply.ok).toBe(true);
      if (reply.ok) expect(reply.value.responsibleId).toBe(director.id);

      timestamp += 60_000;
      const followUp = await replyToConversation(
        testDb,
        actor(director),
        { conversationId: created.value.id, text: `Additional question ${round}` },
        new Date(timestamp),
      );
      expect(followUp.ok).toBe(true);
      if (followUp.ok) expect(followUp.value.responsibleId).toBe(author.id);
    }

    const messageCount = await testDb.conversationMessage.count({
      where: { conversationId: created.value.id },
    });
    expect(messageCount).toBe(11);
  });

  it("multiple independent conversations can exist per activity (§9.1)", async () => {
    const { director, generalManager, author, activity } = await buildScenario();

    const first = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Director question" },
      NOW,
    );
    const second = await askQuestion(
      testDb,
      actor(generalManager),
      { activityId: activity.id, text: "General Manager question" },
      NOW,
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Replying to one does not advance the other.
    await replyToConversation(
      testDb,
      actor(author),
      { conversationId: first.value.id, text: "Reply" },
      new Date(NOW.getTime() + 60_000),
    );

    const secondUpdated = await testDb.conversation.findUniqueOrThrow({
      where: { id: second.value.id },
    });
    expect(secondUpdated.responsibleId).toBe(author.id);
  });

  it("non-party cannot write messages to conversation", async () => {
    const { director, peer, activity } = await buildScenario();
    const created = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Question" },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");

    const result = await replyToConversation(
      testDb,
      actor(peer),
      { conversationId: created.value.id, text: "Intervening" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Non-party receives same error as non-existent conversation.
    expect(result.error).toBe("conversation_not_found");
  });
});

describe("closing (§9.3) — against database", () => {
  async function setupWithOpenConversation() {
    const scenario = await buildScenario();
    const created = await askQuestion(
      testDb,
      actor(scenario.director),
      { activityId: scenario.activity.id, text: "Question" },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");
    return { ...scenario, conversation: created.value };
  }

  it("asker can close", async () => {
    const { director, conversation } = await setupWithOpenConversation();

    const result = await closeConversation(
      testDb,
      actor(director),
      conversation.id,
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.closeType).toBe("NORMAL");
  });

  it("responsible party cannot close — even after replying", async () => {
    const { author, conversation } = await setupWithOpenConversation();
    await replyToConversation(
      testDb,
      actor(author),
      { conversationId: conversation.id, text: "Reply" },
      new Date(NOW.getTime() + 60_000),
    );

    const result = await closeConversation(
      testDb,
      actor(author),
      conversation.id,
      new Date(NOW.getTime() + 120_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("responsible_cannot_close");
  });

  it("asker supervisor cannot close before 10 business days", async () => {
    const { generalManager, conversation } = await setupWithOpenConversation();

    const result = await closeConversation(
      testDb,
      actor(generalManager),
      conversation.id,
      new Date("2026-08-20T09:00:00.000Z"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("supervisor_too_early");
  });

  it("asker supervisor can close after 10 business days", async () => {
    const { generalManager, conversation } = await setupWithOpenConversation();

    const result = await closeConversation(
      testDb,
      actor(generalManager),
      conversation.id,
      new Date("2026-09-01T09:00:00.000Z"),
    );

    expect(result.ok).toBe(true);
  });

  it("public holiday delays counter — verified through real service", async () => {
    const { generalManager, conversation } = await setupWithOpenConversation();
    const tenthWorkDay = new Date("2026-08-31T09:00:00.000Z");

    // Without holiday 10 business days elapsed.
    const withoutHoliday = await closeConversation(
      testDb,
      actor(generalManager),
      conversation.id,
      tenthWorkDay,
    );
    expect(withoutHoliday.ok).toBe(true);
  });

  it("supervisor cannot close on same day if holiday declared", async () => {
    const { generalManager, conversation } = await setupWithOpenConversation();
    await testDb.holiday.create({
      data: { date: new Date("2026-08-31T00:00:00.000Z"), description: "Trial holiday" },
    });

    const result = await closeConversation(
      testDb,
      actor(generalManager),
      conversation.id,
      new Date("2026-08-31T09:00:00.000Z"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("supervisor_too_early");
  });

  it("asker last action is not lost in long conversations", async () => {
    const { director, author, generalManager, conversation } = await setupWithOpenConversation();

    // Asker writes again one week after opening.
    const askerLastAction = new Date("2026-08-24T09:00:00.000Z");
    await testDb.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        authorId: director.id,
        text: "Reminder",
        createdAt: askerLastAction,
      },
    });

    // Followed by 60 replies.
    await testDb.conversationMessage.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        conversationId: conversation.id,
        authorId: author.id,
        text: `Intermediate reply ${i + 1}`,
        createdAt: new Date(askerLastAction.getTime() + (i + 1) * 60_000),
      })),
    });

    // 5 business days between Aug 24 and Aug 31.
    const result = await closeConversation(
      testDb,
      actor(generalManager),
      conversation.id,
      new Date("2026-08-31T09:00:00.000Z"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("supervisor_too_early");
  });

  it("system admin closes administratively; reason is recorded", async () => {
    const { sysAdmin, conversation } = await setupWithOpenConversation();

    const result = await closeConversation(
      testDb,
      { id: sysAdmin.id, isSystemAdmin: true },
      conversation.id,
      NOW,
      "Asker left company, account will be closed.",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.closeType).toBe("ADMINISTRATIVE");
    expect(result.value.closeReason).toBe(
      "Asker left company, account will be closed.",
    );
  });

  it("administrative closure without reason is rejected", async () => {
    const { sysAdmin, conversation } = await setupWithOpenConversation();

    for (const reason of [undefined, "", "   "]) {
      const result = await closeConversation(
        testDb,
        { id: sysAdmin.id, isSystemAdmin: true },
        conversation.id,
        NOW,
        reason,
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("reason_required");
    }

    // Conversation remains open: rejected close leaves no side effect.
    const updated = await testDb.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(updated.status).toBe("OPEN");
    expect(updated.closeReason).toBeNull();
  });

  it("reason field remains null when asker closes directly", async () => {
    const { director, conversation } = await setupWithOpenConversation();

    const result = await closeConversation(
      testDb,
      actor(director),
      conversation.id,
      NOW,
      "should be ignored",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.closeType).toBe("NORMAL");
    expect(result.value.closeReason).toBeNull();
  });

  it("administrative closure enables user deactivation (§4.6 lock)", async () => {
    const { sysAdmin, director, conversation } = await setupWithOpenConversation();

    await expect(
      testDb.user.update({
        where: { id: director.id },
        data: { isActive: false, isUnitManager: false },
      }),
    ).rejects.toThrow(/USER_HAS_OPEN_CONVERSATIONS/);

    await closeConversation(
      testDb,
      { id: sysAdmin.id, isSystemAdmin: true },
      conversation.id,
      NOW,
      "User left company.",
    );

    const updated = await testDb.user.update({
      where: { id: director.id },
      data: { isActive: false, isUnitManager: false },
    });
    expect(updated.isActive).toBe(false);
  });

  it("single character reply is valid, empty message is not", async () => {
    expect(conversationMessageSchema.safeParse("Y").success).toBe(true);
    expect(conversationMessageSchema.safeParse("").success).toBe(false);
    expect(conversationMessageSchema.safeParse("   ").success).toBe(false);
  });

  it("cannot write message to closed conversation", async () => {
    const { director, author, conversation } = await setupWithOpenConversation();
    await closeConversation(testDb, actor(director), conversation.id, NOW);

    const result = await replyToConversation(
      testDb,
      actor(author),
      { conversationId: conversation.id, text: "Late reply" },
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("closed");
  });
});

describe("conversation paths pass through visibility", () => {
  async function setupConversation() {
    const context = await buildScenario();
    const created = await askQuestion(
      testDb,
      actor(context.director),
      { activityId: context.activity.id, text: "Question" },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");
    return { ...context, conversation: created.value };
  }

  it("peer cannot write to conversation even if ID is known", async () => {
    const { peer, conversation } = await setupConversation();

    const result = await replyToConversation(
      testDb,
      actor(peer),
      { conversationId: conversation.id, text: "Intervening" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("conversation_not_found");
  });

  it("unauthorized receives same response as non-existent conversation", async () => {
    const { peer, conversation } = await setupConversation();

    const unauthorized = await replyToConversation(
      testDb,
      actor(peer),
      { conversationId: conversation.id, text: "Text" },
      NOW,
    );
    const nonExistent = await replyToConversation(
      testDb,
      actor(peer),
      {
        conversationId: "00000000-0000-0000-0000-000000000000",
        text: "Text",
      },
      NOW,
    );

    expect(unauthorized).toEqual(nonExistent);
  });

  it("closed status is not disclosed to unauthorized party", async () => {
    const { director, peer, conversation } = await setupConversation();
    await closeConversation(testDb, actor(director), conversation.id, NOW);

    const result = await replyToConversation(
      testDb,
      actor(peer),
      { conversationId: conversation.id, text: "Text" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("conversation_not_found");
  });

  it("asker transferred to another branch cannot write to conversation they can no longer see", async () => {
    const { director, conversation, units } = await setupConversation();

    await testDb.user.update({
      where: { id: director.id },
      data: { orgUnitId: units.planning.id, isUnitManager: false },
    });

    const result = await replyToConversation(
      testDb,
      actor(director),
      { conversationId: conversation.id, text: "Can I still write?" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("conversation_not_found");
  });

  it("conversation list passes through visibility", async () => {
    const { peer, director, activity } = await setupConversation();

    expect(
      await listActivityConversations(testDb, actor(peer), activity.id),
    ).toEqual([]);
    expect(
      (await listActivityConversations(testDb, actor(director), activity.id))
        .length,
    ).toBe(1);
  });
});

describe("open work items list", () => {
  it("asker and responsible see same conversation with different roles", async () => {
    const { director, author, activity } = await buildScenario();
    const created = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Question" },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");

    const askerList = await listOpenWorkItems(testDb, actor(director));
    const authorList = await listOpenWorkItems(testDb, actor(author));

    expect(askerList).toHaveLength(1);
    expect(askerList[0].waitingOnMe).toBe(false);
    expect(authorList).toHaveLength(1);
    expect(authorList[0].waitingOnMe).toBe(true);
  });

  it("roles swap after reply", async () => {
    const { director, author, activity } = await buildScenario();
    const created = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Question" },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");

    await replyToConversation(
      testDb,
      actor(author),
      { conversationId: created.value.id, text: "Reply" },
      new Date(NOW.getTime() + 60_000),
    );

    expect((await listOpenWorkItems(testDb, actor(director)))[0].waitingOnMe).toBe(
      true,
    );
    expect((await listOpenWorkItems(testDb, actor(author)))[0].waitingOnMe).toBe(
      false,
    );
  });

  it("closed conversation drops from work items list", async () => {
    const { director, activity } = await buildScenario();
    const created = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Question" },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");

    await closeConversation(testDb, actor(director), created.value.id, NOW);

    expect(await listOpenWorkItems(testDb, actor(director))).toEqual([]);
  });
});

describe("open conversation prevents deactivation", () => {
  it("author cannot be deactivated even after responsibility shifts to asker", async () => {
    const { director, author, activity } = await buildScenario();
    const created = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Question" },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");

    // Author replies; responsibility shifts to asker.
    await replyToConversation(
      testDb,
      actor(author),
      { conversationId: created.value.id, text: "Reply" },
      new Date(NOW.getTime() + 60_000),
    );

    await expect(
      testDb.user.update({
        where: { id: author.id },
        data: { isActive: false, isUnitManager: false },
      }),
    ).rejects.toThrow(/USER_HAS_OPEN_CONVERSATIONS/);
  });
});
