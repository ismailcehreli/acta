import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, updateActivity } from "@/server/activities/write";
import { cancelActivity } from "@/server/activities/cancel";
import { AUDIT_ACTIONS, AUDIT_OBJECTS } from "@/server/audit/log";
import { changePassword } from "@/server/auth/change-password";
import { login } from "@/server/auth/login";
import { requestPasswordReset, resetPassword } from "@/server/auth/reset";
import { addHoliday, removeHoliday, saveWorkCalendar } from "@/server/calendar/settings";
import { DEFAULT_WORK_CALENDAR } from "@/server/calendar/settings";
import {
  askQuestion,
  closeConversation,
  replyToConversation,
} from "@/server/conversations/service";
import {
  createOrgUnit,
  deactivateOrgUnit,
  moveOrgUnit,
  reactivateOrgUnit,
  updateOrgUnit,
} from "@/server/org/tree";
import { saveSmtpSettings } from "@/server/settings/smtp";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";
import { createUser } from "@/server/users/create";
import { deactivateUser, reactivateUser } from "@/server/users/deactivate";
import { setUserPassword, updateUser } from "@/server/users/update";

import { resetDatabase, testDb } from "../helpers/test-db";

// Audit log (§15.2). Tests that records are created for all operations,
// records are immutable, and read queries remain excluded (§10.3).

const NOW = new Date("2026-08-18T09:00:00.000Z");
const PASSWORD = "test-password-1234";
const SECRET = "test-secret-at-least-thirty-two-chars-long";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function getAuditLogs(action?: string) {
  return testDb.auditLog.findMany({
    where: action ? { action } : undefined,
    orderBy: { createdAt: "asc" },
  });
}

