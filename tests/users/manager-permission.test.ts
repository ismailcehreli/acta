import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Boundaries of Unit Manager user management permissions.
//
// By design, a unit manager has 4 operations in their subtree: add personnel, edit full name and title,
// deactivate user, trigger password reset. All other fields are restricted.
//
// Direct FormData calls are used to verify server-side security enforcement independent of UI forms.

const { session } = vi.hoisted(() => ({
  session: { user: null as { id: string; isSystemAdmin: boolean; isUnitManager: boolean } | null },
}));

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: async () => session.user,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/db", async () => {
  const { testDb } = await import("../helpers/test-db");
  return { prisma: testDb };
});

const { createUserAction, updateUserAction } = await import(
  "@/app/admin/users/actions"
);

import { createUser } from "@/server/users/create";
import { updateUserByManager } from "@/server/users/update";

import { createOrgUnit, createUser as seedUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
  session.user = null;
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Manager, subordinate, and their organization units. */
async function setup() {
  const root = await createOrgUnit({ name: "Company Root" });
  const unit = await createOrgUnit({ name: "Workshop", parentId: root.id });
  const subUnit = await createOrgUnit({ name: "Paint Shop", parentId: unit.id });
  const externalUnit = await createOrgUnit({ name: "Planning", parentId: root.id });

  const manager = await seedUser(unit.id, {
    fullName: "Workshop Manager",
    email: "manager@example.test",
    isUnitManager: true,
  });

  const subordinate = await seedUser(unit.id, {
    fullName: "Workshop Worker",
    email: "subordinate@example.test",
    title: "Toolmaker",
  });

  session.user = { id: manager.id, isSystemAdmin: false, isUnitManager: true };
  return { root, unit, subUnit, externalUnit, manager, subordinate };
}

/**
 * Edit request sent by manager.
 * All standard fields filled so request passes general validation before permission boundary checks.
 */
function updateFormData(
  target: { id: string; email: string; orgUnitId: string },
  overrides: Record<string, string> = {},
): FormData {
  const data = new FormData();
  data.set("id", target.id);
  data.set("fullName", "New Name");
  data.set("title", "New Title");
  data.set("email", target.email);
  data.set("orgUnitId", target.orgUnitId);
  data.set("writesActivities", "on");
  data.set("isScored", "on");
  data.set("canAppreciate", "on");
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

describe("unit manager edit boundaries", () => {
  it("can change full name and title", async () => {
    const { subordinate } = await setup();

    const result = await updateUserAction(
      { error: null, success: null, blockers: null },
      updateFormData(subordinate),
    );

    expect(result.error).toBeNull();

    const updated = await testDb.user.findUniqueOrThrow({ where: { id: subordinate.id } });
    expect(updated.fullName).toBe("New Name");
    expect(updated.title).toBe("New Title");
  });

  it("cannot change email", async () => {
    const { subordinate } = await setup();

    await updateUserAction(
      { error: null, success: null, blockers: null },
      updateFormData(subordinate, { email: "attacker@example.test" }),
    );

    const updated = await testDb.user.findUniqueOrThrow({ where: { id: subordinate.id } });
    expect(updated.email).toBe("subordinate@example.test");
  });

  it("cannot transfer user to another unit", async () => {
    const { subordinate, unit, subUnit } = await setup();

    await updateUserAction(
      { error: null, success: null, blockers: null },
      updateFormData(subordinate, { orgUnitId: subUnit.id }),
    );

    const updated = await testDb.user.findUniqueOrThrow({ where: { id: subordinate.id } });
    expect(updated.orgUnitId).toBe(unit.id);
  });

  it("cannot revoke subordinate's unit manager flag", async () => {
    const { unit } = await setup();
    const subManager = await seedUser(unit.id, {
      fullName: "Sub Manager",
      email: "submanager@example.test",
      isUnitManager: true,
    });

    await updateUserAction(
      { error: null, success: null, blockers: null },
      updateFormData(subManager),
    );

    const updated = await testDb.user.findUniqueOrThrow({
      where: { id: subManager.id },
    });
    expect(updated.isUnitManager).toBe(true);
  });

  it("cannot change score and appreciation flags", async () => {
    const { unit } = await setup();
    const target = await seedUser(unit.id, {
      fullName: "Appreciator",
      email: "appreciator@example.test",
      canAppreciate: true,
    });

    await updateUserAction(
      { error: null, success: null, blockers: null },
      updateFormData(target, { isScored: "off", canAppreciate: "off" }),
    );

    const updated = await testDb.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.isScored).toBe(true);
    expect(updated.canAppreciate).toBe(true);
  });

  it("cannot change activity writing expectation", async () => {
    const { subordinate } = await setup();

    await updateUserAction(
      { error: null, success: null, blockers: null },
      updateFormData(subordinate, { writesActivities: "off" }),
    );

    const updated = await testDb.user.findUniqueOrThrow({ where: { id: subordinate.id } });
    expect(updated.writesActivities).toBe(true);
  });
});

/**
 * Database proxy intercepting execution between scope check and write.
 */
function barrierDb(signalReady: () => void, waitPromise: Promise<void>) {
  let firstRead = true;

  return {
    ...testDb,
    $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
      testDb.$transaction((tx) =>
        fn(
          new Proxy(tx, {
            get(target, prop) {
              if (prop !== "$queryRaw") return Reflect.get(target, prop);

              const original = Reflect.get(target, prop) as (
                ...args: unknown[]
              ) => Promise<unknown>;

              return async (...args: unknown[]) => {
                const result = await original.apply(target, args);
                if (firstRead) {
                  firstRead = false;
                  signalReady();
                  await waitPromise;
                }
                return result;
              };
            },
          }),
        ),
      )) as typeof testDb.$transaction,
  } as unknown as typeof testDb;
}

