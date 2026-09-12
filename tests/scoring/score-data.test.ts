import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  askQuestion,
  closeConversation,
  replyToConversation,
} from "@/server/conversations/service";
import {
  closeFollowUp,
  openFollowUp,
  transferFollowUp,
} from "@/server/follow-ups/service";
import { collectScoreInput, expectedWorkDays } from "@/server/scoring/collect";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Score denominator (Task 11.10).
//
// Denominator depends on three things:
//   - Users with `writesActivities: false` are never counted (§7.4).
//   - "No activity expected" periods are deducted from denominator (Task 11.8).
//   - The org unit work calendar determines which days are work days (Task 11.9).

const PERIOD_START = new Date("2026-08-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-08-31T00:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupUser() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });
  const author = await createUser(unit.id, { fullName: "Worker Kadir" });
  return { unit, author };
}

describe("expected work days", () => {
  it("does not count weekends", async () => {
    const { unit } = await setupUser();

    const days = await expectedWorkDays(testDb, unit.id, PERIOD_START, PERIOD_END);

    // August 2026: 21 work days (Mon-Fri), excluding weekends.
    expect(days.length).toBe(21);
  });

  it("deducts public holidays", async () => {
    const { unit } = await setupUser();
    await testDb.holiday.create({
      data: { date: new Date("2026-08-19T00:00:00.000Z"), description: "Holiday Test" },
    });

    const days = await expectedWorkDays(testDb, unit.id, PERIOD_START, PERIOD_END);

    expect(days.length).toBe(20);
    expect(days).not.toContain("2026-08-19");
  });

  // If unit calendar works on holidays, that day stays in denominator (Task 11.9).
  it("does not deduct holiday if unit calendar works on holidays", async () => {
    const { unit } = await setupUser();
    await testDb.holiday.create({
      data: { date: new Date("2026-08-19T00:00:00.000Z"), description: "Holiday Test" },
    });
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: unit.id,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 8 * 60,
        workEndMinute: 18 * 60,
        worksOnHolidays: true,
      },
    });

    const days = await expectedWorkDays(testDb, unit.id, PERIOD_START, PERIOD_END);

    expect(days).toContain("2026-08-19");
  });

  it("counts Saturdays for units that work on Saturday", async () => {
    const { unit } = await setupUser();
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: unit.id,
        workingDays: [1, 2, 3, 4, 5, 6],
        workStartMinute: 8 * 60,
        workEndMinute: 18 * 60,
        worksOnHolidays: false,
      },
    });

    const days = await expectedWorkDays(testDb, unit.id, PERIOD_START, PERIOD_END);

    expect(days.length).toBeGreaterThan(21);
  });
});

describe("leave period deducted from denominator", () => {
  it("marked days are removed from expected days", async () => {
    const { author } = await setupUser();
    await testDb.noActivityPeriod.create({
      data: {
        userId: author.id,
        markedById: author.id,
        startDate: new Date("2026-08-10T00:00:00.000Z"),
        endDate: new Date("2026-08-14T00:00:00.000Z"),
      },
    });

    const input = await collectScoreInput(testDb, { id: author.id, isSystemAdmin: false }, author.id, PERIOD_START, PERIOD_END);

    // 21 work days - 5 work days leave = 16.
    expect(input.expectedDays).toBe(16);
  });

  // Cancelled period is treated as if it never happened.
  it("cancelled period does not reduce denominator", async () => {
    const { author } = await setupUser();
    await testDb.noActivityPeriod.create({
      data: {
        userId: author.id,
        markedById: author.id,
        startDate: new Date("2026-08-10T00:00:00.000Z"),
        endDate: new Date("2026-08-14T00:00:00.000Z"),
        cancelledAt: new Date("2026-08-15T00:00:00.000Z"),
        cancelledById: author.id,
        cancellationReason: "Entered incorrectly",
      },
    });

    const input = await collectScoreInput(testDb, { id: author.id, isSystemAdmin: false }, author.id, PERIOD_START, PERIOD_END);

    expect(input.expectedDays).toBe(21);
  });
});