async function setupCompany() {
  const root = await createOrgUnit(
    testDb,
    { name: "Company", type: "Root", parentId: null, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
    null,
    NOW,
  );
  if (!root.ok) throw new Error("setup failed");

  const admin = await createUser(
    testDb,
    {
      fullName: "System Administrator",
      email: "admin@example.test",
      orgUnitId: root.value.id,
      isUnitManager: true,
      isSystemAdmin: true,
      writesActivities: true,
      initialPassword: PASSWORD,
    },
    null,
    NOW,
  );
  if (!admin.ok) throw new Error("setup failed");

  return { root: root.value, admin: admin.user };
}

describe("organization and user operations", () => {
  it("unit creation, movement, and deactivation are logged", async () => {
    const { root, admin } = await setupCompany();

    const subUnit = await createOrgUnit(
      testDb,
      { name: "Tooling Shop", type: "Department", parentId: root.id, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
      admin.id,
      NOW,
    );
    if (!subUnit.ok) throw new Error("setup failed");

    const interUnit = await createOrgUnit(
      testDb,
      { name: "Headquarters", type: "GM", parentId: root.id, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
      admin.id,
      NOW,
    );
    if (!interUnit.ok) throw new Error("setup failed");

    await moveOrgUnit(testDb, { id: subUnit.value.id, newParentId: interUnit.value.id }, admin.id, NOW);
    await deactivateOrgUnit(testDb, subUnit.value.id, admin.id, NOW);

    expect(await getAuditLogs(AUDIT_ACTIONS.orgUnitCreated)).toHaveLength(3);
    const moveLogs = await getAuditLogs(AUDIT_ACTIONS.orgUnitMoved);
    expect(moveLogs).toHaveLength(1);
    expect(moveLogs[0].detail).toEqual({
      fromParentId: root.id,
      toParentId: interUnit.value.id,
    });
    expect(await getAuditLogs(AUDIT_ACTIONS.orgUnitDeactivated)).toHaveLength(1);
  });

  it("unit and user reactivation are logged", async () => {
    const { root, admin } = await setupCompany();

    const unit = await createOrgUnit(
      testDb,
      {
        name: "Closed Unit",
        type: "Team",
        parentId: root.id,
        sortOrder: 0,
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
      admin.id,
      NOW,
    );
    if (!unit.ok) throw new Error("setup failed");

    await deactivateOrgUnit(testDb, unit.value.id, admin.id, NOW);
    await reactivateOrgUnit(testDb, unit.value.id, admin.id, NOW);

    const unitLogs = await getAuditLogs(AUDIT_ACTIONS.orgUnitReactivated);
    expect(unitLogs).toHaveLength(1);
    expect(unitLogs[0].userId).toBe(admin.id);

    const user = await createUser(testDb, {
      fullName: "Returning User",
      email: "returning@example.test",
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: "initial-password-1234",
    });
    if (!user.ok) throw new Error("setup failed");

    await deactivateUser(testDb, user.user.id, NOW, admin.id);
    await reactivateUser(testDb, user.user.id, NOW, admin.id);

    const userLogs = await getAuditLogs(AUDIT_ACTIONS.userReactivated);
    expect(userLogs).toHaveLength(1);
    expect(userLogs[0].userId).toBe(admin.id);
    expect(userLogs[0].objectId).toBe(user.user.id);
  });

  it("unit updates are logged recording only changed fields", async () => {
    const { root, admin } = await setupCompany();

    const unit = await createOrgUnit(
      testDb,
      {
        name: "Wrong Name",
        type: "Team",
        parentId: root.id,
        sortOrder: 0,
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
      admin.id,
      NOW,
    );
    if (!unit.ok) throw new Error("setup failed");

    await updateOrgUnit(
      testDb,
      {
        id: unit.value.id,
        name: "Tooling Shop",
        type: "Team",
        requiresApproval: true,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
      admin.id,
      NOW,
    );

    const logs = await getAuditLogs(AUDIT_ACTIONS.orgUnitUpdated);
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(admin.id);
    // Unchanged fields are not logged.
    expect(logs[0].detail).toEqual({
      changed: {
        name: { before: "Wrong Name", after: "Tooling Shop" },
        requiresApproval: { before: false, after: true },
      },
    });
  });

  it("no log is recorded if no fields changed", async () => {
    const { root, admin } = await setupCompany();

    const unit = await createOrgUnit(
      testDb,
      {
        name: "Tooling Shop",
        type: "Department",
        parentId: root.id,
        sortOrder: 0,
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
      admin.id,
      NOW,
    );
    if (!unit.ok) throw new Error("setup failed");

    const result = await updateOrgUnit(
      testDb,
      {
        id: unit.value.id,
        name: "Tooling Shop",
        type: "Department",
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
      admin.id,
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(await getAuditLogs(AUDIT_ACTIONS.orgUnitUpdated)).toHaveLength(0);
  });

  it("user creation, update, password set, and deactivation are logged", async () => {
    const { root, admin } = await setupCompany();

    const user = await createUser(
      testDb,
      {
        fullName: "Test User",
        email: "user@example.test",
        orgUnitId: root.id,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: PASSWORD,
      },
      admin.id,
      NOW,
    );
    if (!user.ok) throw new Error("setup failed");

    await updateUser(
      testDb,
      {
        id: user.user.id,
        fullName: "New Name",
        email: "new@example.test",
        orgUnitId: root.id,
        isUnitManager: false,
        isSystemAdmin: true,
        writesActivities: true,
      },
      admin.id,
      NOW,
    );

    await setUserPassword(testDb, user.user.id, "new-password-5678", NOW, admin.id);
    await deactivateUser(testDb, user.user.id, NOW, admin.id);

    // Initial admin plus this user = 2 creation logs.
    expect(await getAuditLogs(AUDIT_ACTIONS.userCreated)).toHaveLength(2);

    const updateLogs = await getAuditLogs(AUDIT_ACTIONS.userUpdated);
    expect(updateLogs).toHaveLength(1);
    // Permission changes show old and new states (§15.2).
    const detail = updateLogs[0].detail as {
      before: { isSystemAdmin: boolean };
      after: { isSystemAdmin: boolean };
    };
    expect(detail.before.isSystemAdmin).toBe(false);
    expect(detail.after.isSystemAdmin).toBe(true);

    expect(await getAuditLogs(AUDIT_ACTIONS.userPasswordSet)).toHaveLength(1);
    expect(await getAuditLogs(AUDIT_ACTIONS.userDeactivated)).toHaveLength(1);
  });

  it("passwords are never logged in plain text", async () => {
    const { root, admin } = await setupCompany();
    const user = await createUser(
      testDb,
      {
        fullName: "Test User",
        email: "user@example.test",
        orgUnitId: root.id,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: "very-secret-password-9999",
      },
      admin.id,
      NOW,
    );
    if (!user.ok) throw new Error("setup failed");

    await setUserPassword(testDb, user.user.id, "other-secret-password-8888", NOW, admin.id);

    const allLogsJson = JSON.stringify(await getAuditLogs());
    expect(allLogsJson).not.toContain("very-secret-password-9999");
    expect(allLogsJson).not.toContain("other-secret-password-8888");
  });
});

describe("activity and conversation operations", () => {
  async function setupWithActivity() {
    const { root, admin } = await setupCompany();
    const department = await createOrgUnit(
      testDb,
      { name: "Tooling Shop", type: "Department", parentId: root.id, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
      admin.id,
      NOW,
    );
    if (!department.ok) throw new Error("setup failed");

    const author = await createUser(
      testDb,
      {
        fullName: "Shop Manager",
        email: "manager@example.test",
        orgUnitId: department.value.id,
        isUnitManager: true,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: PASSWORD,
      },
      admin.id,
      NOW,
    );
    if (!author.ok) throw new Error("setup failed");

    const activity = await createActivity(
      testDb,
      { id: author.user.id, orgUnitId: department.value.id, requiresApproval: false },
      {
        activityDate: "2026-08-18",
        title: "Mold maintenance",
        description: "Molds on the press cleaned.",
        targetDepartmentIds: [department.value.id],
      },
      NOW,
    );
    if (!activity.ok) throw new Error("setup failed");

    return { admin, author: author.user, activity: activity.activity, department: department.value };
  }

  it("activity creation and revision are logged", async () => {
    const { author, activity, department } = await setupWithActivity();

    expect(await getAuditLogs(AUDIT_ACTIONS.activityCreated)).toHaveLength(1);

    await updateActivity(
      testDb,
      author.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Mold maintenance — revised",
        description: "Molds cleaned and measured.",
        targetDepartmentIds: [department.id],
      },
      new Date(NOW.getTime() + 60_000),
    );

    const revisedLogs = await getAuditLogs(AUDIT_ACTIONS.activityRevised);
    expect(revisedLogs).toHaveLength(1);
    expect(revisedLogs[0].objectType).toBe(AUDIT_OBJECTS.activity);
    expect(revisedLogs[0].userId).toBe(author.id);
  });

  it("conversation opening, reply, and closing are logged", async () => {
    const { admin, author, activity } = await setupWithActivity();

    const question = await askQuestion(
      testDb,
      { id: admin.id, isSystemAdmin: true },
      { activityId: activity.id, text: "What is the status?" },
      NOW,
    );
    if (!question.ok) throw new Error(`question: ${question.message}`);

    await replyToConversation(
      testDb,
      { id: author.id, isSystemAdmin: false },
      { conversationId: question.value.id, text: "Completed." },
      new Date(NOW.getTime() + 60_000),
    );

    await closeConversation(
      testDb,
      { id: admin.id, isSystemAdmin: true },
      question.value.id,
      new Date(NOW.getTime() + 120_000),
    );

    expect(await getAuditLogs(AUDIT_ACTIONS.conversationOpened)).toHaveLength(1);
    expect(await getAuditLogs(AUDIT_ACTIONS.conversationReplied)).toHaveLength(1);
    expect(await getAuditLogs(AUDIT_ACTIONS.conversationClosed)).toHaveLength(1);
  });

  it("cancellation is logged but reason text is excluded from trail", async () => {
    const { author, activity } = await setupWithActivity();

    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      "Entered on wrong day.",
      new Date(NOW.getTime() + 60_000),
    );

    const cancelLogs = await getAuditLogs(AUDIT_ACTIONS.activityCancelled);
    expect(cancelLogs).toHaveLength(1);
    // Cancellation reason is not in audit log: system admin sees the audit log
    // but does not have access to activity content (§15.1).
    expect(JSON.stringify(cancelLogs[0].detail)).not.toContain("Entered on wrong day.");
  });
});

describe("session attempts (§15.3)", () => {
  it("successful login is logged", async () => {
    const { admin } = await setupCompany();

    const result = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: async () => undefined },
      { email: admin.email, password: PASSWORD },
    );
    expect(result.ok).toBe(true);

    const logs = await getAuditLogs(AUDIT_ACTIONS.loginSucceeded);
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(admin.id);
    expect(logs[0].ipAddress).toBe("10.0.0.1");
  });

  it("wrong password is logged", async () => {
    const { admin } = await setupCompany();

    await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.2", sleep: async () => undefined },
      { email: admin.email, password: "wrong-password-1234" },
    );

    const logs = await getAuditLogs(AUDIT_ACTIONS.loginFailed);
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(admin.id);
    expect((logs[0].detail as { reason: string }).reason).toBe("wrong_password");
  });

  it("unregistered email attempt is logged", async () => {
    await setupCompany();

    await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.3", sleep: async () => undefined },
      { email: "does-not-exist@example.test", password: "test-password-1234" },
    );

    const logs = await getAuditLogs(AUDIT_ACTIONS.loginFailed);
    expect(logs).toHaveLength(1);
    // User is unknown; attempted email address is stored in detail.
    expect(logs[0].userId).toBeNull();
    expect((logs[0].detail as { email: string }).email).toBe("does-not-exist@example.test");
  });

  it("lockout is logged", async () => {
    const { admin } = await setupCompany();

    for (let i = 0; i < 10; i += 1) {
      await login(
        { db: testDb, now: NOW, rateLimitKey: `10.0.1.${i}`, sleep: async () => undefined },
        { email: admin.email, password: "wrong-password-1234" },
      );
    }

    expect(await getAuditLogs(AUDIT_ACTIONS.loginLocked)).toHaveLength(1);
  });

  it("password change and reset are logged", async () => {
    const { admin } = await setupCompany();

    await changePassword(
      { db: testDb, now: NOW },
      { userId: admin.id, currentPassword: PASSWORD, newPassword: "new-password-5678" },
    );
    expect(await getAuditLogs(AUDIT_ACTIONS.userPasswordChanged)).toHaveLength(1);

    await requestPasswordReset(testDb, admin.email, NOW, SECRET);
    const queueItem = await testDb.notificationQueue.findFirstOrThrow({
      where: { eventType: "password_reset" },
    });
    const token = (queueItem.payload as { token: string }).token;

    await resetPassword(testDb, token, "reset-password-9999", NOW, SECRET);
    expect(await getAuditLogs(AUDIT_ACTIONS.userPasswordReset)).toHaveLength(1);
  });
});

describe("settings changes (§16.5)", () => {
  it("system setting change is logged with previous and new values", async () => {
    const { admin } = await setupCompany();

    await saveSettings(
      testDb,
      { [SETTING_KEYS.overdueAnswerBusinessDays]: "5" },
      admin.id,
      NOW,
    );

    const logs = await getAuditLogs(AUDIT_ACTIONS.settingsChanged);
    expect(logs).toHaveLength(1);
    const detail = logs[0].detail as {
      changed: { key: string; before: string; after: string }[];
    };
    expect(detail.changed[0]).toEqual({
      key: SETTING_KEYS.overdueAnswerBusinessDays,
      before: "3",
      after: "5",
    });
  });

  it("no log is recorded if settings do not change", async () => {
    const { admin } = await setupCompany();

    await saveSettings(
      testDb,
      { [SETTING_KEYS.overdueAnswerBusinessDays]: "3" },
      admin.id,
      NOW,
    );

    expect(await getAuditLogs(AUDIT_ACTIONS.settingsChanged)).toHaveLength(0);
  });

  it("calendar, holiday, and SMTP changes are logged", async () => {
    const { admin } = await setupCompany();

    await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR, admin.id, NOW);
    await addHoliday(testDb, { date: "2026-12-31", description: "New Year" }, admin.id, NOW);
    await removeHoliday(testDb, "2026-12-31", admin.id, NOW);
    await saveSmtpSettings(
      testDb,
      {
        host: "mail.example.test",
        port: 587,
        secure: false,
        user: "activity",
        from: "activity@example.test",
        password: "secret-smtp-password",
      },
      SECRET,
      admin.id,
      NOW,
    );

    expect(await getAuditLogs(AUDIT_ACTIONS.workCalendarChanged)).toHaveLength(1);
    expect(await getAuditLogs(AUDIT_ACTIONS.holidayAdded)).toHaveLength(1);
    expect(await getAuditLogs(AUDIT_ACTIONS.holidayRemoved)).toHaveLength(1);

    const smtpLogs = await getAuditLogs(AUDIT_ACTIONS.smtpChanged);
    expect(smtpLogs).toHaveLength(1);
    // SMTP password is never logged; only that it was changed.
    expect(JSON.stringify(smtpLogs[0].detail)).not.toContain("secret-smtp-password");
    expect((smtpLogs[0].detail as { passwordChanged: boolean }).passwordChanged).toBe(true);
  });
});

describe("record immutability (§15.2)", () => {
  it("audit log record cannot be updated or deleted", async () => {
    const { admin } = await setupCompany();
    const log = await testDb.auditLog.findFirstOrThrow();

    await expect(
      testDb.auditLog.update({
        where: { id: log.id },
        data: { action: "modified" },
      }),
    ).rejects.toThrow(/AUDIT_LOG_IMMUTABLE|no_update/i);

    await expect(
      testDb.auditLog.delete({ where: { id: log.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);

    expect(admin.id).toBeTruthy();
  });
});

describe("read queries excluded from audit log (§10.3)", () => {
  it("reading activity does not produce audit log", async () => {
    const { root, admin } = await setupCompany();
    const department = await createOrgUnit(
      testDb,
      { name: "Tooling Shop", type: "Department", parentId: root.id, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
      admin.id,
      NOW,
    );
    if (!department.ok) throw new Error("setup failed");

    const author = await createUser(
      testDb,
      {
        fullName: "Manager",
        email: "manager@example.test",
        orgUnitId: department.value.id,
        isUnitManager: true,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: PASSWORD,
      },
      admin.id,
      NOW,
    );
    if (!author.ok) throw new Error("setup failed");

    const activity = await createActivity(
      testDb,
      { id: author.user.id, orgUnitId: department.value.id, requiresApproval: false },
      {
        activityDate: "2026-08-18",
        title: "Mold maintenance",
        description: "Description",
        targetDepartmentIds: [department.value.id],
      },
      NOW,
    );
    if (!activity.ok) throw new Error("setup failed");

    const previousCount = (await getAuditLogs()).length;

    const { markActivityAsRead } = await import("@/server/reads/service");
    await markActivityAsRead(
      testDb,
      { id: admin.id, isSystemAdmin: true },
      activity.activity.id,
      5_000,
      NOW,
    );

    // Read status is an indicator, not a forensic record (§10.3).
    expect((await getAuditLogs()).length).toBe(previousCount);
  });
});

describe("audit log carries no content (§15.1)", () => {
  // Audit log is viewed by system admin; system admin has no content access.
  // Titles, descriptions, reasons, or message texts must not be logged in detail field.
  it("activity title, description, and message text are never logged", async () => {
    const { root, admin } = await setupCompany();
    const department = await createOrgUnit(
      testDb,
      { name: "Tooling Shop", type: "Department", parentId: root.id, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
      admin.id,
      NOW,
    );
    if (!department.ok) throw new Error("setup failed");

    const author = await createUser(
      testDb,
      {
        fullName: "Manager",
        email: "manager@example.test",
        orgUnitId: department.value.id,
        isUnitManager: true,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: PASSWORD,
      },
      admin.id,
      NOW,
    );
    if (!author.ok) throw new Error("setup failed");

    const SECRET_TITLE = "SECRETTITLE-customer-complaint";
    const SECRET_DESCRIPTION = "SECRETDESCRIPTION-scrap-rate-on-line";
    const SECRET_MESSAGE = "SECRETMESSAGE-why-is-this-unanswered";
    const SECRET_REASON = "SECRETREASON-entered-incorrectly";

    const activity = await createActivity(
      testDb,
      { id: author.user.id, orgUnitId: department.value.id, requiresApproval: false },
      {
        activityDate: "2026-08-18",
        title: SECRET_TITLE,
        description: SECRET_DESCRIPTION,
        targetDepartmentIds: [department.value.id],
      },
      NOW,
    );
    if (!activity.ok) throw new Error("setup failed");

    const question = await askQuestion(
      testDb,
      { id: admin.id, isSystemAdmin: true },
      { activityId: activity.activity.id, text: SECRET_MESSAGE },
      NOW,
    );
    if (!question.ok) throw new Error("setup failed");

    await cancelActivity(
      testDb,
      { id: author.user.id, isSystemAdmin: false },
      activity.activity.id,
      SECRET_REASON,
      new Date(NOW.getTime() + 60_000),
    );

    const allLogsJson = JSON.stringify(await getAuditLogs());
    for (const secret of [SECRET_TITLE, SECRET_DESCRIPTION, SECRET_MESSAGE, SECRET_REASON]) {
      expect(allLogsJson, `"${secret}" leaked into audit log`).not.toContain(secret);
    }

    expect((await getAuditLogs()).length).toBeGreaterThan(3);
  });
});
