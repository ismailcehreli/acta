import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  countSubscriptions,
  dropSubscription,
  removeSubscription,
  saveSubscription,
} from "@/server/push/subscriptions";
import { generateVapidKeys, readVapidKeys } from "@/server/settings/vapid";
import {
  dispatchPushNotifications,
  type PushSendOutcome,
  type PushTransport,
} from "@/worker/notifications/push";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Web push (§12.3, Task 5.3b).
//
// Critical behavior: **dead subscription is dropped.** If retained, it would be tried
// fruitlessly every round, the queue would never drain, and logs would fill with error messages.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  activities.clear();
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

// Notifications bind to a real activity: queue row has a foreign key to activity (finding 3).
const activities = new Map<string, string>();

async function setupUser(fullName = "User") {
  const unit = await createOrgUnit({ name: "Company", type: "Root" });
  const user = await createUser(unit.id, { fullName });
  // User always sees own record; focus here is push dispatch behavior, not visibility.
  const activity = await createActivity(user, { approvalStatus: "APPROVED" });
  activities.set(user.id, activity.id);
  return user;
}

/** Notification payload belonging to user's own activity. */
function buildPayload(userId: string) {
  return { activityId: activities.get(userId), activityTitle: "Activity" };
}

async function setupVapidKeys(actorId: string) {
  const result = await generateVapidKeys(
    testDb,
    { subject: "mailto:it@example.test" },
    actorId,
    NOW,
  );
  if (!result.ok) throw new Error(`setup: ${result.message}`);
}

function createSubscription(n: number) {
  return {
    endpoint: `https://push.example.test/sub-${n}`,
    p256dh: "BExampleKeyMaterial-p256dh",
    auth: "ExampleAuthSecret",
  };
}

/** Fake push transport returning given outcome; records calls. */
function fakePushTransport(
  outcomes: Record<string, PushSendOutcome>,
): PushTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async send(endpoint) {
      calls.push(endpoint.endpoint);
      return outcomes[endpoint.endpoint] ?? { ok: true };
    },
  };
}

describe("VAPID keys", () => {
  it("generates and stores private key sealed", async () => {
    const me = await setupUser("Admin");
    await setupVapidKeys(me.id);

    const keys = await readVapidKeys(testDb);
    expect(keys).not.toBeNull();
    expect(keys?.publicKey.length).toBeGreaterThan(20);

    // Raw private key must not sit plain in the database.
    const row = await testDb.systemSetting.findUniqueOrThrow({
      where: { key: "vapid_private_key_sealed" },
    });
    expect(row.value).not.toBe(keys?.privateKey);
  });

  it("cannot decrypt private key with incorrect secret", async () => {
    const me = await setupUser("Admin");
    await setupVapidKeys(me.id);

    // Channel closes rather than silently attempting to send with an empty key.
    expect(await readVapidKeys(testDb, "another-secret-32-char-string!!")).toBeNull();
  });

  it("does not accidentally overwrite existing key pair", async () => {
    const me = await setupUser("Admin");
    await setupVapidKeys(me.id);
    const before = await readVapidKeys(testDb);

    const result = await generateVapidKeys(
      testDb,
      { subject: "mailto:it@example.test" },
      me.id,
      NOW,
    );

    // Refreshing kills all subscriptions; must be explicitly requested.
    expect(result.ok).toBe(false);
    expect((await readVapidKeys(testDb))?.publicKey).toBe(before?.publicKey);
  });

  it("refreshes when explicitly requested", async () => {
    const me = await setupUser("Admin");
    await setupVapidKeys(me.id);
    const before = await readVapidKeys(testDb);

    const result = await generateVapidKeys(
      testDb,
      { subject: "mailto:it@example.test", replace: true },
      me.id,
      NOW,
    );

    expect(result.ok).toBe(true);
    expect((await readVapidKeys(testDb))?.publicKey).not.toBe(before?.publicKey);
  });

  it("rejects invalid contact address", async () => {
    const me = await setupUser("Admin");

    const result = await generateVapidKeys(
      testDb,
      { subject: "it@example.test" },
      me.id,
      NOW,
    );

    expect(result.ok).toBe(false);
  });
});