describe("written days count", () => {
  it("two records on the same day count as one day", async () => {
    const { author } = await setupUser();
    await createActivity(author, {
      title: "Morning",
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
    });
    await createActivity(author, {
      title: "Afternoon",
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
    });

    const input = await collectScoreInput(testDb, { id: author.id, isSystemAdmin: false }, author.id, PERIOD_START, PERIOD_END);

    expect(input.writtenDays).toBe(1);
    expect(input.writtenCount).toBe(2);
  });

  it("cancelled activity is not counted", async () => {
    const { author } = await setupUser();
    await createActivity(author, {
      title: "Cancelled",
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
      approvalStatus: "CANCELLED",
    });

    const input = await collectScoreInput(testDb, { id: author.id, isSystemAdmin: false }, author.id, PERIOD_START, PERIOD_END);

    expect(input.writtenDays).toBe(0);
  });

  it("activity outside period is not counted", async () => {
    const { author } = await setupUser();
    await createActivity(author, {
      title: "July",
      activityDate: new Date("2026-07-20T00:00:00.000Z"),
    });

    const input = await collectScoreInput(testDb, { id: author.id, isSystemAdmin: false }, author.id, PERIOD_START, PERIOD_END);

    expect(input.writtenDays).toBe(0);
  });
});

describe("follow-up discipline", () => {
  async function setupTeamAndActivity() {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });
    const manager = await createUser(unit.id, {
      fullName: "Shop Manager",
      isUnitManager: true,
    });
    const author = await createUser(unit.id, { fullName: "Worker Kadir" });
    const activity = await createActivity(author, {
      activityDate: new Date("2026-07-01T00:00:00.000Z"),
    });
    return { manager, author, activity };
  }

  const asUser = (id: string) => ({ id, isSystemAdmin: false });

  const getInput = (userId: string, until?: Date) =>
    collectScoreInput(testDb, asUser(userId), userId, PERIOD_START, PERIOD_END, until);

  async function askTestQuestion(activityId: string, askerId: string, timestampStr: string) {
    const result = await askQuestion(
      testDb,
      asUser(askerId),
      { activityId, text: "Why was this mold delayed?" },
      new Date(timestampStr),
    );
    if (!result.ok) throw new Error(`question could not be created: ${result.message}`);
    return result.value;
  }

  async function replyTestConversation(conversationId: string, userId: string, timestampStr: string) {
    const result = await replyToConversation(
      testDb,
      asUser(userId),
      { conversationId, text: "Mold was under maintenance." },
      new Date(timestampStr),
    );
    if (!result.ok) throw new Error(`reply could not be created: ${result.message}`);
  }

  async function openTestFollowUp(activityId: string, openerId: string, timestampStr: string) {
    const result = await openFollowUp(
      testDb,
      asUser(openerId),
      { activityId, nextStep: "Contact supplier" },
      new Date(timestampStr),
    );
    if (!result.ok) throw new Error(`follow-up could not be opened: ${result.message}`);
    return result.item;
  }

  it("timely answered question counts as handled", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    const conversation = await askTestQuestion(activity.id, manager.id, "2026-08-03T09:00:00.000Z");
    await replyTestConversation(conversation.id, author.id, "2026-08-04T09:00:00.000Z");

    const input = await getInput(author.id);

    // Because a reply was provided, responsibility switched to the other side;
    // measurement should count this as handled.
    expect(input.followUpTotal).toBe(1);
    expect(input.followUpHandled).toBe(1);
  });

  it("unanswered question counts as unhandled", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    await askTestQuestion(activity.id, manager.id, "2026-08-03T09:00:00.000Z");

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(1);
    expect(input.followUpHandled).toBe(0);
  });

  it("reply exceeding threshold does not count as handled", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    const conversation = await askTestQuestion(activity.id, manager.id, "2026-08-03T09:00:00.000Z");
    // Aug 3 Mon -> Aug 10 Mon: 5 work days, threshold 3.
    await replyTestConversation(conversation.id, author.id, "2026-08-10T09:00:00.000Z");

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(1);
    expect(input.followUpHandled).toBe(0);
  });

  it("asking party is also evaluated while waiting for reply", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    const conversation = await askTestQuestion(activity.id, manager.id, "2026-08-03T09:00:00.000Z");
    await replyTestConversation(conversation.id, author.id, "2026-08-04T09:00:00.000Z");

    // After reply, turn shifted to asker and asker did nothing.
    const input = await getInput(manager.id);

    expect(input.followUpTotal).toBe(1);
    expect(input.followUpHandled).toBe(0);
  });

  it("newly arrived question is not yet overdue", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    await askTestQuestion(activity.id, manager.id, "2026-08-28T09:00:00.000Z");

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(1);
    expect(input.followUpHandled).toBe(1);
  });

  it("question opened and replied in previous period is not carried over", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    const conversation = await askTestQuestion(activity.id, manager.id, "2026-07-02T09:00:00.000Z");
    await replyTestConversation(conversation.id, author.id, "2026-07-03T09:00:00.000Z");

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(0);
  });

  it("follow-up item remains on opener scorecard even after transfer", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    const item = await openTestFollowUp(activity.id, author.id, "2026-08-03T09:00:00.000Z");

    await transferFollowUp(
      testDb,
      asUser(author.id),
      item.id,
      manager.id,
      new Date("2026-08-04T09:00:00.000Z"),
    );
    await closeFollowUp(
      testDb,
      asUser(manager.id),
      item.id,
      "Supplier confirmed",
      new Date("2026-08-05T09:00:00.000Z"),
    );

    // Design specifies "closing follow-ups opened": item stays on opener scorecard.
    const openerInput = await getInput(author.id);
    expect(openerInput.followUpTotal).toBe(1);
    expect(openerInput.followUpHandled).toBe(1);

    // Not written to transferee scorecard; transfer does not change past performance owner.
    const transfereeInput = await getInput(manager.id);
    expect(transfereeInput.followUpTotal).toBe(0);
  });

  it("unclosed follow-up item lowers opener score", async () => {
    const { author, activity } = await setupTeamAndActivity();
    await openTestFollowUp(activity.id, author.id, "2026-08-03T09:00:00.000Z");

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(1);
    expect(input.followUpHandled).toBe(0);
  });

  it("newly opened follow-up item is not yet overdue", async () => {
    const { author, activity } = await setupTeamAndActivity();
    await openTestFollowUp(activity.id, author.id, "2026-08-28T09:00:00.000Z");

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(1);
    expect(input.followUpHandled).toBe(1);
  });

  it("follow-up item opened and closed in previous period is not in denominator", async () => {
    const { author, activity } = await setupTeamAndActivity();
    const item = await openTestFollowUp(activity.id, author.id, "2026-07-01T09:00:00.000Z");
    await closeFollowUp(
      testDb,
      asUser(author.id),
      item.id,
      "Done",
      new Date("2026-07-20T09:00:00.000Z"),
    );

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(0);
  });

  it("questions and follow-ups are counted together", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    const item = await openTestFollowUp(activity.id, author.id, "2026-08-03T09:00:00.000Z");
    await closeFollowUp(
      testDb,
      asUser(author.id),
      item.id,
      "Done",
      new Date("2026-08-05T09:00:00.000Z"),
    );
    await askTestQuestion(activity.id, manager.id, "2026-08-03T09:00:00.000Z");

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(2);
    expect(input.followUpHandled).toBe(1);
  });

  it("open item with movement within period counts as handled", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    await openTestFollowUp(activity.id, author.id, "2026-08-03T09:00:00.000Z");

    // Aug 28 question arrived on activity: item saw activity.
    await askTestQuestion(activity.id, manager.id, "2026-08-28T09:00:00.000Z");

    const input = await getInput(author.id);
    const itemCount = input.followUpTotal - 1; // conversation is also in denominator

    expect(itemCount).toBe(1);
    // Item was handled, question not yet overdue: both in handled.
    expect(input.followUpHandled).toBe(2);
  });

  it("movement in September does not improve August item score", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    await openTestFollowUp(activity.id, author.id, "2026-08-03T09:00:00.000Z");

    // Movement in September: August scorecard must not know about this.
    await askTestQuestion(activity.id, manager.id, "2026-09-10T09:00:00.000Z");

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(1);
    expect(input.followUpHandled).toBe(0);
  });

  it("question closed without reply is deducted from denominator", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    const conversation = await askTestQuestion(activity.id, manager.id, "2026-08-03T09:00:00.000Z");

    // Asker closes next day; author never replied.
    const closeResult = await closeConversation(
      testDb,
      asUser(manager.id),
      conversation.id,
      new Date("2026-08-04T09:00:00.000Z"),
    );
    if (!closeResult.ok) throw new Error(`could not close: ${closeResult.message}`);

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(0);
    expect(input.followUpHandled).toBe(0);
  });

  it("question closed after reply counts as handled", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    const conversation = await askTestQuestion(activity.id, manager.id, "2026-08-03T09:00:00.000Z");
    await replyTestConversation(conversation.id, author.id, "2026-08-04T09:00:00.000Z");
    await closeConversation(
      testDb,
      asUser(manager.id),
      conversation.id,
      new Date("2026-08-05T09:00:00.000Z"),
    );

    const input = await getInput(author.id);

    expect(input.followUpTotal).toBe(1);
    expect(input.followUpHandled).toBe(1);
  });
});

