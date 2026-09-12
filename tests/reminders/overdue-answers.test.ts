import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addHoliday, DEFAULT_WORK_CALENDAR, saveWorkCalendar } from "@/server/calendar/settings";
import { askQuestion, replyToConversation } from "@/server/conversations/service";
import {
  OVERDUE_ANSWER_BUSINESS_DAYS,
  sendOverdueAnswerReminders,
} from "@/worker/reminders/overdue-answers";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// "No answer for 3 business days" (§12.2): sent to assignee and their manager.
//
// Counter runs from the moment responsibility last changed hands (18.08.2026):
// measuring from conversation opening would fire reminders in the middle of active discussion.
//
// Not the same as 10 business days in §9.3: that allows closing; this sends reminders.

const OPENED_AT = new Date("2026-08-17T09:00:00.000Z"); // Monday

beforeEach(async () => {
  await resetDatabase();
  await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupOpenConversation() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const gm = await createOrgUnit({ name: "Executive Office", parentId: root.id });
  const workshop = await createOrgUnit({ name: "Workshop", parentId: gm.id });

  const generalManager = await createUser(gm.id, {
    fullName: "General Manager",
    isUnitManager: true,
  });
  const workshopManager = await createUser(workshop.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: workshopManager.id,
      authorOrgUnitId: workshop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Title",
      description: "Description",
      approvalStatus: "APPROVED",
      createdAt: OPENED_AT,
      updatedAt: OPENED_AT,
    },
  });

  const question = await askQuestion(
    testDb,
    { id: generalManager.id, isSystemAdmin: false },
    { activityId: activity.id, text: "What is the status?" },
    OPENED_AT,
  );
  if (!question.ok) throw new Error("setup");

  // Clean queue so reminders can be distinguished from question notification
  await testDb.notificationQueue.deleteMany({});

  return { generalManager, workshopManager, conversation: question.value };
}

async function getReminders() {
  return testDb.notificationQueue.findMany({
    where: { eventType: "answer_overdue" },
  });
}

describe("three business days counter", () => {
  it("does not send reminder before three business days elapse", async () => {
    await setupOpenConversation();
    // Wednesday: 18, 19 -> two business days
    const result = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-19T09:00:00.000Z"),
    );

    expect(result.overdueConversations).toBe(0);
    expect(await getReminders()).toHaveLength(0);
  });

  it("sends to assignee and manager after three business days", async () => {
    const { generalManager, workshopManager } = await setupOpenConversation();
    // 18, 19, 20 -> three business days
    const result = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-20T09:00:00.000Z"),
    );

    expect(OVERDUE_ANSWER_BUSINESS_DAYS).toBe(3);
    expect(result.overdueConversations).toBe(1);
    expect(result.queued).toBe(2);

    const recipients = (await getReminders()).map((k) => k.userId).sort();
    // Assignee is activity author; manager is General Manager
    expect(recipients).toEqual([workshopManager.id, generalManager.id].sort());
  });

  it("weekends do not advance the counter", async () => {
    await setupOpenConversation();
    // For conversation pending Friday, Monday is not yet three business days
    const friday = new Date("2026-08-21T09:00:00.000Z");
    await testDb.conversationMessage.updateMany({ data: { createdAt: friday } });
    await testDb.conversation.updateMany({ data: { openedAt: friday } });

    const monday = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-24T09:00:00.000Z"),
    );
    expect(monday.overdueConversations).toBe(0);

    // Wednesday: 24, 25, 26 -> three business days
    const wednesday = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-26T09:00:00.000Z"),
    );
    expect(wednesday.overdueConversations).toBe(1);
  });

  it("official holidays delay the counter", async () => {
    await setupOpenConversation();
    await addHoliday(testDb, { date: "2026-08-19", description: "Test holiday" });

    // 18, (19 holiday), 20 -> two business days
    const thursday = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-20T09:00:00.000Z"),
    );
    expect(thursday.overdueConversations).toBe(0);

    // 21 completes the third business day
    const friday = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-21T09:00:00.000Z"),
    );
    expect(friday.overdueConversations).toBe(1);
  });
});

describe("counter resets when responsibility changes", () => {
  it("restarts counter when reply is received", async () => {
    const { workshopManager, conversation } = await setupOpenConversation();

    // Reply written after two days: turn passes to asker
    const replyTime = new Date("2026-08-19T09:00:00.000Z");
    const reply = await replyToConversation(
      testDb,
      { id: workshopManager.id, isSystemAdmin: false },
      { conversationId: conversation.id, text: "Under review." },
      replyTime,
    );
    expect(reply.ok).toBe(true);
    await testDb.notificationQueue.deleteMany({});

    // Three business days from open has passed, but not from reply
    const result = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-20T09:00:00.000Z"),
    );
    expect(result.overdueConversations).toBe(0);

    // Reminder sent three business days after reply: now waiting on asker
    const nextResult = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-24T09:00:00.000Z"),
    );
    expect(nextResult.overdueConversations).toBe(1);
  });
});

describe("closed conversations and deduplication", () => {
  it("does not send reminders for closed conversations", async () => {
    await setupOpenConversation();
    await testDb.conversation.updateMany({
      data: {
        status: "CLOSED",
        closedAt: OPENED_AT,
        closeType: "NORMAL",
      },
    });

    const result = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-20T09:00:00.000Z"),
    );

    expect(result.overdueConversations).toBe(0);
  });

  it("does not queue duplicate reminder for same waiting period", async () => {
    await setupOpenConversation();
    const time = new Date("2026-08-20T09:00:00.000Z");

    await sendOverdueAnswerReminders(testDb, time);
    const secondResult = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-21T09:00:00.000Z"),
    );

    expect(secondResult.queued).toBe(0);
    expect(await getReminders()).toHaveLength(2);
  });
});
