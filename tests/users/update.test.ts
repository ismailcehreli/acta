import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { createUser } from "@/server/users/create";
import { deactivateUser } from "@/server/users/deactivate";
import {
  canDeactivate,
  setUserPassword,
  updateRootSelf,
  updateUser,
} from "@/server/users/update";

import { createOrgUnit } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// User updates and administrative password management (§4.6, §15.1).
//
// Critical guards prevent non-recoverable states:
// - Last system administrator permission cannot be revoked.
// - Users cannot deactivate their own accounts.

const NOW = new Date("2026-08-18T12:00:00.000Z");
const OLD_PASSWORD = "old-password-1234";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function createUserHelper(
  email: string,
  orgUnitId: string,
  overrides: {
    isUnitManager?: boolean;
    isSystemAdmin?: boolean;
    writesActivities?: boolean;
  } = {},
) {
  const result = await createUser(testDb, {
    fullName: `User ${email}`,
    email,
    orgUnitId,
    isUnitManager: overrides.isUnitManager ?? false,
    isSystemAdmin: overrides.isSystemAdmin ?? false,
    writesActivities: overrides.writesActivities ?? true,
    initialPassword: OLD_PASSWORD,
  });
  if (!result.ok) throw new Error(`setup: ${result.message}`);
  return result.user;
}

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const workshop = await createOrgUnit({ name: "Workshop", parentId: root.id });
  return { root, workshop };
}

