import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { setReasonActive } from "@/server/approval-reasons/service";
import { attachFiles } from "@/server/attachments/service";
import { closeFollowUp, openFollowUp } from "@/server/follow-ups/service";
import { updateUser } from "@/server/users/update";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../../helpers/test-db";

// "LAST / MAXIMUM / UNIQUE" INVARIANTS (audit 2026-08-21; findings 6, 8, 10, 11).
//
// All four were victims of the same pattern: **count first, write later.** Counting was done
// outside the transaction and without locks; because two concurrent transactions could not see
// each other's writes, both concluded "rule is not broken" and both proceeded.
//
// The fix is two-tiered:
//
//   · Lock and re-read within the transaction on the application side.
//   · Trigger + advisory lock on the database side. `AGENTS.md`:
//     "the value of the constraint lies in being valid even when the application layer is bypassed."
//     This file tests both: race going through the service and race bypassing the service directly writing to the DB.
//
// Simply adding a trigger was not enough: under READ COMMITTED, two transactions do not see each other's writes.
// What closes the race is the advisory lock.

const NOW = new Date("2026-08-21T09:00:00.000Z");

const clientA = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
  log: [],
});
const clientB = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
  log: [],
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await Promise.all([
    testDb.$disconnect(),
    clientA.$disconnect(),
    clientB.$disconnect(),
  ]);
});

/**
 * Concurrently collides two writes.
 *
 * Initiating two single-statement updates with `Promise.all` is not sufficient:
 * each is its own transaction and usually the second does not start until the first commits.
 * The race never occurs, tests stay green, and nothing is proven.
 *
 * Correct design: the first write is made **inside an open transaction** and held before commit.
 * The second write starts then; if protection exists, it waits on lock, otherwise it passes immediately.
 * Then the first is committed.
 *
 *   · If protection **exists**: second waits for first's commit, sees reality, and is rejected.
 *   · If protection **does not exist**: second passes immediately, both write, invariant is broken.
 */