function barrier() {
  let signalReady = () => {};
  let release = () => {};
  const ready = new Promise<void>((resolve) => (signalReady = resolve));
  const waitPromise = new Promise<void>((resolve) => (release = resolve));
  return { db: barrierDb(() => signalReady(), waitPromise), ready, release: () => release() };
}

describe("manager updates are race-condition resilient", () => {
  const newName = { fullName: "New Name", title: "New Title" };

  it("rejects update if target unit is moved out of scope after scope read", async () => {
    const { unit, subUnit, root, manager } = await setup();
    const target = await seedUser(subUnit.id, {
      fullName: "Subunit Worker",
      email: "subunit@example.test",
    });

    const { db, ready, release } = barrier();
    const updateCall = updateUserByManager(db, { id: target.id, ...newName }, manager.id);

    await ready;
    await testDb.orgUnit.update({
      where: { id: subUnit.id },
      data: { parentId: root.id },
    });
    release();

    const result = await updateCall;
    expect(result.ok).toBe(false);

    const updated = await testDb.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.fullName).toBe("Subunit Worker");
    expect(updated.orgUnitId).not.toBe(unit.id);
  });

  it("rejects update if manager status is revoked after scope read", async () => {
    const { subordinate, manager } = await setup();

    const { db, ready, release } = barrier();
    const updateCall = updateUserByManager(db, { id: subordinate.id, ...newName }, manager.id);

    await ready;
    await testDb.user.update({
      where: { id: manager.id },
      data: { isUnitManager: false },
    });
    release();

    const result = await updateCall;
    expect(result.ok).toBe(false);

    const updated = await testDb.user.findUniqueOrThrow({ where: { id: subordinate.id } });
    expect(updated.fullName).toBe("Workshop Worker");
  });

  it("row read for audit logging is locked against concurrent mutations", async () => {
    const { subordinate, manager } = await setup();

    const { db, ready, release } = barrier();
    const updateCall = updateUserByManager(db, { id: subordinate.id, ...newName }, manager.id);

    await ready;

    const concurrentUpdate = testDb.user.update({
      where: { id: subordinate.id },
      data: { fullName: "Concurrent Writer" },
    });

    const race = await Promise.race([
      concurrentUpdate.then(() => "passed" as const),
      new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), 400)),
    ]);
    expect(race).toBe("waited");

    release();
    const result = await updateCall;
    expect(result.ok).toBe(true);
    await concurrentUpdate;

    const logEntry = await testDb.auditLog.findFirst({
      where: { objectId: subordinate.id, userId: manager.id },
      orderBy: { createdAt: "desc" },
    });
    const details = logEntry?.detail as {
      before?: { fullName?: string };
      after?: { fullName?: string };
    };
    expect(details.before?.fullName).toBe("Workshop Worker");
    expect(details.after?.fullName).toBe("New Name");
  });

  it("cannot update user outside scope directly from service", async () => {
    const { externalUnit, manager } = await setup();
    const externalUser = await seedUser(externalUnit.id, {
      fullName: "Planner",
      email: "planner@example.test",
    });

    const result = await updateUserByManager(
      testDb,
      { id: externalUser.id, ...newName },
      manager.id,
    );

    expect(result.ok).toBe(false);
    const updated = await testDb.user.findUniqueOrThrow({ where: { id: externalUser.id } });
    expect(updated.fullName).toBe("Planner");
  });

  it("manager cannot update their own account directly from service", async () => {
    const { manager } = await setup();

    const result = await updateUserByManager(
      testDb,
      { id: manager.id, ...newName },
      manager.id,
    );

    expect(result.ok).toBe(false);
    const updated = await testDb.user.findUniqueOrThrow({ where: { id: manager.id } });
    expect(updated.fullName).toBe("Workshop Manager");
  });

  it("cannot update target if target is a system admin", async () => {
    const { unit, manager } = await setup();
    const subordinateAdmin = await seedUser(unit.id, {
      fullName: "Subordinate Admin",
      email: "subadmin@example.test",
      isSystemAdmin: true,
    });

    const result = await updateUserByManager(
      testDb,
      { id: subordinateAdmin.id, ...newName },
      manager.id,
    );

    expect(result.ok).toBe(false);
    const updated = await testDb.user.findUniqueOrThrow({ where: { id: subordinateAdmin.id } });
    expect(updated.fullName).toBe("Subordinate Admin");
  });
});

