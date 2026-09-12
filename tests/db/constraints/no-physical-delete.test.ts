import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// §16.6: Physical deletion is forbidden. RESTRICT on foreign keys only protects
// referenced records; unreferenced users, empty units, or activities without child records
// could previously be deleted (audit 2026-08-17, finding 9).

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("unreferenced records cannot be physically deleted either", () => {
  it("cannot delete an unreferenced user", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await expect(
      testDb.user.delete({ where: { id: user.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("cannot delete an empty org unit", async () => {
    const root = await createOrgUnit();
    const empty = await createOrgUnit({ parentId: root.id });

    await expect(
      testDb.orgUnit.delete({ where: { id: empty.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("cannot delete single root unit - tree cannot become rootless", async () => {
    const root = await createOrgUnit();

    await expect(
      testDb.orgUnit.delete({ where: { id: root.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("cannot delete activity without child records", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const activity = await createActivity(user);

    await expect(
      testDb.activity.delete({ where: { id: activity.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("rejects bulk delete as well", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id);

    await expect(testDb.user.deleteMany({})).rejects.toThrow(
      /PHYSICAL_DELETE_FORBIDDEN/,
    );
  });

  it("rejects delete via raw SQL as well", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await expect(
      testDb.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${user.id}'`),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });
});

// §15.2: Audit log is immutable.
describe("audit log immutability", () => {
  async function createAuditLog() {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    return testDb.auditLog.create({
      data: {
        userId: user.id,
        objectType: "Activity",
        objectId: "sample",
        action: "created",
      },
    });
  }

  it("cannot update audit log", async () => {
    const log = await createAuditLog();

    await expect(
      testDb.auditLog.update({
        where: { id: log.id },
        data: { action: "modified" },
      }),
    ).rejects.toThrow(/AUDIT_LOG_IMMUTABLE/);
  });

  it("cannot delete audit log", async () => {
    const log = await createAuditLog();

    await expect(
      testDb.auditLog.delete({ where: { id: log.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });
});

// Narrow backdoor opened by demo data purge (2026-08-20).
//
// The prohibition remains in place by default; deletion only succeeds when the
// `app.demo_purge` session variable is set. These tests ensure the door remains
// closed and closes along with the transaction when opened.
describe("demo data purge narrow backdoor", () => {
  it("rejects delete when flag is not set", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await expect(
      testDb.user.delete({ where: { id: user.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("does not open door when flag is set with incorrect value", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await expect(
      testDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'maybe'");
        return tx.user.delete({ where: { id: user.id } });
      }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("allows delete inside transaction when flag is set", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await testDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'evet'");
      await tx.user.delete({ where: { id: user.id } });
    });

    expect(await testDb.user.count({ where: { id: user.id } })).toBe(0);
  });

  it("flag does not persist after transaction - subsequent delete is rejected", async () => {
    const unit = await createOrgUnit();
    const toDelete = await createUser(unit.id);
    const toKeep = await createUser(unit.id, { email: "to-keep@example.test" });

    await testDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'evet'");
      await tx.user.delete({ where: { id: toDelete.id } });
    });

    // `SET LOCAL` is bound to the transaction; if it leaked into the pool for the next request, this delete would pass.
    await expect(
      testDb.user.delete({ where: { id: toKeep.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("cannot delete activity without activity delete door set (2026-09-03)", async () => {
    // Root's deletion permission lives in application layer; database door is the second lock.
    // No path outside the service - including raw queries - should be able to delete the activity.
    const unit = await createOrgUnit();
    const user = await createUser(unit.id, { email: "author@example.test" });
    const activity = await createActivity(user);

    await expect(
      testDb.activity.delete({ where: { id: activity.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);

    expect(await testDb.activity.count({ where: { id: activity.id } })).toBe(1);
  });

  it("deletes when activity door is set and does not persist after transaction", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id, { email: "author2@example.test" });
    const toDelete = await createActivity(user);
    const toKeep = await createActivity(user);

    await testDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.activity_delete = 'evet'");
      await tx.activityRevision.deleteMany({ where: { activityId: toDelete.id } });
      await tx.activity.delete({ where: { id: toDelete.id } });
    });

    expect(await testDb.activity.count({ where: { id: toDelete.id } })).toBe(0);

    await expect(
      testDb.activity.delete({ where: { id: toKeep.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("activity deletion request record cannot be deleted: it is an audit trail", async () => {
    const unit = await createOrgUnit();
    const root = await createUser(unit.id, {
      email: "root-proof@example.test",
      isRoot: true,
      isSystemAdmin: true,
    });

    const request = await testDb.activityDeletionRequest.create({
      data: {
        activityId: "deleted-record",
        activityTitle: "An activity",
        activityDate: new Date("2026-08-18T00:00:00.000Z"),
        activityAuthor: "Technician",
        requestedById: root.id,
        codeHash: "a".repeat(64),
        expiresAt: new Date("2026-08-18T01:00:00.000Z"),
      },
    });

    await expect(
      testDb.activityDeletionRequest.delete({ where: { id: request.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });
});