async function conflictingWrite(
  first: (tx: PrismaClient) => Promise<unknown>,
  second: () => Promise<unknown>,
): Promise<void> {
  let wrote!: () => void;
  let release!: () => void;

  const written = new Promise<void>((resolve) => {
    wrote = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const firstTx = clientA
    .$transaction(
      async (tx) => {
        await first(tx as unknown as PrismaClient);
        wrote();
        await gate;
      },
      { timeout: 15_000 },
    )
    .catch(() => undefined);

  await written;

  // Second write begins; result is not awaited yet.
  const secondTx = second().catch(() => undefined);

  // Second is either waiting on lock (protection working) or already completed (no protection).
  // We monitor both; we don't use fixed sleep.
  await waitForSecondToSettle(secondTx);

  release();
  await Promise.allSettled([firstTx, secondTx]);
}

/** Waits until the second write is either waiting on lock or completed. */
async function waitForSecondToSettle(task: Promise<unknown>): Promise<void> {
  const deadline = Date.now() + 10_000;
  let finished = false;
  void task.then(() => {
    finished = true;
  });

  for (;;) {
    if (finished) return;

    const [row] = await testDb.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted
    `;
    if ((row?.n ?? 0) > 0) return;

    if (Date.now() > deadline) throw new Error("second write neither finished nor locked");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("last active system administrator (finding 6)", () => {
  async function twoAdmins() {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const first = await createUser(unit.id, {
      email: "one@example.test",
      isSystemAdmin: true,
    });
    const second = await createUser(unit.id, {
      email: "two@example.test",
      isSystemAdmin: true,
    });
    return { unit, first, second };
  }

  function removeRole(client: PrismaClient, user: { id: string }, unitId: string) {
    return updateUser(
      client,
      {
        id: user.id,
        fullName: "User",
        email: `${user.id}@example.test`,
        orgUnitId: unitId,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
      },
      null,
      NOW,
    );
  }

  it("two concurrent role removals cannot leave the company without an admin", async () => {
    const { unit, first, second } = await twoAdmins();

    await conflictingWrite(
      (tx) => tx.user.update({ where: { id: first.id }, data: { isSystemAdmin: false } }),
      () => removeRole(clientB, second, unit.id),
    );

    const remaining = await testDb.user.count({
      where: { isSystemAdmin: true, isActive: true },
    });
    expect(remaining).toBeGreaterThanOrEqual(1);
  });

  it("preserves last admin in the database even when application is bypassed", async () => {
    const { first, second } = await twoAdmins();

    // Service is not called at all: written directly to the table.
    await conflictingWrite(
      (tx) => tx.user.update({ where: { id: first.id }, data: { isSystemAdmin: false } }),
      () =>
        clientB.user.update({
          where: { id: second.id },
          data: { isSystemAdmin: false },
        }),
    );

    expect(
      await testDb.user.count({ where: { isSystemAdmin: true, isActive: true } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("cannot remove the sole admin role directly either", async () => {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const single = await createUser(unit.id, {
      email: "sole@example.test",
      isSystemAdmin: true,
    });

    await expect(
      testDb.user.update({ where: { id: single.id }, data: { isSystemAdmin: false } }),
    ).rejects.toThrow(/LAST_SYSTEM_ADMIN/);
  });

  it("allows removal when another admin exists", async () => {
    const { unit, first } = await twoAdmins();

    // Control test: above rejections must be due to "last admin", not "cannot be removed at all".
    const result = await removeRole(testDb, first, unit.id);
    expect(result.ok).toBe(true);
  });
});

describe("attachment count per activity (finding 8)", () => {
  async function activityWithFourAttachments() {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const author = await createUser(unit.id, { email: "author@example.test" });
    const activity = await createActivity(author, { approvalStatus: "APPROVED" });

    for (let i = 0; i < 4; i += 1) {
      await testDb.attachment.create({
        data: {
          activityId: activity.id,
          originalName: `file-${i}.png`,
          storedName: `stored-${i}`,
          storagePath: `/tmp/stored-${i}`,
          sizeBytes: 10,
          mimeType: "image/png",
          sha256: "a".repeat(64),
          uploadedById: author.id,
        },
      });
    }

    return { author, activity };
  }

  /** Small valid PNG; MIME type verified from content (§15.4). */
  const PNG = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
      "1f15c4890000000a49444154789c6360000002000100ffff0300000600" +
      "05572bd2b40000000049454e44ae426082",
    "hex",
  );

  it("two concurrent uploads cannot exceed limit", async () => {
    const { author, activity } = await activityWithFourAttachments();

    await conflictingWrite(
      (tx) =>
        tx.attachment.create({
          data: {
            activityId: activity.id,
            originalName: "five.png",
            storedName: "racing-5",
            storagePath: "/tmp/racing-5",
            sizeBytes: 10,
            mimeType: "image/png",
            sha256: "d".repeat(64),
            uploadedById: author.id,
          },
        }),
      // Second writer also bypasses app: testing trigger's own queuing.
      () =>
        clientB.attachment.create({
          data: {
            activityId: activity.id,
            originalName: "six.png",
            storedName: "racing-6",
            storagePath: "/tmp/racing-6",
            sizeBytes: 10,
            mimeType: "image/png",
            sha256: "e".repeat(64),
            uploadedById: author.id,
          },
        }),
    );

    const count = await testDb.attachment.count({ where: { activityId: activity.id } });
    expect(count).toBeLessThanOrEqual(5);
  });

  it("concurrent uploads going through service cannot exceed limit either", async () => {
    const { author, activity } = await activityWithFourAttachments();

    await conflictingWrite(
      (tx) =>
        tx.attachment.create({
          data: {
            activityId: activity.id,
            originalName: "five.png",
            storedName: "service-5",
            storagePath: "/tmp/service-5",
            sizeBytes: 10,
            mimeType: "image/png",
            sha256: "f".repeat(64),
            uploadedById: author.id,
          },
        }),
      () =>
        attachFiles(
          clientB,
          author.id,
          activity.id,
          [{ originalName: "six.png", content: PNG }],
          NOW,
        ),
    );

    expect(
      await testDb.attachment.count({ where: { activityId: activity.id } }),
    ).toBeLessThanOrEqual(5);
  });

  it("preserves limit in database even when application is bypassed", async () => {
    const { author, activity } = await activityWithFourAttachments();

    // Fifth succeeds.
    await testDb.attachment.create({
      data: {
        activityId: activity.id,
        originalName: "five.png",
        storedName: "stored-5",
        storagePath: "/tmp/stored-5",
        sizeBytes: 10,
        mimeType: "image/png",
        sha256: "b".repeat(64),
        uploadedById: author.id,
      },
    });

    // Sixth is rejected without service being called.
    await expect(
      testDb.attachment.create({
        data: {
          activityId: activity.id,
          originalName: "six.png",
          storedName: "stored-6",
          storagePath: "/tmp/stored-6",
          sizeBytes: 10,
          mimeType: "image/png",
          sha256: "c".repeat(64),
          uploadedById: author.id,
        },
      }),
    ).rejects.toThrow(/ATTACHMENT_LIMIT_EXCEEDED/);
  });
});

describe("follow-up item cannot be closed a second time (finding 10)", () => {
  async function openItem() {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Molding", parentId: root.id });
    const manager = await createUser(root.id, {
      email: "manager@example.test",
      isUnitManager: true,
    });
    const author = await createUser(unit.id, { email: "author@example.test" });
    const activity = await createActivity(author, { approvalStatus: "APPROVED" });

    const opened = await openFollowUp(
      testDb,
      { id: author.id, isSystemAdmin: false },
      { activityId: activity.id },
      NOW,
    );
    if (!opened.ok) throw new Error("setup");

    return { manager, author, item: opened.item };
  }

  it("two concurrent closures produce a single closure event", async () => {
    const { manager, author, item } = await openItem();

    await conflictingWrite(
      async (tx) => {
        // First closer performs manually what service does: locks row and closes.
        await tx.$executeRaw`SELECT "id" FROM "FollowUpItem" WHERE "id" = ${item.id} FOR UPDATE`;
        await tx.followUpItem.update({
          where: { id: item.id },
          data: {
            status: "CLOSED",
            closedById: author.id,
            closedAt: NOW,
            closingNote: "author note",
            lastMovedAt: NOW,
          },
        });
        await tx.followUpItemEvent.create({
          data: {
            followUpId: item.id,
            kind: "CLOSED",
            actorId: author.id,
            note: "author note",
            createdAt: NOW,
          },
        });
      },
      () =>
        closeFollowUp(
          clientB,
          { id: manager.id, isSystemAdmin: false },
          item.id,
          "manager note",
          NOW,
        ),
    );

    const events = await testDb.followUpItemEvent.count({
      where: { followUpId: item.id, kind: "CLOSED" },
    });
    expect(events).toBe(1);
  });

  it("rejects second closure in database even when application is bypassed", async () => {
    const { author, item } = await openItem();

    await closeFollowUp(
      testDb,
      { id: author.id, isSystemAdmin: false },
      item.id,
      "closed",
      NOW,
    );

    await expect(
      testDb.followUpItem.update({
        where: { id: item.id },
        data: { closedAt: new Date("2026-08-22T09:00:00.000Z") },
      }),
    ).rejects.toThrow(/FOLLOW_UP_ALREADY_CLOSED/);
  });
});

describe("last active approval reason (finding 11)", () => {
  async function twoReasons() {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const admin = await createUser(unit.id, {
      email: "admin@example.test",
      isSystemAdmin: true,
    });

    const first = await testDb.approvalReason.create({
      data: { kind: "REJECTED", label: "Out of scope" },
    });
    const second = await testDb.approvalReason.create({
      data: { kind: "REJECTED", label: "Duplicate" },
    });

    return { admin, first, second };
  }

  it("two concurrent deactivations cannot empty the catalog", async () => {
    const { admin, first, second } = await twoReasons();

    await conflictingWrite(
      (tx) =>
        tx.approvalReason.update({ where: { id: first.id }, data: { isActive: false } }),
      () => setReasonActive(clientB, second.id, false, admin.id, NOW),
    );

    const remaining = await testDb.approvalReason.count({
      where: { kind: "REJECTED", isActive: true },
    });
    expect(remaining).toBeGreaterThanOrEqual(1);
  });

  it("preserves last reason in database even when application is bypassed", async () => {
    const { first, second } = await twoReasons();

    await conflictingWrite(
      (tx) =>
        tx.approvalReason.update({ where: { id: first.id }, data: { isActive: false } }),
      () =>
        clientB.approvalReason.update({
          where: { id: second.id },
          data: { isActive: false },
        }),
    );

    expect(
      await testDb.approvalReason.count({
        where: { kind: "REJECTED", isActive: true },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("allows deactivation when another active reason exists", async () => {
    const { admin, first } = await twoReasons();

    // Control test.
    const result = await setReasonActive(testDb, first.id, false, admin.id, NOW);
    expect(result.ok).toBe(true);
  });
});