describe("user information updates", () => {
  it("updates name, email, and organization unit", async () => {
    const { root, workshop } = await setupCompany();
    const user = await createUserHelper("old@example.test", root.id);

    const result = await updateUser(testDb, {
      id: user.id,
      fullName: "New Name",
      email: "NEW@example.test",
      orgUnitId: workshop.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.fullName).toBe("New Name");
    // Email normalized to lowercase; internal ID preserved (§15.3).
    expect(result.user.email).toBe("new@example.test");
    expect(result.user.id).toBe(user.id);
    expect(result.user.orgUnitId).toBe(workshop.id);
  });

  it("cannot take an email already in use by another user", async () => {
    const { root } = await setupCompany();
    await createUserHelper("first@example.test", root.id);
    const second = await createUserHelper("second@example.test", root.id);

    const result = await updateUser(testDb, {
      id: second.id,
      fullName: "Second User",
      email: "first@example.test",
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("duplicate_email");
  });

  it("can assign a second unit manager to a unit", async () => {
    const { root, workshop } = await setupCompany();
    await createUserHelper("manager@example.test", workshop.id, { isUnitManager: true });
    const other = await createUserHelper("other@example.test", root.id);

    const result = await updateUser(testDb, {
      id: other.id,
      fullName: "Other Manager",
      email: "other@example.test",
      orgUnitId: workshop.id,
      isUnitManager: true,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(result.ok).toBe(true);
    expect(
      await testDb.user.count({
        where: { orgUnitId: workshop.id, isUnitManager: true },
      }),
    ).toBe(2);
  });

  it("rejects non-existent organization unit", async () => {
    const { root } = await setupCompany();
    const user = await createUserHelper("user@example.test", root.id);

    const result = await updateUser(testDb, {
      id: user.id,
      fullName: "User",
      email: "user@example.test",
      orgUnitId: "11111111-1111-4111-8111-111111111111",
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unit_not_found");
  });

  it("cannot attach active user to an inactive unit", async () => {
    const { root } = await setupCompany();
    const inactiveUnit = await createOrgUnit({ name: "Closed Unit", parentId: root.id });
    await testDb.orgUnit.update({ where: { id: inactiveUnit.id }, data: { isActive: false } });
    const user = await createUserHelper("user@example.test", root.id);

    const result = await updateUser(testDb, {
      id: user.id,
      fullName: "User",
      email: "user@example.test",
      orgUnitId: inactiveUnit.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_unit");
  });
});

describe("last system administrator protection", () => {
  it("cannot revoke admin role of sole system administrator", async () => {
    const { root } = await setupCompany();
    const admin = await createUserHelper("admin@example.test", root.id, {
      isSystemAdmin: true,
    });

    const result = await updateUser(testDb, {
      id: admin.id,
      fullName: "Admin",
      email: "admin@example.test",
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("last_system_admin");

    const current = await testDb.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(current.isSystemAdmin).toBe(true);
  });

  it("can revoke admin role when another system administrator exists", async () => {
    const { root, workshop } = await setupCompany();
    const admin = await createUserHelper("admin@example.test", root.id, {
      isSystemAdmin: true,
    });
    await createUserHelper("admin2@example.test", workshop.id, { isSystemAdmin: true });

    const result = await updateUser(testDb, {
      id: admin.id,
      fullName: "Admin",
      email: "admin@example.test",
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(result.ok).toBe(true);
  });

  it("inactive administrators do not count towards active admin quorum", async () => {
    const { root, workshop } = await setupCompany();
    const admin = await createUserHelper("admin@example.test", root.id, {
      isSystemAdmin: true,
    });
    const inactiveAdmin = await createUserHelper("former-admin@example.test", workshop.id, {
      isSystemAdmin: true,
    });
    await testDb.user.update({
      where: { id: inactiveAdmin.id },
      data: { isActive: false },
    });

    const result = await updateUser(testDb, {
      id: admin.id,
      fullName: "Admin",
      email: "admin@example.test",
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(result.ok).toBe(false);
  });
});

describe("deactivation protection", () => {
  it("user cannot deactivate their own account", async () => {
    const { root } = await setupCompany();
    const admin = await createUserHelper("admin@example.test", root.id, {
      isSystemAdmin: true,
    });

    const check = await canDeactivate(testDb, admin.id, admin.id);

    expect(check.allowed).toBe(false);
    if (check.allowed) return;
    expect(check.message).toBeDefined();
  });

  it("sole system administrator cannot be deactivated", async () => {
    const { root, workshop } = await setupCompany();
    const admin = await createUserHelper("admin@example.test", root.id, {
      isSystemAdmin: true,
    });
    const other = await createUserHelper("other@example.test", workshop.id);

    const check = await canDeactivate(testDb, other.id, admin.id);

    expect(check.allowed).toBe(false);
  });

  it("administrator can be deactivated when another administrator exists", async () => {
    const { root, workshop } = await setupCompany();
    const admin = await createUserHelper("admin@example.test", root.id, {
      isSystemAdmin: true,
    });
    const admin2 = await createUserHelper("admin2@example.test", workshop.id, {
      isSystemAdmin: true,
    });

    const check = await canDeactivate(testDb, admin2.id, admin.id);
    expect(check.allowed).toBe(true);

    const result = await deactivateUser(testDb, admin.id, NOW);
    expect(result.ok).toBe(true);
  });
});

describe("administrative password reset", () => {
  it("activates new password and invalidates previous password", async () => {
    const { root } = await setupCompany();
    const user = await createUserHelper("user@example.test", root.id);

    const result = await setUserPassword(testDb, user.id, "new-password-5678", NOW);

    expect(result.ok).toBe(true);
    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(await verifyPassword(credential.passwordHash, "new-password-5678")).toBe(true);
    expect(await verifyPassword(credential.passwordHash, OLD_PASSWORD)).toBe(false);
  });

  it("revokes all active sessions and increments credential version", async () => {
    const { root } = await setupCompany();
    const user = await createUserHelper("user@example.test", root.id);
    await createSession(testDb, user.id, NOW);
    await createSession(testDb, user.id, NOW);
    const prev = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });

    const result = await setUserPassword(testDb, user.id, "new-password-5678", NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revokedSessionCount).toBe(2);
    expect(
      await testDb.session.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(0);

    const updated = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(updated.version).toBe(prev.version + 1);
  });

  it("unlocks locked accounts", async () => {
    const { root } = await setupCompany();
    const user = await createUserHelper("user@example.test", root.id);
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { failedLoginCount: 10, lockedUntil: new Date(NOW.getTime() + 900_000) },
    });

    await setUserPassword(testDb, user.id, "new-password-5678", NOW);

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.lockedUntil).toBeNull();
    expect(credential.failedLoginCount).toBe(0);
  });

  it("returns error for non-existent user", async () => {
    const result = await setUserPassword(
      testDb,
      "11111111-1111-4111-8111-111111111111",
      "new-password-5678",
      NOW,
    );

    expect(result.ok).toBe(false);
  });
});

describe("root account protections", () => {
  it("root account cannot be modified via standard user update path", async () => {
    const { root } = await setupCompany();
    const rootUser = await createUserHelper("root.account@example.test", root.id, {
      isSystemAdmin: true,
    });
    await testDb.user.update({ where: { id: rootUser.id }, data: { isRoot: true } });

    const result = await updateUser(testDb, {
      id: rootUser.id,
      fullName: "Other Name",
      email: rootUser.email,
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: false,
    });

    expect(result).toMatchObject({ ok: false, error: "root_protected" });
  });

  it("database constraints protect root user identity and core attributes", async () => {
    const { root } = await setupCompany();
    const rootUser = await createUserHelper("root.account@example.test", root.id, {
      isSystemAdmin: true,
      isUnitManager: true,
    });
    await testDb.user.update({ where: { id: rootUser.id }, data: { isRoot: true } });

    await expect(
      testDb.user.update({
        where: { id: rootUser.id },
        data: { fullName: "Cannot Change" },
      }),
    ).rejects.toThrow(/ROOT_USER_PROTECTED/);

    await expect(
      testDb.user.update({
        where: { id: rootUser.id },
        data: { email: "other@example.test" },
      }),
    ).rejects.toThrow(/ROOT_USER_PROTECTED/);

    await expect(
      testDb.user.update({
        where: { id: rootUser.id },
        data: { isUnitManager: false },
      }),
    ).rejects.toThrow(/ROOT_USER_PROTECTED/);
  });

  it("root can only update their own operational preferences", async () => {
    const { root, workshop } = await setupCompany();
    const rootUser = await createUserHelper("root.account@example.test", root.id, {
      isSystemAdmin: true,
      isUnitManager: true,
    });
    await testDb.user.update({ where: { id: rootUser.id }, data: { isRoot: true } });

    const result = await updateRootSelf(
      testDb,
      {
        id: rootUser.id,
        orgUnitId: workshop.id,
        writesActivities: false,
        isScored: false,
        canAppreciate: true,
      },
      rootUser.id,
      NOW,
    );

    expect(result.ok).toBe(true);
    const updated = await testDb.user.findUniqueOrThrow({ where: { id: rootUser.id } });
    expect(updated).toMatchObject({
      orgUnitId: workshop.id,
      writesActivities: false,
      isScored: false,
      canAppreciate: true,
      isRoot: true,
      isSystemAdmin: true,
      isActive: true,
    });
  });

  it("root is protected against password resets and deactivation", async () => {
    const { root } = await setupCompany();
    const rootUser = await createUserHelper("root.account@example.test", root.id, {
      isSystemAdmin: true,
    });
    await testDb.user.update({ where: { id: rootUser.id }, data: { isRoot: true } });

    const passwordResult = await setUserPassword(testDb, rootUser.id, "new-password-5678", NOW);
    expect(passwordResult).toMatchObject({ ok: false, error: "root_protected" });

    const deactivationCheck = await canDeactivate(testDb, "other-actor", rootUser.id);
    expect(deactivationCheck).toMatchObject({ allowed: false });

    const deactivationResult = await deactivateUser(testDb, rootUser.id, NOW);
    expect(deactivationResult).toMatchObject({ ok: false, reason: "root_protected" });
  });
});
