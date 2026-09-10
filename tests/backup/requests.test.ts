import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { requestBackup, listBackupRequests } from "@/server/backup/requests";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-28T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("yedek isteği", () => {
  it("isteği ve denetim kaydını aynı işlemde oluşturur", async () => {
    const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const admin = await createUser(unit.id, {
      fullName: "Sistem Yöneticisi",
      isSystemAdmin: true,
    });

    const sonuc = await requestBackup(testDb, admin.id, NOW);

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    const request = await testDb.backupRequest.findUniqueOrThrow({
      where: { id: sonuc.id },
    });
    expect(request).toMatchObject({
      source: "MANUAL",
      requestedById: admin.id,
      status: "PENDING",
      requestedAt: NOW,
    });

    await expect(
      testDb.auditLog.findFirstOrThrow({
        where: { objectId: sonuc.id },
        select: { objectType: true, action: true, userId: true },
      }),
    ).resolves.toEqual({
      objectType: "backup_request",
      action: "backup_requested",
      userId: admin.id,
    });
  });

  it("aynı anda ikinci bekleyen istek kabul edilmez", async () => {
    const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const firstAdmin = await createUser(unit.id, {
      isSystemAdmin: true,
      fullName: "Birinci Yönetici",
    });
    const secondAdmin = await createUser(unit.id, {
      isSystemAdmin: true,
      fullName: "İkinci Yönetici",
    });

    expect((await requestBackup(testDb, firstAdmin.id, NOW)).ok).toBe(true);

    const ikinci = await requestBackup(
      testDb,
      secondAdmin.id,
      new Date(NOW.getTime() + 1_000),
    );
    expect(ikinci).toEqual({
      ok: false,
      message: "Bekleyen ya da çalışan bir yedek var. Bitmesini bekleyin.",
    });
    expect(await testDb.backupRequest.count()).toBe(1);

    // Servis katmanını atlayan bir yazma da aynı kısmi tekil indekse takılır.
    await expect(
      testDb.backupRequest.create({
        data: {
          source: "MANUAL",
          requestedById: secondAdmin.id,
          status: "PENDING",
          requestedAt: new Date(NOW.getTime() + 2_000),
        },
      }),
    ).rejects.toThrow();
  });

  it("panel için tarih ve büyük sayı alanlarını serileştirir", async () => {
    const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const admin = await createUser(unit.id, { isSystemAdmin: true });
    const request = await testDb.backupRequest.create({
      data: {
        source: "MANUAL",
        requestedById: admin.id,
        status: "DONE",
        requestedAt: NOW,
        startedAt: new Date(NOW.getTime() + 1_000),
        finishedAt: new Date(NOW.getTime() + 10_000),
        fileName: "faaliyet-20260828-120000.tar.gz.enc",
        sizeBytes: BigInt(1024 * 1024),
        message: "Yedek dosyası hazır.",
      },
    });

    await expect(listBackupRequests(testDb)).resolves.toEqual([
      {
        id: request.id,
        source: "MANUAL",
        status: "DONE",
        requestedAt: NOW.toISOString(),
        startedAt: new Date(NOW.getTime() + 1_000).toISOString(),
        finishedAt: new Date(NOW.getTime() + 10_000).toISOString(),
        fileName: "faaliyet-20260828-120000.tar.gz.enc",
        sizeBytes: "1048576",
        message: "Yedek dosyası hazır.",
      },
    ]);
  });
});
