import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});


/** Version 1 scope tables (§16, Task 0.2a). */
const VERSION_1_TABLES = [
  "Activity",
  "ActivityAppreciation",
  "ActivityApprover",
  "ActivityDeletionRequest",
  "ActivityDraft",
  "ActivityDraftAttachment",
  "ActivityRevision",
  "ActivityTargetDept",
  "ApprovalReason",
  "ApprovalRound",
  "Attachment",
  "AuditLog",
  "BackupRequest",
  "CancellationRecord",
  "Conversation",
  "ConversationMessage",
  "DemoObject",
  "Feedback",
  "FollowUpItem",
  "FollowUpItemEvent",
  "HelpArticle",
  "Holiday",
  "NoActivityPeriod",
  "NotificationQueue",
  "OrgUnit",
  "OrgUnitWorkCalendar",
  "PushSubscription",
  "ReadReceipt",
  "ScheduledJobStatus",
  "ScoreCompanyCalendarEvent",
  "ScoreHistoryControl",
  "ScoreHolidayEvent",
  "ScoreOrgUnitStateEvent",
  "ScorePeriodLedger",
  "ScoreRecalculationRequest",
  "ScoreSettingEvent",
  "ScoreUnitCalendarEvent",
  "ScoreUserStateEvent",
  "Session",
  "SystemResetRequest",
  "SystemSetting",
  "User",
  "UserCredential",
  "UserScorePeriod",
  "UserScorePeriodFact",
  "WorkCalendar",
];

/** Belongs to Version 2; not provisioned in this release (§18.2). */
const VERSION_2_TABLES = [
  "ApprovalTask",
  "ApprovalAction",
  "Escalation",
  "Delegation",
];

async function tableNames(): Promise<string[]> {
  const rows = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
  return rows.map((r) => r.tablename);
}

describe("schema installation", () => {
  it("all Version 1 tables are installed", async () => {
    expect(await tableNames()).toEqual(VERSION_1_TABLES);
  });

  it("Version 2 tables are not created", async () => {
    const names = await tableNames();
    for (const table of VERSION_2_TABLES) {
      expect(names).not.toContain(table);
    }
  });
});

describe("scope discipline — column level", () => {
  /**
   * Columns suggesting Version 2 concepts. The single intentional exception is
   * `NoActivityPeriod.deputyId`: design §16.5 defines this column in Version 1,
   * behavior will be bound in Version 2 (§4.5).
   */
  const ALLOWED_VERSION_2_COLUMNS = new Set(["NoActivityPeriod.deputyId"]);

  it("no unexpected Version 2 columns exist", async () => {
    const rows = await testDb.$queryRaw<
      { table_name: string; column_name: string }[]
    >`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          column_name ILIKE '%deputy%' OR
          column_name ILIKE '%delegation%' OR
          column_name ILIKE '%approvalTask%' OR
          column_name ILIKE '%escalation%'
        )
      ORDER BY table_name, column_name
    `;

    const unexpected = rows
      .map((r) => `${r.table_name}.${r.column_name}`)
      .filter((name) => !ALLOWED_VERSION_2_COLUMNS.has(name));

    expect(unexpected).toEqual([]);
  });
});

describe("uniqueness constraints", () => {
  it("cannot register same email twice", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id, { email: "same@example.test" });

    await expect(
      createUser(unit.id, { email: "same@example.test" }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("cannot add same target department to same activity twice", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const activity = await createActivity(user);
    const target = await createOrgUnit({ parentId: unit.id });

    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: target.id },
    });

    await expect(
      testDb.activityTargetDept.create({
        data: { activityId: activity.id, orgUnitId: target.id },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("cannot record same revision number for same activity twice", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const activity = await createActivity(user);

    const revision = {
      activityId: activity.id,
      revisionNo: 1,
      title: activity.title,
      description: activity.description,
      targetOrgUnitIds: [],
      changedById: user.id,
    };

    await testDb.activityRevision.create({ data: revision });

    await expect(
      testDb.activityRevision.create({ data: revision }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("read receipt is single row per user", async () => {
    const unit = await createOrgUnit();
    const author = await createUser(unit.id);
    const reader = await createUser(unit.id);
    const activity = await createActivity(author);

    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: reader.id },
    });

    await expect(
      testDb.readReceipt.create({
        data: { activityId: activity.id, userId: reader.id },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });
});

// §16.6: No physical deletion. Protected by trigger and RESTRICT on foreign keys.
describe("foreign key rules", () => {
  it("deletion-preventing rules defined as RESTRICT", async () => {
    const rules = await testDb.$queryRaw<
      { constraint_name: string; delete_rule: string }[]
    >`
      SELECT rc.constraint_name, rc.delete_rule
      FROM information_schema.referential_constraints rc
      WHERE rc.constraint_schema = 'public'
      ORDER BY rc.constraint_name
    `;

    expect(rules.length).toBeGreaterThan(0);
    const cascading = rules.filter((r) => r.delete_rule !== "RESTRICT");
    expect(cascading).toEqual([]);
  });

  it("database rejects physical user deletion", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    await createActivity(user);

    await expect(testDb.user.delete({ where: { id: user.id } })).rejects.toThrow(
      /PHYSICAL_DELETE_FORBIDDEN/,
    );
  });
});

describe("date and time handling", () => {
  it("stores activity date as date without time zone shift", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    const activity = await createActivity(user, {
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
    });

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });

    expect(stored.activityDate.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });

  it("stores creation time with time zone information", async () => {
    const unit = await createOrgUnit();

    const [column] = await testDb.$queryRaw<{ data_type: string }[]>`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'OrgUnit' AND column_name = 'createdAt'
    `;

    expect(column.data_type).toBe("timestamp with time zone");
    expect(unit.createdAt).toBeInstanceOf(Date);
  });
});

describe("case-insensitive email uniqueness", () => {
  it("cannot register same email with uppercase letters", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id, { email: "manager@example.test" });

    await expect(
      createUser(unit.id, { email: "Manager@Example.Test" }),
    ).rejects.toThrow(/Unique constraint|23505/i);
  });
});
