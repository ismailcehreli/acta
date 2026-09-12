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

describe("backup request", () => {
  it("creates request and audit log in same transaction", async () => {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const admin = await createUser(unit.id, {
      fullName: "System Admin",
      isSystemAdmin: true,
    });

    const result = await requestBackup(testDb, admin.id, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const request = await testDb.backupRequest.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(request).toMatchObject({
      source: "MANUAL",
      requestedById: admin.id,
      status: "PENDING",
      requestedAt: NOW,
    });

    await expect(
      testDb.auditLog.findFirstOrThrow({
        where: { objectId: result.id },
        select: { objectType: true, action: true, userId: true },
      }),
    ).resolves.toEqual({
      objectType: "backup_request",
      action: "backup_requested",
      userId: admin.id,
    });
  });

  it("rejects second concurrent pending request", async () => {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const firstAdmin = await createUser(unit.id, {
      isSystemAdmin: true,
      fullName: "First Admin",
    });
    const secondAdmin = await createUser(unit.id, {
      isSystemAdmin: true,
      fullName: "Second Admin",
    });

    expect((await requestBackup(testDb, firstAdmin.id, NOW)).ok).toBe(true);

    const secondResult = await requestBackup(
      testDb,
      secondAdmin.id,
      new Date(NOW.getTime() + 1_000),
    );
    expect(secondResult).toEqual({
      ok: false,
      error: "already_waiting",
      message: "A backup is already waiting or running. Wait for it to finish.",
    });
    expect(await testDb.backupRequest.count()).toBe(1);

    // Bypassing service layer also trips partial unique index constraint.
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

  it("serializes dates and bigint fields for admin panel", async () => {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const admin = await createUser(unit.id, { isSystemAdmin: true });
    const request = await testDb.backupRequest.create({
      data: {
        source: "MANUAL",
        requestedById: admin.id,
        status: "DONE",
        requestedAt: NOW,
        startedAt: new Date(NOW.getTime() + 1_000),
        finishedAt: new Date(NOW.getTime() + 10_000),
        fileName: "acta-20260828-120000.tar.gz.enc",
        sizeBytes: BigInt(1024 * 1024),
        message: "Backup file ready.",
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
        fileName: "acta-20260828-120000.tar.gz.enc",
        sizeBytes: "1048576",
        message: "Backup file ready.",
      },
    ]);
  });
});