describe("closed period does not change retroactively", () => {
  async function setupTeamAndActivity() {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });
    const manager = await createUser(unit.id, {
      fullName: "Shop Manager",
      isUnitManager: true,
    });
    const author = await createUser(unit.id, { fullName: "Worker Kadir" });
    const activity = await createActivity(author, {
      activityDate: new Date("2026-07-01T00:00:00.000Z"),
    });
    return { manager, author, activity };
  }

  const asUser = (id: string) => ({ id, isSystemAdmin: false });
  const augustInput = (userId: string) =>
    collectScoreInput(testDb, asUser(userId), userId, PERIOD_START, PERIOD_END);

  it("movement in September does not change August follow-up score", async () => {
    const { author, activity } = await setupTeamAndActivity();
    const openedResult = await openFollowUp(
      testDb,
      asUser(author.id),
      { activityId: activity.id, nextStep: "Waiting" },
      new Date("2026-08-03T09:00:00.000Z"),
    );
    if (!openedResult.ok) throw new Error("follow-up could not be opened");

    const beforeInput = await augustInput(author.id);
    expect(beforeInput.followUpHandled).toBe(0);

    // Item closed in September: August scorecard must not change.
    await closeFollowUp(
      testDb,
      asUser(author.id),
      openedResult.item.id,
      "Finished in September",
      new Date("2026-09-05T09:00:00.000Z"),
    );

    const afterInput = await augustInput(author.id);

    expect(afterInput.followUpTotal).toBe(beforeInput.followUpTotal);
    expect(afterInput.followUpHandled).toBe(0);
  });

  it("question not yet overdue at month-end does not become retroactively overdue from late September reply", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    // Asked Aug 28 Friday: only 1 work day elapsed when month ended.
    const conversation = await askQuestion(
      testDb,
      asUser(manager.id),
      { activityId: activity.id, text: "End of month question" },
      new Date("2026-08-28T09:00:00.000Z"),
    );
    if (!conversation.ok) throw new Error("question could not be created");

    const beforeInput = await augustInput(author.id);
    expect(beforeInput.followUpHandled).toBe(1);

    // Reply arrived on September 20th. August scorecard must not know this:
    // when the period closed, the question was not yet overdue.
    await replyToConversation(
      testDb,
      asUser(author.id),
      { conversationId: conversation.value.id, text: "Late reply" },
      new Date("2026-09-20T09:00:00.000Z"),
    );

    const afterInput = await augustInput(author.id);

    expect(afterInput.followUpTotal).toBe(1);
    expect(afterInput.followUpHandled).toBe(1);
  });

  it("reply provided in September does not change August question score", async () => {
    const { manager, author, activity } = await setupTeamAndActivity();
    const conversation = await askQuestion(
      testDb,
      asUser(manager.id),
      { activityId: activity.id, text: "Question" },
      new Date("2026-08-03T09:00:00.000Z"),
    );
    if (!conversation.ok) throw new Error("question could not be created");

    const beforeInput = await augustInput(author.id);
    expect(beforeInput.followUpHandled).toBe(0);

    await replyToConversation(
      testDb,
      asUser(author.id),
      { conversationId: conversation.value.id, text: "Late reply" },
      new Date("2026-09-05T09:00:00.000Z"),
    );

    const afterInput = await augustInput(author.id);

    expect(afterInput.followUpTotal).toBe(1);
    expect(afterInput.followUpHandled).toBe(0);
  });
});

