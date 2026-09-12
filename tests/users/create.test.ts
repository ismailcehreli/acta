import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { login } from "@/server/auth/login";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { sendWelcomeEmail } from "@/server/auth/reset";
import { createUser } from "@/server/users/create";
import { listUsers } from "@/server/users/list";

import { createOrgUnit, createUser as seedUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-17T09:00:00.000Z");
const noWait = async () => {};

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

afterAll(async () => {
  await testDb.$disconnect();
});

const baseInput = {
  fullName: "New User",
  isUnitManager: false,
  isSystemAdmin: false,
  writesActivities: true,
  initialPassword: "initial-password-1",
};

describe("user creation", () => {
  it("created user can log in with initial password", async () => {
    const unit = await createOrgUnit();

    const result = await createUser(testDb, {
      ...baseInput,
      email: "new@example.test",
      orgUnitId: unit.id,
    });

    expect(result.ok).toBe(true);

    const attempt = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: noWait },
      { email: "new@example.test", password: baseInput.initialPassword },
    );
    expect(attempt.ok).toBe(true);
  });

  it("cannot add the same email address twice", async () => {
    const unit = await createOrgUnit();
    await createUser(testDb, {
      ...baseInput,
      email: "duplicate@example.test",
      orgUnitId: unit.id,
    });

    const result = await createUser(testDb, {
      ...baseInput,
      email: "duplicate@example.test",
      orgUnitId: unit.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("duplicate_email");
  });

  it("can assign a second unit manager to a unit", async () => {
    const unit = await createOrgUnit();
    await seedUser(unit.id, { isUnitManager: true });

    const result = await createUser(testDb, {
      ...baseInput,
      email: "second-mgr@example.test",
      orgUnitId: unit.id,
      isUnitManager: true,
    });

    expect(result.ok).toBe(true);
    expect(
      await testDb.user.count({
        where: { orgUnitId: unit.id, isUnitManager: true },
      }),
    ).toBe(2);
  });

  it("cannot create user in an inactive unit", async () => {
    const root = await createOrgUnit();
    const passive = await createOrgUnit({ parentId: root.id, isActive: false });

    const result = await createUser(testDb, {
      ...baseInput,
      email: "inactive-unit@example.test",
      orgUnitId: passive.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_unit");
  });

  it("cannot create user in non-existent unit", async () => {
    const result = await createUser(testDb, {
      ...baseInput,
      email: "nonexistent@example.test",
      orgUnitId: "00000000-0000-0000-0000-000000000000",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unit_not_found");
  });

  it("failed creation leaves no orphaned records", async () => {
    const unit = await createOrgUnit();
    const passive = await createOrgUnit({ parentId: unit.id, isActive: false });

    await createUser(testDb, {
      ...baseInput,
      email: "half-record@example.test",
      orgUnitId: passive.id,
    });

    const stored = await testDb.user.findUnique({
      where: { email: "half-record@example.test" },
    });
    expect(stored).toBeNull();
  });

  it("stores report permissions on user account", async () => {
    const unit = await createOrgUnit();

    const result = await createUser(testDb, {
      ...baseInput,
      email: "reports@example.test",
      orgUnitId: unit.id,
      canViewReports: true,
      canViewScoreReports: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await testDb.user.findUnique({
      where: { id: result.user.id },
      select: { canViewReports: true, canViewScoreReports: true },
    });
    expect(stored).toEqual({
      canViewReports: true,
      canViewScoreReports: true,
    });
  });
});

describe("user management list returns narrow projection", () => {
  it("returns administrative fields only without activity content", async () => {
    const unit = await createOrgUnit({ name: "Workshop" });
    const user = await seedUser(unit.id, {
      fullName: "Department Manager",
      isUnitManager: true,
    });

    await testDb.activity.create({
      data: {
        authorId: user.id,
        authorOrgUnitId: unit.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "CONFIDENTIAL TITLE",
        description: "CONFIDENTIAL DESCRIPTION",
      },
    });

    const users = await listUsers(testDb);

    expect(users).toHaveLength(1);
    expect(Object.keys(users[0]).sort()).toEqual([
      "avatarExtension",
      "canAppreciate",
      "canViewReports",
      "canViewScoreReports",
      "email",
      "fullName",
      "id",
      "isActive",
      "isRoot",
      "isScored",
      "isSystemAdmin",
      "isUnitManager",
      "lastLoginAt",
      "orgUnitId",
      "orgUnitName",
      "title",
      "writesActivities",
    ]);

    const serialized = JSON.stringify(users);
    expect(serialized).not.toContain("CONFIDENTIAL TITLE");
    expect(serialized).not.toContain("CONFIDENTIAL DESCRIPTION");
  });
});

describe("welcome email", () => {
  it("enqueues notification without exposing plaintext password", async () => {
    const unit = await createOrgUnit();
    const result = await createUser(testDb, {
      ...baseInput,
      email: "welcome-user@example.test",
      orgUnitId: unit.id,
      initialPassword: "very-secret-password-9876",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const emailResult = await sendWelcomeEmail(testDb, result.user.id, new Date());
    expect(emailResult.ok).toBe(true);

    const rows = await testDb.notificationQueue.findMany({
      where: { userId: result.user.id, eventType: "account_created" },
    });

    expect(rows).toHaveLength(1);

    const raw = JSON.stringify(rows[0]);
    expect(raw).not.toContain("very-secret-password-9876");
    expect(rows[0]?.payload).toHaveProperty("token");
  });

  it("does not send welcome email to inactive accounts", async () => {
    const unit = await createOrgUnit();
    const result = await createUser(testDb, {
      ...baseInput,
      email: "inactive-welcome@example.test",
      orgUnitId: unit.id,
    });
    if (!result.ok) throw new Error("failed to create user");

    await testDb.user.update({
      where: { id: result.user.id },
      data: { isActive: false },
    });

    const emailResult = await sendWelcomeEmail(testDb, result.user.id, new Date());
    expect(emailResult.ok).toBe(false);
    expect(
      await testDb.notificationQueue.count({
        where: { userId: result.user.id, eventType: "account_created" },
      }),
    ).toBe(0);
  });
});

describe("welcome notification transaction rollback", () => {
  it("rolls back user creation if notification queue insert fails", async () => {
    const unit = await createOrgUnit();

    const failingQueueDb = {
      ...testDb,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        testDb.$transaction((tx) =>
          fn(
            new Proxy(tx, {
              get(target, prop) {
                if (prop === "notificationQueue") {
                  return {
                    createMany: async () => {
                      throw new Error("queue insert failed");
                    },
                  };
                }
                return Reflect.get(target, prop);
              },
            }),
          ),
        )) as typeof testDb.$transaction,
    } as unknown as typeof testDb;

    const result = await createUser(
      failingQueueDb,
      {
        ...baseInput,
        email: "rollback-test@example.test",
        orgUnitId: unit.id,
      },
      null,
      NOW,
      { welcomeEmail: true },
    );

    expect(result.ok).toBe(false);

    const remaining = await testDb.user.findUnique({
      where: { email: "rollback-test@example.test" },
    });
    expect(remaining).toBeNull();
  });

  it("commits user and notification atomically on success", async () => {
    const unit = await createOrgUnit();

    const result = await createUser(
      testDb,
      { ...baseInput, email: "atomic@example.test", orgUnitId: unit.id },
      null,
      NOW,
      { welcomeEmail: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const notification = await testDb.notificationQueue.findFirst({
      where: { userId: result.user.id },
    });
    expect(notification).not.toBeNull();
  });
});
