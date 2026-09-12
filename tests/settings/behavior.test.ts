import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_WORK_CALENDAR, saveWorkCalendar } from "@/server/calendar/settings";
import { askQuestion, closeConversation } from "@/server/conversations/service";
import { markActivityAsRead } from "@/server/reads/service";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";
import { sendMissingActivityReminders } from "@/worker/reminders/no-activity";
import { sendOverdueAnswerReminders } from "@/worker/reminders/overdue-answers";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Settings must genuinely change behavior.
// This file tests parametric rules with two different values to show outcomes change.

const OPENING_DATE = new Date("2026-08-17T09:00:00.000Z"); // Monday

beforeEach(async () => {
  await resetDatabase();
  await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const headquarters = await createOrgUnit({ name: "Headquarters", parentId: root.id });
  const toolingShop = await createOrgUnit({ name: "Tooling Shop", parentId: headquarters.id });

  const generalManager = await createUser(headquarters.id, {
    fullName: "General Manager",
    isUnitManager: true,
  });
  const shopManager = await createUser(toolingShop.id, {
    fullName: "Shop Manager",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: shopManager.id,
      authorOrgUnitId: toolingShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Title",
      description: "Description",
      approvalStatus: "APPROVED",
      createdAt: OPENING_DATE,
      updatedAt: OPENING_DATE,
    },
  });

  return { generalManager, shopManager, activity };
}

describe("overdue answer reminder setting (§12.2)", () => {
  async function openTestQuestion() {
    const { generalManager, activity } = await setupCompany();
    const question = await askQuestion(
      testDb,
      { id: generalManager.id, isSystemAdmin: false },
      { activityId: activity.id, text: "What is the status?" },
      OPENING_DATE,
    );
    if (!question.ok) throw new Error("setup failed");
    await testDb.notificationQueue.deleteMany({});
  }

  it("no reminder on Tuesday with default 3 business days", async () => {
    await openTestQuestion();

    const result = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-18T09:00:00.000Z"),
    );

    expect(result.overdueConversations).toBe(0);
  });

  it("reminder sent on Tuesday when setting lowered to 1 day", async () => {
    await openTestQuestion();
    await saveSettings(testDb, {
      [SETTING_KEYS.overdueAnswerBusinessDays]: "1",
    });

    const result = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-18T09:00:00.000Z"),
    );

    expect(result.overdueConversations).toBe(1);
    expect(result.queued).toBeGreaterThan(0);
  });
});

describe("supervisor takeover setting (§9.3)", () => {
  async function setupQuestionConversation() {
    const { generalManager, shopManager, activity } = await setupCompany();
    const question = await askQuestion(
      testDb,
      { id: generalManager.id, isSystemAdmin: false },
      { activityId: activity.id, text: "What is the status?" },
      OPENING_DATE,
    );
    if (!question.ok) throw new Error("setup failed");
    return { generalManager, shopManager, conversation: question.value };
  }

  /** Supervisor of asker: root unit manager. Added after conversation is setup. */
  async function addPresident() {
    const root = await testDb.orgUnit.findFirstOrThrow({ where: { parentId: null } });
    return createUser(root.id, { fullName: "President", isUnitManager: true });
  }

  it("supervisor cannot close early before setting change, can close once setting is lowered", async () => {
    const { conversation } = await setupQuestionConversation();
    const president = await addPresident();
    const wednesday = new Date("2026-08-19T09:00:00.000Z");

    // Default 10 business days: 2 days elapsed by Aug 19, insufficient.
    const earlyResult = await closeConversation(
      testDb,
      { id: president.id, isSystemAdmin: false },
      conversation.id,
      wednesday,
    );
    expect(earlyResult.ok).toBe(false);
    if (earlyResult.ok) return;
    expect(earlyResult.error).toBe("supervisor_too_early");

    await saveSettings(testDb, {
      [SETTING_KEYS.supervisorTakeoverBusinessDays]: "2",
    });

    // Same moment, same person, same conversation — only setting changed.
    const laterResult = await closeConversation(
      testDb,
      { id: president.id, isSystemAdmin: false },
      conversation.id,
      wednesday,
    );

    expect(laterResult.ok).toBe(true);
    if (!laterResult.ok) return;
    expect(laterResult.value.closeType).toBe("NORMAL");
  });
});

describe("read dwell time setting (§10.2)", () => {
  it("dwell under default 2 seconds does not record read", async () => {
    const { generalManager, activity } = await setupCompany();

    const result = await markActivityAsRead(
      testDb,
      { id: generalManager.id, isSystemAdmin: false },
      activity.id,
      1_500,
      OPENING_DATE,
    );

    expect(result).toEqual({ ok: false, reason: "too_short" });
  });

  it("same duration records read when setting lowered to 1 second", async () => {
    const { generalManager, activity } = await setupCompany();
    await saveSettings(testDb, { [SETTING_KEYS.readDwellSeconds]: "1" });

    const result = await markActivityAsRead(
      testDb,
      { id: generalManager.id, isSystemAdmin: false },
      activity.id,
      1_500,
      OPENING_DATE,
    );

    expect(result).toEqual({ ok: true, recorded: true });
  });
});

describe("reminder lead time before shift end (§12.1)", () => {
  it("does not trigger before shift end when 0, triggers when 60 minutes", async () => {
    await setupCompany();
    // Default calendar: 08:00 - 17:30.
    // 17:00 Istanbul (14:00 UTC).
    const time1700 = new Date("2026-08-17T14:00:00.000Z");

    // 0 minutes: not triggered before shift ends.
    await saveSettings(testDb, { [SETTING_KEYS.noActivityReminderLeadMinutes]: "0" });
    const zeroResult = await sendMissingActivityReminders(testDb, time1700);
    expect(zeroResult.skippedNotDue).toBe(true);

    // 60 minutes: triggered after 16:30.
    await saveSettings(testDb, { [SETTING_KEYS.noActivityReminderLeadMinutes]: "60" });
    const sixtyResult = await sendMissingActivityReminders(testDb, time1700);
    expect(sixtyResult.skippedNotDue).toBe(false);
    expect(sixtyResult.queued).toBeGreaterThan(0);
  });
});
