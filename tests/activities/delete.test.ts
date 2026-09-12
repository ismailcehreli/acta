import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  confirmActivityDeletion,
  describeActivityForDeletion,
  requestActivityDeletion,
  DELETION_CODE_TTL_MS,
  MAX_DELETION_ATTEMPTS,
} from "@/server/activities/delete";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Root activity deletion (product owner decision, 2026-09-03).
//
// Deletion passes through four layers and each layer is tested independently:
// authorization (root only), period (closed periods cannot be deleted),
// confirmation code, database gates.
//
// The most critical test is the **second period check**: the code is valid for ten
// minutes and during that time period closure may run. If checked only on request,
// a closed period's activity could be deleted just because request opened prior.

const NOW = new Date("2026-08-20T09:00:00.000Z");
const DAY = new Date("2026-08-18T00:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setup() {
  const unit = await createOrgUnit({ name: "Tooling Department" });
  const root = await createUser(unit.id, {
    fullName: "Root Admin",
    email: "root@example.test",
    isSystemAdmin: true,
    isRoot: true,
  });
  const admin = await createUser(unit.id, {
    fullName: "System Admin",
    email: "admin@example.test",
    isSystemAdmin: true,
  });
  const author = await createUser(unit.id, { fullName: "Toolmaker" });
  const activity = await createActivity(author, {
    title: "Press line inspection",
    activityDate: DAY,
  });

  return { unit, root, admin, author, activity };
}

/** Code only arrives via email; read from queue in test. */
async function getCodeFromQueue(): Promise<string> {
  const row = await testDb.notificationQueue.findFirstOrThrow({
    where: { eventType: "activity_deletion_code" },
    orderBy: { createdAt: "desc" },
  });

  const payload = row.payload as { code?: unknown };
  return typeof payload.code === "string" ? payload.code : "";
}

async function closePeriod(now: Date) {
  await testDb.scorePeriodLedger.create({
    data: {
      periodStart: new Date(Date.UTC(2026, 7, 1)),
      closedAt: now,
      retroactiveDays: 1,
      formulaVersion: 1,
    },
  });
}

