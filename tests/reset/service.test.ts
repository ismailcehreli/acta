import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createSession, findActiveSession } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";
import { AUDIT_ACTIONS } from "@/server/audit/log";
import {
  requestSystemReset,
  resetApplicationData,
} from "@/server/reset/service";

import { createActivity, createOrgUnit, createUser, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-29T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("system reset request", () => {
  it("is queued only with correct password of active system admin", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const admin = await createUserWithPassword(root.id, "current-password-123", {
      isSystemAdmin: true,
      isUnitManager: true,
    });

    const result = await requestSystemReset(testDb, {
      actorId: admin.id,
      currentPassword: "current-password-123",
      bootstrapFullName: "New System Admin",
      bootstrapEmail: "new.admin@example.test",
      bootstrapPassword: "bootstrap-password-123",
    }, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const request = await testDb.systemResetRequest.findUniqueOrThrow({
      where: { id: result.requestId },
    });
    expect(request.status).toBe("PENDING");
    expect(request.bootstrapPasswordHash).not.toContain("bootstrap-password-123");

    const second = await requestSystemReset(testDb, {
      actorId: admin.id,
      currentPassword: "current-password-123",
      bootstrapFullName: "Second Admin",
      bootstrapEmail: "second.admin@example.test",
      bootstrapPassword: "other-password-123",
    }, NOW);
    expect(second).toEqual({
      ok: false,
      error: "active_request",
      message: "A reset operation is already waiting or running.",
    });
  });

  it("rejects non-system-admin account and incorrect password", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const user = await createUserWithPassword(root.id, "user-password-123");

    const result = await requestSystemReset(testDb, {
      actorId: user.id,
      currentPassword: "user-password-123",
      bootstrapFullName: "New System Admin",
      bootstrapEmail: "new.admin@example.test",
      bootstrapPassword: "bootstrap-password-123",
    }, NOW);
    expect(result).toMatchObject({ error: "invalid_current_password" });

    const admin = await createUserWithPassword(root.id, "correct-password-123", {
      isSystemAdmin: true,
    });
    const wrongPassword = await requestSystemReset(testDb, {
      actorId: admin.id,
      currentPassword: "wrong-password-123",
      bootstrapFullName: "New System Admin",
      bootstrapEmail: "new.admin@example.test",
      bootstrapPassword: "bootstrap-password-123",
    }, NOW);
    expect(wrongPassword).toMatchObject({ error: "invalid_current_password" });
  });
});

describe("system reset runner", () => {
  it("preserves old data if reset transaction encounters an error", async () => {
    const root = await createOrgUnit({ name: "Old Company", type: "Root" });
    const oldAdmin = await createUserWithPassword(root.id, "old-password-123", {
      isSystemAdmin: true,
      isUnitManager: true,
    });
    const oldEmployee = await createUser(root.id);
    const oldActivity = await createActivity(oldEmployee, { title: "Old record" });
    const bootstrapHash = await hashPassword("new-bootstrap-123");
    const requestId = "5e3f2b8a-9d95-4d35-b1b1-2f0a2c1e6b11";

    await testDb.systemResetRequest.create({
      data: {
        id: requestId,
        requestedById: oldAdmin.id,
        status: "RUNNING",
        requestedAt: NOW,
        startedAt: NOW,
        bootstrapFullName: "New Bootstrap Admin",
        bootstrapEmail: "bootstrap@example.test",
        bootstrapPasswordHash: bootstrapHash,
      },
    });

    const previousRootUnitName = process.env.ROOT_UNIT_NAME;
    process.env.ROOT_UNIT_NAME = "x".repeat(151);
    try {
      await expect(resetApplicationData(testDb, requestId, NOW)).rejects.toThrow();
    } finally {
      if (previousRootUnitName === undefined) delete process.env.ROOT_UNIT_NAME;
      else process.env.ROOT_UNIT_NAME = previousRootUnitName;
    }

    expect(await testDb.orgUnit.count()).toBe(1);
    expect(await testDb.user.count()).toBe(2);
    expect(await testDb.activity.findUnique({ where: { id: oldActivity.id } })).not.toBeNull();
    expect(
      await testDb.systemResetRequest.findUniqueOrThrow({ where: { id: requestId } }),
    ).toMatchObject({ status: "RUNNING", bootstrapPasswordHash: bootstrapHash });
  });

  it("clears data, revokes old sessions, and forces password change on new account", async () => {
    const root = await createOrgUnit({ name: "Old Company", type: "Root" });
    const oldAdmin = await createUserWithPassword(root.id, "old-password-123", {
      isSystemAdmin: true,
      isUnitManager: true,
    });
    const oldEmployee = await createUser(root.id);
    await createActivity(oldEmployee, { title: "Old record" });
    const oldSession = await createSession(testDb, oldAdmin.id, NOW);
    const bootstrapHash = await hashPassword("new-bootstrap-123");
    const requestId = "3e3f2b8a-9d95-4d35-b1b1-2f0a2c1e6b10";

    await testDb.systemResetRequest.create({
      data: {
        id: requestId,
        requestedById: oldAdmin.id,
        status: "RUNNING",
        requestedAt: NOW,
        startedAt: NOW,
        bootstrapFullName: "New Bootstrap Admin",
        bootstrapEmail: "bootstrap@example.test",
        bootstrapPasswordHash: bootstrapHash,
      },
    });

    const result = await resetApplicationData(testDb, requestId, NOW);

    expect(await testDb.activity.count()).toBe(0);
    expect(await testDb.user.count()).toBe(1);
    expect(await testDb.orgUnit.count()).toBe(1);
    expect(await findActiveSession(testDb, oldSession.token, NOW)).toBeNull();

    const bootstrap = await testDb.user.findUniqueOrThrow({
      where: { id: result.bootstrapUserId },
      include: { credential: true, orgUnit: true },
    });
    expect(bootstrap.email).toBe("bootstrap@example.test");
    expect(bootstrap.isSystemAdmin).toBe(true);
    expect(bootstrap.isUnitManager).toBe(true);
    expect(bootstrap.credential?.mustChangePassword).toBe(true);
    expect(bootstrap.orgUnit.parentId).toBeNull();

    const request = await testDb.systemResetRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(request.status).toBe("DONE");
    expect(request.bootstrapPasswordHash).toBeNull();

    expect(
      await testDb.auditLog.findFirst({
        where: { action: AUDIT_ACTIONS.systemResetCompleted },
      }),
    ).not.toBeNull();
  });
});
