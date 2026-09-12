import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  countUnseen,
  listInbox,
  markInboxSeen,
  relativeTime,
} from "@/server/notifications/inbox";
import { saveSubscription } from "@/server/push/subscriptions";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// In-app notification inbox (Task 10.4).
//
// The inbox reads from the notification queue. Two things are critical:
// no one should see someone else's notification, and an event should not
// appear twice in the bell icon (separate queue rows may exist for push and email).

const NOW = new Date("2026-08-19T12:00:00.000Z");

beforeEach(async () => {
  activities.clear();
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

// Notifications link to a real activity: queue row is bound via foreign key
// and inbox filters visibility through that relation (finding 3).
// A user always sees their own records.
const activities = new Map<string, string>();

async function setupTwoUsers() {
  const unit = await createOrgUnit({ name: "Company", type: "Root" });
  const first = await createUser(unit.id, { fullName: "First" });
  const second = await createUser(unit.id, { fullName: "Second" });

  for (const user of [first, second]) {
    const activity = await createActivity(user, { approvalStatus: "APPROVED" });
    activities.set(user.id, activity.id);
  }

  return { first, second };
}

async function enqueueInboxNotification(
  userId: string,
  key: string,
  title = "Maintenance task",
  eventType: string = NOTIFICATION_EVENTS.questionAsked,
) {
  await enqueueNotification(testDb, {
    userId,
    eventType: eventType as typeof NOTIFICATION_EVENTS.questionAsked,
    payload: { activityId: activities.get(userId), activityTitle: title },
    idempotencyKey: key,
    now: NOW,
  });
}

describe("inbox ownership", () => {
  it("user sees only their own notifications", async () => {
    const { first, second } = await setupTwoUsers();
    await enqueueInboxNotification(first.id, "a:1", "First's task");
    await enqueueInboxNotification(second.id, "a:2", "Second's task");

    const inbox = await listInbox(testDb, first.id);

    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.summary).not.toContain("Second's task");
  });

  it("unseen count is user-specific", async () => {
    const { first, second } = await setupTwoUsers();
    await enqueueInboxNotification(first.id, "a:1");
    await enqueueInboxNotification(second.id, "a:2");
    await enqueueInboxNotification(second.id, "a:3");

    expect(await countUnseen(testDb, first.id)).toBe(1);
    expect(await countUnseen(testDb, second.id)).toBe(2);
  });

  it("marking seen does not clear another user's inbox", async () => {
    const { first, second } = await setupTwoUsers();
    await enqueueInboxNotification(first.id, "a:1");
    await enqueueInboxNotification(second.id, "a:2");

    await markInboxSeen(testDb, first.id, NOW);

    expect(await countUnseen(testDb, first.id)).toBe(0);
    // Should not clear another user's bell indicator
    expect(await countUnseen(testDb, second.id)).toBe(1);
  });
});

describe("duplicate suppression", () => {
  it("same event with push appears only once in bell", async () => {
    const { first } = await setupTwoUsers();
    // Subscribed users get both email and push rows
    await saveSubscription(
      testDb,
      first.id,
      {
        endpoint: "https://push.example.test/sub-1",
        p256dh: "BExampleKeyMaterial",
        auth: "ExampleAuthSecret",
      },
      NOW,
    );

    await enqueueInboxNotification(first.id, "a:1");

    expect(await testDb.notificationQueue.count({ where: { userId: first.id } })).toBe(2);
    // Bell reads canonical row (EMAIL)
    expect(await listInbox(testDb, first.id)).toHaveLength(1);
    expect(await countUnseen(testDb, first.id)).toBe(1);
  });

  it("each notification generates exactly one email row", async () => {
    // Bell correctness relies on this invariant: canonical row is EMAIL.
    // If an event doesn't write an email row, the bell misses it silently;
    // this test locks that invariant.
    const { first } = await setupTwoUsers();

    for (const [i, event] of Object.values(NOTIFICATION_EVENTS).entries()) {
      await enqueueInboxNotification(first.id, `event:${i}`, "Record", event);
    }

    const emailCount = await testDb.notificationQueue.count({
      where: { userId: first.id, channel: "EMAIL" },
    });
    expect(emailCount).toBe(Object.values(NOTIFICATION_EVENTS).length);
  });
});

describe("ordering and content", () => {
  it("orders from newest to oldest", async () => {
    const { first } = await setupTwoUsers();
    await testDb.notificationQueue.createMany({
      data: [
        {
          userId: first.id,
          eventType: NOTIFICATION_EVENTS.activityApproved,
          channel: "EMAIL",
          payload: { activityTitle: "Older" },
          idempotencyKey: "e:1",
          createdAt: new Date("2026-08-18T09:00:00.000Z"),
        },
        {
          userId: first.id,
          eventType: NOTIFICATION_EVENTS.activityApproved,
          channel: "EMAIL",
          payload: { activityTitle: "Newer" },
          idempotencyKey: "e:2",
          createdAt: new Date("2026-08-19T09:00:00.000Z"),
        },
      ],
    });

    const inbox = await listInbox(testDb, first.id);

    expect(inbox[0]?.summary).toContain("Newer");
    expect(inbox[1]?.summary).toContain("Older");
  });

  it("line summary comes from notification template", async () => {
    const { first } = await setupTwoUsers();
    await enqueueInboxNotification(first.id, "a:1", "Maintenance task", NOTIFICATION_EVENTS.activityApproved);

    const inbox = await listInbox(testDb, first.id);

    expect(inbox[0]?.summary).toContain("Maintenance task");
    expect(inbox[0]?.path).toContain("/activities/");
  });

  it("respects list limit", async () => {
    const { first } = await setupTwoUsers();
    for (let i = 0; i < 20; i += 1) await enqueueInboxNotification(first.id, `a:${i}`);

    expect(await listInbox(testDb, first.id, 5)).toHaveLength(5);
  });
});

describe("relative time", () => {
  it("under a minute is 'just now'", () => {
    expect(relativeTime(new Date("2026-08-19T11:59:30.000Z"), NOW)).toBe("just now");
  });

  it("under an hour is minutes", () => {
    expect(relativeTime(new Date("2026-08-19T11:20:00.000Z"), NOW)).toBe("40m ago");
  });

  it("under a day is hours", () => {
    expect(relativeTime(new Date("2026-08-19T09:00:00.000Z"), NOW)).toBe("3h ago");
  });

  it("older displays date and time", () => {
    // 09:00 UTC = 12:00 Istanbul.
    expect(relativeTime(new Date("2026-08-15T09:00:00.000Z"), NOW)).toBe(
      "Aug 15 12:00",
    );
  });
});

describe("activity number", () => {
  it("includes activity number when referencing a real record", async () => {
    const { first } = await setupTwoUsers();
    const activity = await createActivity(first, { approvalStatus: "APPROVED" });

    await enqueueNotification(testDb, {
      userId: first.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: { activityId: activity.id, activityTitle: activity.title },
      idempotencyKey: "number:1",
      now: NOW,
    });

    const inbox = await listInbox(testDb, first.id);
    expect(inbox.map((row) => row.activityNo)).toContain(activity.activityNo);
  });

  it("renders null activity number when notification is not tied to activity", async () => {
    const { first } = await setupTwoUsers();

    // Password resets have no activity; visibility does not apply, visible unconditionally.
    await enqueueNotification(testDb, {
      userId: first.id,
      eventType: NOTIFICATION_EVENTS.passwordReset,
      payload: { link: "https://example.test/reset/abc" },
      idempotencyKey: "number:2",
      now: NOW,
    });

    const inbox = await listInbox(testDb, first.id);
    const row = inbox.find((s) => s.eventType === NOTIFICATION_EVENTS.passwordReset);
    expect(row).toBeDefined();
    expect(row?.activityNo).toBeNull();
    expect(row?.summary).not.toBe("");
  });
});

describe("inbox visibility enforcement", () => {
  it("does not list or count notification for inaccessible activity", async () => {
    const { first, second } = await setupTwoUsers();
    const otherActivity = await createActivity(second, {
      approvalStatus: "APPROVED",
    });

    await enqueueNotification(testDb, {
      userId: first.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: {
        activityId: otherActivity.id,
        activityTitle: otherActivity.title,
      },
      idempotencyKey: "leak:1",
      now: NOW,
    });

    // Row exists in queue but does not appear in inbox
    expect(
      await testDb.notificationQueue.count({
        where: { userId: first.id, activityId: otherActivity.id },
      }),
    ).toBe(1);

    const inbox = await listInbox(testDb, first.id);
    expect(inbox.map((row) => row.summary).join(" ")).not.toContain(
      otherActivity.title,
    );

    // Counter must not leak information either
    expect(await countUnseen(testDb, first.id)).toBe(0);
  });

  it("shows notification for accessible own activity", async () => {
    const { first } = await setupTwoUsers();
    const ownActivity = await createActivity(first, { approvalStatus: "APPROVED" });

    await enqueueNotification(testDb, {
      userId: first.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: { activityId: ownActivity.id, activityTitle: ownActivity.title },
      idempotencyKey: "visible:1",
      now: NOW,
    });

    expect(await countUnseen(testDb, first.id)).toBe(1);
  });
});