describe("unit manager user creation boundaries", () => {
  it("cannot set password directly; user must initialize via reset link", async () => {
    const { unit } = await setup();

    const data = new FormData();
    data.set("fullName", "New Personnel");
    data.set("title", "Toolmaker");
    data.set("email", "newperson@example.test");
    data.set("orgUnitId", unit.id);
    data.set("initialPassword", "manager-known-password");

    const result = await createUserAction(
      { error: null, success: null, blockers: null },
      data,
    );
    expect(result.error).toBeNull();

    const created = await testDb.user.findUniqueOrThrow({
      where: { email: "newperson@example.test" },
      include: { credential: true },
    });
    expect(created.title).toBe("Toolmaker");

    const isMatch = await (
      await import("@/server/auth/password")
    ).verifyPassword("manager-known-password", created.credential!.passwordHash);
    expect(isMatch).toBe(false);

    const notification = await testDb.notificationQueue.findFirst({
      where: { userId: created.id },
    });
    expect(notification).not.toBeNull();
  });

  it("created personnel is configured to write activities and participate in scoring", async () => {
    const { unit } = await setup();

    const data = new FormData();
    data.set("fullName", "Standard Personnel");
    data.set("email", "standard@example.test");
    data.set("orgUnitId", unit.id);

    await createUserAction({ error: null, success: null, blockers: null }, data);

    const created = await testDb.user.findUniqueOrThrow({
      where: { email: "standard@example.test" },
    });

    expect(created.writesActivities).toBe(true);
    expect(created.isScored).toBe(true);
    expect(created.canAppreciate).toBe(false);
  });

  it("manually crafted form requests cannot override default flags", async () => {
    const { unit } = await setup();

    const data = new FormData();
    data.set("fullName", "Hostile Request");
    data.set("email", "hostile@example.test");
    data.set("orgUnitId", unit.id);
    data.set("writesActivities", "off");
    data.set("isScored", "off");
    data.set("canAppreciate", "on");

    await createUserAction({ error: null, success: null, blockers: null }, data);

    const created = await testDb.user.findUniqueOrThrow({
      where: { email: "hostile@example.test" },
    });
    expect(created.writesActivities).toBe(true);
    expect(created.isScored).toBe(true);
    expect(created.canAppreciate).toBe(false);
  });

  it("manager cannot grant administrative roles", async () => {
    const { unit } = await setup();

    const data = new FormData();
    data.set("fullName", "Role Seeker");
    data.set("email", "roleseeker@example.test");
    data.set("orgUnitId", unit.id);
    data.set("isSystemAdmin", "on");
    data.set("isUnitManager", "on");
    data.set("initialPassword", "initial-password-1");

    await createUserAction({ error: null, success: null, blockers: null }, data);

    const created = await testDb.user.findUniqueOrThrow({
      where: { email: "roleseeker@example.test" },
    });
    expect(created.isSystemAdmin).toBe(false);
    expect(created.isUnitManager).toBe(false);
  });
});

