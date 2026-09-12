import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { updateActivity } from "@/server/activities/write";
import { askQuestion, replyToConversation } from "@/server/conversations/service";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

// Audit (2026-08-18, PHASE 4 findings 2 and 3): cancellation, editing, and question
// opening did not participate in the same locking protocol. Results where cancellation
// is "irreversible" and "closes open conversations" were not guaranteed.
//
// Setting up a race condition requires two separate connections and a synchronization point;
// sequential calls from a single client queue up and prove nothing.

const NOW = new Date("2026-08-17T09:00:00.000Z");

const clientA = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } }, log: [] });
const clientB = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } }, log: [] });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await Promise.all([testDb.$disconnect(), clientA.$disconnect(), clientB.$disconnect()]);
});

function createBarrier(participants: number) {
  let arrived = 0;
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async function waitForOthers(): Promise<void> {
    arrived += 1;
    if (arrived >= participants) release();
    await gate;
  };
}

async function scenario() {
  const root = await createOrgUnit({ name: "Headquarters", type: "Root" });
  const moldShop = await createOrgUnit({ name: "Tooling Workshop", parentId: root.id });

  const director = await createUser(root.id, {
    fullName: "Director",
    isUnitManager: true,
  });
  const author = await createUser(moldShop.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Initial title",
      description: "Initial description",
      approvalStatus: "APPROVED",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  return { director, author, activity, moldShop };
}

/**
 * Which side wins a race is non-deterministic; a naive "send two requests concurrently"
 * test can pass even if locks are completely removed. Therefore, the race window is
 * controlled explicitly: an external transaction acquires `FOR UPDATE`, tested call
 * performs pre-read then waits on the lock, then the row status is mutated and completed.
 * Without locking, the call would not wait and write stale state.
 */
async function withRowLockedThen<T>(
  table: "Activity" | "Conversation",
  id: string,
  mutate: (tx: PrismaClient) => Promise<unknown>,
  during: () => Promise<T>,
): Promise<T> {
  let lockAcquired!: () => void;
  const locked = new Promise<void>((resolve) => {
    lockAcquired = resolve;
  });
  let releaseHolder!: () => void;
  const holderMayFinish = new Promise<void>((resolve) => {
    releaseHolder = resolve;
  });

  const holder = clientA.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`,
        id,
      );
      lockAcquired();
      await holderMayFinish;
      await mutate(tx as unknown as PrismaClient);
    },
    { timeout: 20_000, maxWait: 20_000 },
  );

  await locked;
  const pending = during();
  // Ensure transaction closes even if test throws; unclosed transactions deadlock TRUNCATE.
  pending.catch(() => undefined);

  try {
    // Brief pause to verify the call is genuinely blocking on the lock.
    const earlyResult = await Promise.race([
      pending.then(() => "finished" as const),
      new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 300)),
    ]);
    expect(earlyResult).toBe("waiting");
  } finally {
    releaseHolder();
    await holder.catch(() => undefined);
  }

  return pending;
}

describe("edit versus cancellation race", () => {
  it("cannot edit when cancellation wins the race", async () => {
    const { author, activity, moldShop } = await scenario();

    const result = await withRowLockedThen(
      "Activity",
      activity.id,
      (tx) =>
        tx.activity.update({
          where: { id: activity.id },
          data: { approvalStatus: "CANCELLED" },
        }),
      () =>
        updateActivity(
          clientB as never,
          author.id,
          {
            id: activity.id,
            activityDate: "2026-08-17",
            title: "Edited title",
            description: "Edited description",
            targetDepartmentIds: [moldShop.id],
          },
          new Date(NOW.getTime() + 60_000),
        ),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("conflict");

    const stored = await testDb.activity.findUniqueOrThrow({ where: { id: activity.id } });
    expect(stored.title).toBe("Initial title");
    expect(stored.currentRevisionNo).toBe(1);
  });
});

describe("ask question versus cancellation race", () => {
  it("does not open new conversation when cancellation wins", async () => {
    const { director, activity } = await scenario();

    const result = await withRowLockedThen(
      "Activity",
      activity.id,
      (tx) =>
        tx.activity.update({
          where: { id: activity.id },
          data: { approvalStatus: "CANCELLED" },
        }),
      () =>
        askQuestion(
          clientB as never,
          { id: director.id, isSystemAdmin: false },
          { activityId: activity.id, text: "What is the status of this?" },
          new Date(NOW.getTime() + 60_000),
        ),
    );

    expect(result.ok).toBe(false);

    // Cancelled activity must have no conversations — neither open nor closed.
    expect(await testDb.conversation.count({ where: { activityId: activity.id } })).toBe(0);
  });
});

describe("close conversation versus reply race", () => {
  it("cannot reply to a conversation that was closed", async () => {
    const { author, director, activity } = await scenario();

    const opened = await askQuestion(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { activityId: activity.id, text: "What is the status of this?" },
      new Date(NOW.getTime() + 60_000),
    );
    if (!opened.ok) throw new Error("setup failed");

    const result = await withRowLockedThen(
      "Conversation",
      opened.value.id,
      (tx) =>
        tx.conversation.update({
          where: { id: opened.value.id },
          data: { status: "CLOSED", closedAt: NOW, closedById: director.id, closeType: "NORMAL" },
        }),
      () =>
        replyToConversation(
          clientB as never,
          { id: author.id, isSystemAdmin: false },
          { conversationId: opened.value.id, text: "Completed." },
          new Date(NOW.getTime() + 120_000),
        ),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("closed");

    // Closed conversation should only contain the initial question message.
    expect(
      await testDb.conversationMessage.count({
        where: { conversationId: opened.value.id },
      }),
    ).toBe(1);
  });
});

describe("read receipt invariants", () => {
  // When two tabs are open, ordering can interleave: delayed request may carry earlier timestamp.
  // "First read" must not move forward, "last read" must not move backward.
  it("later arriving earlier timestamp preserves invariant", async () => {
    const { director, activity } = await scenario();
    const { markActivityAsRead } = await import("@/server/reads/service");

    const early = new Date(NOW.getTime() + 60_000);
    const late = new Date(NOW.getTime() + 120_000);
    const viewer = { id: director.id, isSystemAdmin: false };

    await markActivityAsRead(testDb, viewer, activity.id, 3_000, late);
    await markActivityAsRead(testDb, viewer, activity.id, 3_000, early);

    const record = await testDb.readReceipt.findUniqueOrThrow({
      where: { activityId_userId: { activityId: activity.id, userId: director.id } },
    });

    expect(record.firstReadAt).toEqual(early);
    expect(record.lastReadAt).toEqual(late);
  });

  it("two concurrent reads leave a single row", async () => {
    const { director, activity } = await scenario();
    const { markActivityAsRead } = await import("@/server/reads/service");
    const barrier = createBarrier(2);
    const viewer = { id: director.id, isSystemAdmin: false };

    const results = await Promise.allSettled([
      (async () => {
        await barrier();
        return markActivityAsRead(clientA as never, viewer, activity.id, 3_000, NOW);
      })(),
      (async () => {
        await barrier();
        return markActivityAsRead(clientB as never, viewer, activity.id, 3_000, NOW);
      })(),
    ]);

    // Concurrent write must not fail (no unique key violation) and keep exactly 1 row.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await testDb.readReceipt.count()).toBe(1);
  });
});
