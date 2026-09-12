import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { RETRY_DELAYS_MS } from "@/server/notifications/schedule";
import { dispatchNotifications } from "@/worker/notifications/dispatcher";
import type { EmailMessage, EmailTransport } from "@/worker/notifications/transport";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Queue dispatcher (§12.3): transactional outbox, deduplication, exponential
// backoff ≤5 retries, short-interval coalescing, daily digest mode.

const NOW = new Date("2026-08-17T09:00:00.000Z");
const BASE = { now: NOW, baseUrl: "https://acta.example.test" };

beforeEach(async () => {
  activities.clear();
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function fakeTransport(): EmailTransport & { sentMessages: EmailMessage[] } {
  const sentMessages: EmailMessage[] = [];
  return {
    name: "fake",
    sentMessages,
    async send(message) {
      sentMessages.push(message);
    },
  };
}

function failingTransport(error = "SMTP unreachable"): EmailTransport {
  return {
    name: "failing",
    async send() {
      throw new Error(error);
    },
  };
}

// Notifications must be linked to a real activity.
// Foreign key constraint binds queue rows to activities, and visibility is queried at dispatch time.
const activities = new Map<string, string>();

async function setupUser(
  overrides: { notificationMode?: "INSTANT" | "DAILY_DIGEST" | "ACTION_ONLY" } = {},
) {
  const unit = await createOrgUnit({ name: "Company", type: "Root" });
  const user = await createUser(unit.id, { fullName: "Recipient", ...overrides });
  const record = await createActivity(user, { approvalStatus: "APPROVED" });
  activities.set(user.id, record.id);
  return user;
}

async function enqueueItem(
  userId: string,
  key: string,
  eventType: string = NOTIFICATION_EVENTS.questionAsked,
) {
  return enqueueNotification(testDb, {
    userId,
    eventType: eventType as never,
    payload: { activityId: activities.get(userId) },
    idempotencyKey: key,
    now: NOW,
  });
}

describe("duplicate protection (§12.3)", () => {
  it("sends single notification even if event is processed twice", async () => {
    const user = await setupUser();

    const first = await enqueueItem(user.id, "question_asked:abc");
    const second = await enqueueItem(user.id, "question_asked:abc");

    expect(first).toBe(true);
    // Second write is silently skipped and returns false to caller
    expect(second).toBe(false);
    expect(await testDb.notificationQueue.count()).toBe(1);

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, BASE);

    expect(transport.sentMessages).toHaveLength(1);
  });

  it("different idempotency keys create separate notifications", async () => {
    const user = await setupUser();
    await enqueueItem(user.id, "question_asked:abc");
    await enqueueItem(user.id, "question_asked:def");

    expect(await testDb.notificationQueue.count()).toBe(2);
  });
});

describe("dispatch and coalescing", () => {
  it("delivered record becomes SENT with timestamp recorded", async () => {
    const user = await setupUser();
    await enqueueItem(user.id, "question_asked:abc");

    const result = await dispatchNotifications(testDb, fakeTransport(), BASE);

    expect(result).toEqual({
      sent: 1,
      delivered: 1,
      failed: 0,
      givenUp: 0,
      cancelled: 0,
    });
    const record = await testDb.notificationQueue.findFirstOrThrow();
    expect(record.status).toBe("SENT");
    expect(record.sentAt).toEqual(NOW);
    expect(record.attemptCount).toBe(1);
  });

  it("coalesces notifications accumulated for the same user into a single email", async () => {
    const user = await setupUser();
    await enqueueItem(user.id, "question_asked:abc");
    await enqueueItem(user.id, "answer_received:def", NOTIFICATION_EVENTS.answerReceived);
    await enqueueItem(user.id, "activity_cancelled:ghi", NOTIFICATION_EVENTS.activityCancelled);

    const transport = fakeTransport();
    const result = await dispatchNotifications(testDb, transport, BASE);

    expect(transport.sentMessages).toHaveLength(1);
    expect(result.delivered).toBe(3);
    expect(transport.sentMessages[0].subject).toContain("3 notifications");
    expect(transport.sentMessages[0].text).toContain("Your question was answered");
    expect(transport.sentMessages[0].text).toContain("was cancelled");
  });

  it("sends separate emails to different recipients", async () => {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const firstUser = await createUser(unit.id, { fullName: "User One" });
    const secondUser = await createUser(unit.id, { fullName: "User Two" });
    await enqueueItem(firstUser.id, "question_asked:abc");
    await enqueueItem(secondUser.id, "question_asked:def");

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, BASE);

    expect(transport.sentMessages).toHaveLength(2);
    expect(new Set(transport.sentMessages.map((m) => m.to)).size).toBe(2);
  });

  it("email body does not carry activity content, refers to system url", async () => {
    const user = await setupUser();
    await enqueueItem(user.id, "question_asked:abc");

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, BASE);

    expect(transport.sentMessages[0].text).toContain(BASE.baseUrl);
  });

  it("delivered record is not re-sent in subsequent cycle", async () => {
    const user = await setupUser();
    await enqueueItem(user.id, "question_asked:abc");

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, BASE);
    await dispatchNotifications(testDb, transport, {
      ...BASE,
      now: new Date(NOW.getTime() + 3_600_000),
    });

    expect(transport.sentMessages).toHaveLength(1);
  });
});