describe("timestamps on period boundaries", () => {
  async function setupTeam() {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({
      name: "Tooling Shop",
      parentId: root.id,
      requiresApproval: true,
    });
    const manager = await createUser(unit.id, {
      fullName: "Shop Manager",
      isUnitManager: true,
    });
    const author = await createUser(unit.id, { fullName: "Worker Kadir" });
    return { manager, author };
  }

  const asUser = (id: string) => ({ id, isSystemAdmin: false });

  it("follow-up opened on last day of month is included in period", async () => {
    const { author } = await setupTeam();
    const activity = await createActivity(author, {
      activityDate: new Date("2026-08-03T00:00:00.000Z"),
    });

    const openedResult = await openFollowUp(
      testDb,
      asUser(author.id),
      { activityId: activity.id, nextStep: "Last day" },
      new Date("2026-08-31T12:00:00.000Z"),
    );
    if (!openedResult.ok) throw new Error("follow-up could not be opened");

    const input = await collectScoreInput(
      testDb,
      asUser(author.id),
      author.id,
      PERIOD_START,
      PERIOD_END,
    );

    expect(input.followUpTotal).toBe(1);
  });
});

describe("numerator cannot exceed denominator", () => {
  async function recordActivities(author: { id: string; orgUnitId: string }, days: string[]) {
    for (const day of days) {
      await createActivity(author, { activityDate: new Date(`${day}T00:00:00.000Z`) });
    }
  }

  const asUser = (id: string) => ({ id, isSystemAdmin: false });

  it("activity written on leave day does not increase numerator", async () => {
    const { author } = await setupUser();

    // Aug 3-7 on leave; denominator drops from 21 to 16.
    await testDb.noActivityPeriod.create({
      data: {
        userId: author.id,
        startDate: new Date("2026-08-03T00:00:00.000Z"),
        endDate: new Date("2026-08-07T00:00:00.000Z"),
        markedById: author.id,
      },
    });

    await recordActivities(author, [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-10",
      "2026-08-11",
    ]);

    const input = await collectScoreInput(
      testDb,
      asUser(author.id),
      author.id,
      PERIOD_START,
      PERIOD_END,
    );

    expect(input.expectedDays).toBe(16);
    // Five leave days must not enter numerator; remaining two days are counted.
    expect(input.writtenDays).toBe(2);
    expect(input.writtenDays).toBeLessThanOrEqual(input.expectedDays);
  });

  it("activity written on weekend does not increase numerator", async () => {
    const { author } = await setupUser();

    // Aug 1 and 2, 2026 Saturday and Sunday; unit works Mon-Fri.
    await recordActivities(author, ["2026-08-01", "2026-08-02", "2026-08-03"]);

    const input = await collectScoreInput(
      testDb,
      asUser(author.id),
      author.id,
      PERIOD_START,
      PERIOD_END,
    );

    expect(input.expectedDays).toBe(21);
    expect(input.writtenDays).toBe(1);
  });

  it("activity written on public holiday does not increase numerator", async () => {
    const { author } = await setupUser();
    await testDb.holiday.create({
      data: { date: new Date("2026-08-19T00:00:00.000Z"), description: "Holiday Test" },
    });

    await recordActivities(author, ["2026-08-19", "2026-08-20"]);

    const input = await collectScoreInput(
      testDb,
      asUser(author.id),
      author.id,
      PERIOD_START,
      PERIOD_END,
    );

    expect(input.expectedDays).toBe(20);
    expect(input.writtenDays).toBe(1);
  });

  it("for user writing every work day, numerator equals denominator", async () => {
    const { author } = await setupUser();

    const workDays = await expectedWorkDays(testDb, author.orgUnitId, PERIOD_START, PERIOD_END);
    await recordActivities(author, workDays);

    const input = await collectScoreInput(
      testDb,
      asUser(author.id),
      author.id,
      PERIOD_START,
      PERIOD_END,
    );

    expect(input.writtenDays).toBe(input.expectedDays);
  });
});