describe("subscription registration", () => {
  it("does not create a duplicate row when same browser subscribes again", async () => {
    const user = await setupUser();

    await saveSubscription(testDb, user.id, createSubscription(1), NOW);
    await saveSubscription(testDb, user.id, createSubscription(1), NOW);

    expect(await countSubscriptions(testDb, user.id)).toBe(1);
  });

  it("transfers subscription ownership on shared browser", async () => {
    const firstUser = await setupUser("First");
    const secondUser = await testDb.user.create({
      data: {
        fullName: "Second",
        email: "second@example.test",
        orgUnitId: firstUser.orgUnitId,
      },
    });

    await saveSubscription(testDb, firstUser.id, createSubscription(1), NOW);
    await saveSubscription(testDb, secondUser.id, createSubscription(1), NOW);

    // If notifications kept going to previous user, data leakage would occur.
    expect(await countSubscriptions(testDb, firstUser.id)).toBe(0);
    expect(await countSubscriptions(testDb, secondUser.id)).toBe(1);
  });

  it("cannot remove someone else's subscription", async () => {
    const owner = await setupUser("Owner");
    const otherUser = await testDb.user.create({
      data: {
        fullName: "Other",
        email: "other@example.test",
        orgUnitId: owner.orgUnitId,
      },
    });
    await saveSubscription(testDb, owner.id, createSubscription(1), NOW);

    const result = await removeSubscription(testDb, otherUser.id, createSubscription(1).endpoint);

    expect(result).toBe(false);
    expect(await countSubscriptions(testDb, owner.id)).toBe(1);
  });
});

describe("enqueuing", () => {
  it("does not enqueue push row for user without subscription", async () => {
    const user = await setupUser();

    await enqueueNotification(testDb, {
      userId: user.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: buildPayload(user.id),
      idempotencyKey: "question_asked:1",
      now: NOW,
    });

    expect(
      await testDb.notificationQueue.count({ where: { channel: "PUSH" } }),
    ).toBe(0);
    expect(
      await testDb.notificationQueue.count({ where: { channel: "EMAIL" } }),
    ).toBe(1);
  });

  it("enqueues both channels for subscribed user", async () => {
    const user = await setupUser();
    await saveSubscription(testDb, user.id, createSubscription(1), NOW);

    await enqueueNotification(testDb, {
      userId: user.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: buildPayload(user.id),
      idempotencyKey: "question_asked:1",
      now: NOW,
    });

    expect(
      await testDb.notificationQueue.count({ where: { channel: "PUSH" } }),
    ).toBe(1);
    expect(
      await testDb.notificationQueue.count({ where: { channel: "EMAIL" } }),
    ).toBe(1);
  });

  it("only writes email for events not suitable for push", async () => {
    const user = await setupUser();
    await saveSubscription(testDb, user.id, createSubscription(1), NOW);

    await enqueueNotification(testDb, {
      userId: user.id,
      eventType: NOTIFICATION_EVENTS.passwordReset,
      payload: { token: "x" },
      idempotencyKey: "password_reset:1",
      now: NOW,
    });

    // Password reset links belong in email, not on the lock screen.
    expect(
      await testDb.notificationQueue.count({ where: { channel: "PUSH" } }),
    ).toBe(0);
  });
});