describe("retry and exhaustion", () => {
  it("failed notification remains pending with error recorded", async () => {
    const user = await setupUser();
    await enqueueItem(user.id, "question_asked:abc");

    const result = await dispatchNotifications(testDb, failingTransport(), BASE);

    expect(result.failed).toBe(1);
    const record = await testDb.notificationQueue.findFirstOrThrow();
    expect(record.status).toBe("PENDING");
    expect(record.attemptCount).toBe(1);
    expect(record.lastError).toContain("SMTP unreachable");
  });

  it("does not retry before backoff delay has passed", async () => {
    const user = await setupUser();
    await enqueueItem(user.id, "question_asked:abc");
    await dispatchNotifications(testDb, failingTransport(), BASE);

    const transport = fakeTransport();
    // Right after first attempt: backoff delay not reached
    await dispatchNotifications(testDb, transport, {
      ...BASE,
      now: new Date(NOW.getTime() + RETRY_DELAYS_MS[0] - 1),
    });
    expect(transport.sentMessages).toHaveLength(0);

    // After delay expires: retries and succeeds
    await dispatchNotifications(testDb, transport, {
      ...BASE,
      now: new Date(NOW.getTime() + RETRY_DELAYS_MS[0]),
    });
    expect(transport.sentMessages).toHaveLength(1);
  });

  it("transitions to FAILED after 5 failed attempts and stops retrying", async () => {
    const user = await setupUser();
    await enqueueItem(user.id, "question_asked:abc");

    let time = NOW;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await dispatchNotifications(testDb, failingTransport(), { ...BASE, now: time });
      time = new Date(time.getTime() + (RETRY_DELAYS_MS[attempt] ?? 0));
    }

    let record = await testDb.notificationQueue.findFirstOrThrow();
    expect(record.attemptCount).toBe(5);
    expect(record.status).toBe("PENDING");

    // Next round gives up
    const transport = fakeTransport();
    const result = await dispatchNotifications(testDb, transport, { ...BASE, now: time });

    expect(result.givenUp).toBe(1);
    expect(transport.sentMessages).toHaveLength(0);
    record = await testDb.notificationQueue.findFirstOrThrow();
    expect(record.status).toBe("FAILED");
    expect(record.lastError).toContain("SMTP unreachable");
  });

  it("does not send to deactivated recipient, closes pending record", async () => {
    const user = await setupUser();
    await enqueueItem(user.id, "question_asked:abc");
    await testDb.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    const transport = fakeTransport();
    const result = await dispatchNotifications(testDb, transport, BASE);

    expect(transport.sentMessages).toHaveLength(0);
    expect(result.givenUp).toBe(1);
    const record = await testDb.notificationQueue.findFirstOrThrow();
    expect(record.status).toBe("FAILED");
    expect(record.lastError).toContain("inactive");
  });
});