describe("deletion authorization (§15.1, decision 2026-09-03)", () => {
  it("root only sees metadata, not body description", async () => {
    const { root, activity } = await setup();

    const result = await describeActivityForDeletion(testDb, root, activity.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Press line inspection");
    expect(result.value.authorName).toBe("Toolmaker");
    expect(result.value.periodClosed).toBe(false);
    // Description body is not carried in any field: admin knows which record
    // is deleted without accessing content.
    expect(JSON.stringify(result.value)).not.toContain("Description");
  });

  it("non-root system admin can neither view nor request deletion", async () => {
    const { admin, activity } = await setup();

    const described = await describeActivityForDeletion(
      testDb,
      admin,
      activity.id,
    );
    const request = await requestActivityDeletion(testDb, admin, activity.id, NOW);

    expect(described.ok).toBe(false);
    expect(request.ok).toBe(false);
    if (request.ok) return;
    expect(request.error).toBe("not_root");
  });

  it("does not discriminate for non-existent record", async () => {
    const { root } = await setup();

    const result = await describeActivityForDeletion(
      testDb,
      root,
      "00000000-0000-0000-0000-000000000000",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });
});

describe("closed period boundary", () => {
  it("cannot request deletion for closed period activity", async () => {
    const { root, activity } = await setup();
    await closePeriod(NOW);

    const described = await describeActivityForDeletion(
      testDb,
      root,
      activity.id,
    );
    const request = await requestActivityDeletion(testDb, root, activity.id, NOW);

    expect(described.ok).toBe(true);
    if (described.ok) expect(described.value.periodClosed).toBe(true);

    expect(request.ok).toBe(false);
    if (request.ok) return;
    expect(request.error).toBe("period_closed");
  });

  it("rejects deletion if period closes AFTER request is opened", async () => {
    // Code valid for ten minutes; closing job may run during this window.
    // If only checked at request time, closed period activity could be deleted.
    const { root, activity } = await setup();

    const request = await requestActivityDeletion(testDb, root, activity.id, NOW);
    expect(request.ok).toBe(true);
    const code = await getCodeFromQueue();

    await closePeriod(new Date(NOW.getTime() + 60_000));

    const result = await confirmActivityDeletion(
      testDb,
      root,
      activity.id,
      code,
      new Date(NOW.getTime() + 120_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("period_closed");
    // Activity must still exist.
    expect(await testDb.activity.count({ where: { id: activity.id } })).toBe(1);
  });
});

describe("confirmation code", () => {
  it("valid code deletes activity and related rows, leaves audit trace", async () => {
    const { root, author, activity } = await setup();

    // Related rows: deletion must cascade these as well.
    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: root.id, firstReadAt: NOW },
    });
    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: author.orgUnitId },
    });

    const request = await requestActivityDeletion(testDb, root, activity.id, NOW);
    expect(request.ok).toBe(true);
    const code = await getCodeFromQueue();

    const result = await confirmActivityDeletion(testDb, root, activity.id, code, NOW);

    expect(result.ok).toBe(true);
    expect(await testDb.activity.count({ where: { id: activity.id } })).toBe(0);
    expect(
      await testDb.activityRevision.count({ where: { activityId: activity.id } }),
    ).toBe(0);
    expect(await testDb.readReceipt.count({ where: { activityId: activity.id } })).toBe(0);

    // Evidence remains: audit log and deletion request carry deleted record metadata.
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "activity_deleted", objectId: activity.id },
    });
    expect(log.userId).toBe(root.id);

    const remainingRequest = await testDb.activityDeletionRequest.findFirstOrThrow({
      where: { activityId: activity.id },
    });
    expect(remainingRequest.activityTitle).toBe("Press line inspection");
    expect(remainingRequest.consumedAt).not.toBeNull();

    // No score recalculation queue entry is needed: recalculation is only for frozen cards.
    expect(
      await testDb.scoreRecalculationRequest.count({
        where: { userId: author.id, sourceId: activity.id },
      }),
    ).toBe(0);
  });

  it("wrong code does not delete and counts attempt; threshold closes request", async () => {
    const { root, activity } = await setup();
    await requestActivityDeletion(testDb, root, activity.id, NOW);

    for (let attempt = 0; attempt < MAX_DELETION_ATTEMPTS; attempt += 1) {
      const result = await confirmActivityDeletion(
        testDb,
        root,
        activity.id,
        "000000",
        NOW,
      );
      expect(result.ok).toBe(false);
    }

    // Request canceled upon reaching threshold: even correct code fails.
    const code = await getCodeFromQueue();
    const finalResult = await confirmActivityDeletion(
      testDb,
      root,
      activity.id,
      code,
      NOW,
    );

    expect(finalResult.ok).toBe(false);
    if (finalResult.ok) return;
    expect(finalResult.error).toBe("no_request");
    expect(await testDb.activity.count({ where: { id: activity.id } })).toBe(1);
  });

  it("expired code does not work", async () => {
    const { root, activity } = await setup();
    await requestActivityDeletion(testDb, root, activity.id, NOW);
    const code = await getCodeFromQueue();

    const result = await confirmActivityDeletion(
      testDb,
      root,
      activity.id,
      code,
      new Date(NOW.getTime() + DELETION_CODE_TTL_MS + 1000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("expired");
    expect(await testDb.activity.count({ where: { id: activity.id } })).toBe(1);
  });

  it("same code cannot be reused", async () => {
    const { root, activity } = await setup();
    await requestActivityDeletion(testDb, root, activity.id, NOW);
    const code = await getCodeFromQueue();

    expect((await confirmActivityDeletion(testDb, root, activity.id, code, NOW)).ok).toBe(
      true,
    );

    const second = await confirmActivityDeletion(testDb, root, activity.id, code, NOW);
    expect(second.ok).toBe(false);
  });

  it("code sent via email and stored as hash, not plaintext", async () => {
    const { root, activity } = await setup();
    await requestActivityDeletion(testDb, root, activity.id, NOW);

    const queueRow = await testDb.notificationQueue.findFirstOrThrow({
      where: { eventType: "activity_deletion_code" },
    });
    expect(queueRow.userId).toBe(root.id);

    // Request record in DB stores hash of code, not plaintext code itself.
    const requestRow = await testDb.activityDeletionRequest.findFirstOrThrow({
      where: { activityId: activity.id },
    });
    const code = await getCodeFromQueue();
    expect(requestRow.codeHash).not.toBe(code);
    expect(requestRow.codeHash).toHaveLength(64);
  });
});