describe("dispatching", () => {
  async function setup() {
    const user = await setupUser();
    await setupVapidKeys(user.id);
    return user;
  }

  it("does not attempt if VAPID keys not configured", async () => {
    const user = await setupUser();
    await saveSubscription(testDb, user.id, createSubscription(1), NOW);
    await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.questionAsked,
        channel: "PUSH",
        payload: buildPayload(user.id),
        idempotencyKey: "push:1",
      },
    });

    const transport = fakePushTransport({});
    const result = await dispatchPushNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://example.test",
    });

    expect(transport.calls).toEqual([]);
    expect(result.sent).toBe(0);
  });

  it("drops dead subscription (410 Gone)", async () => {
    const user = await setup();
    await saveSubscription(testDb, user.id, createSubscription(1), NOW);
    await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.questionAsked,
        channel: "PUSH",
        payload: buildPayload(user.id),
        idempotencyKey: "push:1",
      },
    });

    const transport = fakePushTransport({
      [createSubscription(1).endpoint]: { ok: false, gone: true },
    });
    const result = await dispatchPushNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://example.test",
    });

    expect(result.droppedSubscriptions).toBe(1);
    expect(await countSubscriptions(testDb, user.id)).toBe(0);
  });

  it("delivery to a single device is sufficient", async () => {
    const user = await setup();
    await saveSubscription(testDb, user.id, createSubscription(1), NOW);
    await saveSubscription(testDb, user.id, createSubscription(2), NOW);
    const queueItem = await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.approvalPending,
        channel: "PUSH",
        payload: buildPayload(user.id),
        idempotencyKey: "push:1",
      },
    });

    // One dead phone, one active phone.
    const transport = fakePushTransport({
      [createSubscription(1).endpoint]: { ok: false, gone: true },
    });
    const result = await dispatchPushNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://example.test",
    });

    expect(result.delivered).toBe(1);
    const updated = await testDb.notificationQueue.findUniqueOrThrow({
      where: { id: queueItem.id },
    });
    expect(updated.status).toBe("SENT");
  });

  it("retries and increments attempt count on transient error", async () => {
    const user = await setup();
    await saveSubscription(testDb, user.id, createSubscription(1), NOW);
    const queueItem = await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.questionAsked,
        channel: "PUSH",
        payload: buildPayload(user.id),
        idempotencyKey: "push:1",
      },
    });

    const transport = fakePushTransport({
      [createSubscription(1).endpoint]: { ok: false, gone: false, message: "503" },
    });
    await dispatchPushNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://example.test",
    });

    const updated = await testDb.notificationQueue.findUniqueOrThrow({
      where: { id: queueItem.id },
    });
    expect(updated.status).toBe("PENDING");
    expect(updated.attemptCount).toBe(1);
    // Subscription is not dropped: transient error is not permanent error.
    expect(await countSubscriptions(testDb, user.id)).toBe(1);
  });

  it("abandons queue item when user has no remaining subscriptions", async () => {
    const user = await setup();
    const queueItem = await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.questionAsked,
        channel: "PUSH",
        payload: buildPayload(user.id),
        idempotencyKey: "push:1",
      },
    });

    const result = await dispatchPushNotifications(testDb, fakePushTransport({}), {
      now: NOW,
      baseUrl: "https://example.test",
    });

    expect(result.givenUp).toBe(1);
    const updated = await testDb.notificationQueue.findUniqueOrThrow({
      where: { id: queueItem.id },
    });
    expect(updated.status).toBe("FAILED");
  });

  it("does not touch email queue items", async () => {
    const user = await setup();
    await saveSubscription(testDb, user.id, createSubscription(1), NOW);
    const emailQueueItem = await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.questionAsked,
        channel: "EMAIL",
        payload: buildPayload(user.id),
        idempotencyKey: "email:1",
      },
    });

    await dispatchPushNotifications(testDb, fakePushTransport({}), {
      now: NOW,
      baseUrl: "https://example.test",
    });

    // The two channels are independent: push loop must not consume email queue.
    const updated = await testDb.notificationQueue.findUniqueOrThrow({
      where: { id: emailQueueItem.id },
    });
    expect(updated.status).toBe("PENDING");
    expect(updated.attemptCount).toBe(0);
  });

  it("dropped subscription is physically deleted", async () => {
    const user = await setup();
    await saveSubscription(testDb, user.id, createSubscription(1), NOW);

    await dropSubscription(testDb, createSubscription(1).endpoint);

    expect(await countSubscriptions(testDb, user.id)).toBe(0);
  });
});