describe("manager user creation scope enforced at service level", () => {
  it("cannot create user in unit outside scope directly via service", async () => {
    const { externalUnit, manager } = await setup();

    const result = await createUser(
      testDb,
      {
        fullName: "Out of Scope User",
        email: "outofscope@example.test",
        orgUnitId: externalUnit.id,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: "initial-password-1",
      },
      manager.id,
      new Date(),
      { managerScope: { actorId: manager.id } },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("out_of_scope");

    const remaining = await testDb.user.findUnique({
      where: { email: "outofscope@example.test" },
    });
    expect(remaining).toBeNull();
  });

  it("revoked manager cannot create user", async () => {
    const { unit, manager } = await setup();

    await testDb.user.update({
      where: { id: manager.id },
      data: { isUnitManager: false },
    });

    const result = await createUser(
      testDb,
      {
        fullName: "Unauthorized Creation",
        email: "unauthorized@example.test",
        orgUnitId: unit.id,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: "initial-password-1",
      },
      manager.id,
      new Date(),
      { managerScope: { actorId: manager.id } },
    );

    expect(result.ok).toBe(false);
    const remaining = await testDb.user.findUnique({
      where: { email: "unauthorized@example.test" },
    });
    expect(remaining).toBeNull();
  });
});

describe("manager creation protected by tree advisory lock", () => {
  it("unit transfer blocks on advisory lock after scope read", async () => {
    const { root, subUnit, manager } = await setup();

    const { db, ready, release } = barrier();

    const createCall = createUser(
      db,
      {
        fullName: "Lock Test User",
        email: "locktest@example.test",
        orgUnitId: subUnit.id,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: "initial-password-1",
      },
      manager.id,
      new Date(),
      { managerScope: { actorId: manager.id } },
    );

    await ready;

    const moveUnit = testDb.orgUnit.update({
      where: { id: subUnit.id },
      data: { parentId: root.id },
    });

    const race = await Promise.race([
      moveUnit.then(() => "passed" as const),
      new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), 400)),
    ]);

    expect(race).toBe("waited");

    release();

    const result = await createCall;
    expect(result.ok).toBe(true);
    await moveUnit;

    const created = await testDb.user.findUnique({
      where: { email: "locktest@example.test" },
    });
    expect(created).not.toBeNull();
  });
});
