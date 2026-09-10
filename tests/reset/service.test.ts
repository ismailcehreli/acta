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

describe("başlangıca dönüş isteği", () => {
  it("yalnız aktif sistem yöneticisinin doğru parolasıyla kuyruğa alınır", async () => {
    const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const admin = await createUserWithPassword(root.id, "mevcut-parola-123", {
      isSystemAdmin: true,
      isUnitManager: true,
    });

    const result = await requestSystemReset(testDb, {
      actorId: admin.id,
      currentPassword: "mevcut-parola-123",
      bootstrapFullName: "Yeni Sistem Yöneticisi",
      bootstrapEmail: "yeni.yonetici@ornek.test",
      bootstrapPassword: "baslangic-parolasi-123",
    }, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const request = await testDb.systemResetRequest.findUniqueOrThrow({
      where: { id: result.requestId },
    });
    expect(request.status).toBe("PENDING");
    expect(request.bootstrapPasswordHash).not.toContain("baslangic-parolasi-123");

    const second = await requestSystemReset(testDb, {
      actorId: admin.id,
      currentPassword: "mevcut-parola-123",
      bootstrapFullName: "İkinci Yönetici",
      bootstrapEmail: "ikinci.yonetici@ornek.test",
      bootstrapPassword: "baska-parola-123",
    }, NOW);
    expect(second).toEqual({
      ok: false,
      error: "active_request",
      message: "Zaten bekleyen veya çalışan bir başlangıca dönüş işlemi var.",
    });
  });

  it("sistem yöneticisi olmayan hesabı ve yanlış parolayı reddeder", async () => {
    const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const user = await createUserWithPassword(root.id, "kullanici-parola-123");

    const result = await requestSystemReset(testDb, {
      actorId: user.id,
      currentPassword: "kullanici-parola-123",
      bootstrapFullName: "Yeni Sistem Yöneticisi",
      bootstrapEmail: "yeni.yonetici@ornek.test",
      bootstrapPassword: "baslangic-parolasi-123",
    }, NOW);
    expect(result).toMatchObject({ error: "invalid_current_password" });

    const admin = await createUserWithPassword(root.id, "dogru-parola-123", {
      isSystemAdmin: true,
    });
    const wrongPassword = await requestSystemReset(testDb, {
      actorId: admin.id,
      currentPassword: "yanlis-parola-123",
      bootstrapFullName: "Yeni Sistem Yöneticisi",
      bootstrapEmail: "yeni.yonetici@ornek.test",
      bootstrapPassword: "baslangic-parolasi-123",
    }, NOW);
    expect(wrongPassword).toMatchObject({ error: "invalid_current_password" });
  });
});

describe("başlangıca dönüş çalıştırıcısı", () => {
  it("sıfırlama transaction'ı hata alırsa eski veriyi korur", async () => {
    const root = await createOrgUnit({ name: "Eski Şirket", type: "Kök" });
    const oldAdmin = await createUserWithPassword(root.id, "eski-parola-123", {
      isSystemAdmin: true,
      isUnitManager: true,
    });
    const oldEmployee = await createUser(root.id);
    const oldActivity = await createActivity(oldEmployee, { title: "Eski kayıt" });
    const bootstrapHash = await hashPassword("yeni-baslangic-123");
    const requestId = "5e3f2b8a-9d95-4d35-b1b1-2f0a2c1e6b11";

    await testDb.systemResetRequest.create({
      data: {
        id: requestId,
        requestedById: oldAdmin.id,
        status: "RUNNING",
        requestedAt: NOW,
        startedAt: NOW,
        bootstrapFullName: "Yeni Başlangıç Yöneticisi",
        bootstrapEmail: "baslangic@ornek.test",
        bootstrapPasswordHash: bootstrapHash,
      },
    });

    const oncekiKokAdi = process.env.ROOT_UNIT_NAME;
    process.env.ROOT_UNIT_NAME = "x".repeat(151);
    try {
      await expect(resetApplicationData(testDb, requestId, NOW)).rejects.toThrow();
    } finally {
      if (oncekiKokAdi === undefined) delete process.env.ROOT_UNIT_NAME;
      else process.env.ROOT_UNIT_NAME = oncekiKokAdi;
    }

    expect(await testDb.orgUnit.count()).toBe(1);
    expect(await testDb.user.count()).toBe(2);
    expect(await testDb.activity.findUnique({ where: { id: oldActivity.id } })).not.toBeNull();
    expect(
      await testDb.systemResetRequest.findUniqueOrThrow({ where: { id: requestId } }),
    ).toMatchObject({ status: "RUNNING", bootstrapPasswordHash: bootstrapHash });
  });

  it("veriyi temizler, eski oturumu kapatır ve yeni hesabı parola değişimine zorlar", async () => {
    const root = await createOrgUnit({ name: "Eski Şirket", type: "Kök" });
    const oldAdmin = await createUserWithPassword(root.id, "eski-parola-123", {
      isSystemAdmin: true,
      isUnitManager: true,
    });
    const oldEmployee = await createUser(root.id);
    await createActivity(oldEmployee, { title: "Eski kayıt" });
    const oldSession = await createSession(testDb, oldAdmin.id, NOW);
    const bootstrapHash = await hashPassword("yeni-baslangic-123");
    const requestId = "3e3f2b8a-9d95-4d35-b1b1-2f0a2c1e6b10";

    await testDb.systemResetRequest.create({
      data: {
        id: requestId,
        requestedById: oldAdmin.id,
        status: "RUNNING",
        requestedAt: NOW,
        startedAt: NOW,
        bootstrapFullName: "Yeni Başlangıç Yöneticisi",
        bootstrapEmail: "baslangic@ornek.test",
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
    expect(bootstrap.email).toBe("baslangic@ornek.test");
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