describe("daily digest mode (§12.3)", () => {
  const digestTime = new Date("2026-08-17T15:00:00.000Z"); // 18:00 Istanbul

  it("does not send email before digest hour", async () => {
    const user = await setupUser({ notificationMode: "DAILY_DIGEST" });
    await enqueueItem(user.id, "question_asked:abc");

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, BASE);

    expect(transport.sentMessages).toHaveLength(0);
    const record = await testDb.notificationQueue.findFirstOrThrow();
    expect(record.status).toBe("PENDING");
    expect(record.attemptCount).toBe(0);
  });

  it("sends all day's notifications in single digest email at digest hour", async () => {
    const user = await setupUser({ notificationMode: "DAILY_DIGEST" });
    await enqueueItem(user.id, "question_asked:abc");
    await enqueueItem(user.id, "answer_received:def", NOTIFICATION_EVENTS.answerReceived);

    const transport = fakeTransport();
    const result = await dispatchNotifications(testDb, transport, {
      ...BASE,
      now: digestTime,
    });

    expect(transport.sentMessages).toHaveLength(1);
    expect(result.delivered).toBe(2);
    expect(transport.sentMessages[0].subject).toContain("daily digest");
  });

  it("does not send a second digest on the same day, sends next day", async () => {
    const user = await setupUser({ notificationMode: "DAILY_DIGEST" });
    await enqueueItem(user.id, "question_asked:abc");

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, { ...BASE, now: digestTime });
    expect(transport.sentMessages).toHaveLength(1);

    // New event on the same day: digest already sent, remains pending
    await enqueueItem(user.id, "answer_received:def", NOTIFICATION_EVENTS.answerReceived);
    await dispatchNotifications(testDb, transport, {
      ...BASE,
      now: new Date("2026-08-17T19:00:00.000Z"),
    });
    expect(transport.sentMessages).toHaveLength(1);

    // Dispatches next day at digest hour
    await dispatchNotifications(testDb, transport, {
      ...BASE,
      now: new Date("2026-08-18T15:00:00.000Z"),
    });
    expect(transport.sentMessages).toHaveLength(2);
  });

  it("users not in digest mode are dispatched immediately", async () => {
    const user = await setupUser({ notificationMode: "INSTANT" });
    await enqueueItem(user.id, "question_asked:abc");

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, BASE);

    expect(transport.sentMessages).toHaveLength(1);
  });
});

describe("notification preference (Task 10.8)", () => {
  it("does not send informational items in ACTION_ONLY mode", async () => {
    const user = await setupUser({ notificationMode: "ACTION_ONLY" });
    await enqueueItem(user.id, "info:1", NOTIFICATION_EVENTS.activityApproved);

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://example.test",
    });

    expect(transport.sentMessages).toHaveLength(0);

    const record = await testDb.notificationQueue.findFirstOrThrow({
      where: { userId: user.id, idempotencyKey: "info:1" },
    });
    expect(record.status).toBe("SENT");
    expect(record.lastError).toContain("preference");
  });

  it("sends action-required notification in ACTION_ONLY mode", async () => {
    const user = await setupUser({ notificationMode: "ACTION_ONLY" });
    await enqueueItem(user.id, "action:1", NOTIFICATION_EVENTS.questionAsked);

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://example.test",
    });

    expect(transport.sentMessages).toHaveLength(1);
  });

  it("sends urgent notifications regardless of preference", async () => {
    const user = await setupUser({ notificationMode: "ACTION_ONLY" });
    await enqueueItem(user.id, "urgent:1", NOTIFICATION_EVENTS.passwordReset);

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://example.test",
    });

    expect(transport.sentMessages).toHaveLength(1);
  });

  it("account creation link does not wait for daily digest", async () => {
    const user = await setupUser({ notificationMode: "DAILY_DIGEST" });
    await enqueueItem(user.id, "account:1", NOTIFICATION_EVENTS.accountCreated);

    const transport = fakeTransport();
    await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://example.test",
    });

    expect(transport.sentMessages).toHaveLength(1);
    expect(transport.sentMessages[0]?.text).toContain("account has been created");
  });
});

describe("visibility enforcement at dispatch time (audit 21.08.2026, finding 3)", () => {
  it("suppresses email and marks CANCELLED if recipient can no longer view activity", async () => {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const recipient = await createUser(unit.id, { fullName: "Recipient" });
    const otherUser = await createUser(unit.id, { fullName: "Other" });

    // Activity that recipient cannot view: peer's activity (§8.1)
    const record = await createActivity(otherUser, {
      approvalStatus: "APPROVED",
      title: "Secret title",
    });

    await enqueueNotification(testDb, {
      userId: recipient.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: { activityId: record.id, activityTitle: record.title },
      idempotencyKey: "leak:mail",
      now: NOW,
    });

    const transport = fakeTransport();
    const result = await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://example.test",
    });

    expect(result.sent).toBe(0);
    expect(result.cancelled).toBe(1);
    expect(transport.sentMessages).toHaveLength(0);

    const row = await testDb.notificationQueue.findFirstOrThrow({
      where: { userId: recipient.id },
    });
    expect(row.status).toBe("CANCELLED");
  });

  it("normally dispatches notification for accessible activity", async () => {
    const user = await setupUser();
    await enqueueItem(user.id, "visible:mail");

    const transport = fakeTransport();
    const result = await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://example.test",
    });

    expect(result.sent).toBe(1);
    expect(result.cancelled).toBe(0);
  });
});
