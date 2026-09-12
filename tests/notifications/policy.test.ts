import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  notificationChannelKey,
  notificationEnabledKey,
  findSetting,
} from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";
import { saveSubscription } from "@/server/push/subscriptions";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-28T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupUser() {
  const unit = await createOrgUnit({ name: "Company", type: "Root" });
  return createUser(unit.id);
}

async function enqueueItem(userId: string, idempotencyKey: string) {
  return enqueueNotification(testDb, {
    userId,
    eventType: NOTIFICATION_EVENTS.questionAsked,
    payload: {},
    idempotencyKey,
    now: NOW,
  });
}

describe("notification event settings", () => {
  it("disabled event is not written to queue", async () => {
    const user = await setupUser();
    const result = await saveSettings(testDb, {
      [notificationEnabledKey(NOTIFICATION_EVENTS.questionAsked)]: "false",
    });

    expect(result.ok).toBe(true);
    expect(await enqueueItem(user.id, "disabled:1")).toBe(false);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("enqueues only to the selected channel", async () => {
    const user = await setupUser();
    await saveSubscription(
      testDb,
      user.id,
      {
        endpoint: "https://push.example.test/policy-1",
        p256dh: "BExampleKeyMaterial",
        auth: "ExampleAuthSecret",
      },
      NOW,
    );

    const result = await saveSettings(testDb, {
      [notificationChannelKey(NOTIFICATION_EVENTS.questionAsked)]: "PUSH",
    });
    expect(result.ok).toBe(true);

    expect(await enqueueItem(user.id, "push:1")).toBe(true);
    expect(
      await testDb.notificationQueue.findMany({
        select: { channel: true },
        orderBy: { channel: "asc" },
      }),
    ).toEqual([{ channel: "PUSH" }]);
  });

  it("events carrying password links do not have a disable key", async () => {
    const key = notificationEnabledKey(NOTIFICATION_EVENTS.passwordReset);

    expect(findSetting(key)).toBeUndefined();

    const result = await saveSettings(testDb, { [key]: "false" });
    expect(result).toEqual({
      ok: false,
      error: "undefined_setting",
      message: `Undefined setting: ${key}`,
      messageKey: "errors.settings.undefinedSetting",
      messageValues: { key },
    });
  });

  it("password link events preserve email by default", async () => {
    const user = await setupUser();

    expect(
      await enqueueNotification(testDb, {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.passwordReset,
        payload: { token: "reset-token" },
        idempotencyKey: "reset:1",
        now: NOW,
      }),
    ).toBe(true);

    const queue = await testDb.notificationQueue.findMany({
      select: { channel: true },
    });
    expect(queue).toEqual([{ channel: "EMAIL" }]);
  });

  it("mandatory events preserve email even if manually forced to push", async () => {
    const user = await setupUser();
    await testDb.systemSetting.create({
      data: {
        key: notificationChannelKey(NOTIFICATION_EVENTS.passwordReset),
        value: "PUSH",
        description: "Test setting",
      },
    });

    expect(
      await enqueueNotification(testDb, {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.passwordReset,
        payload: { token: "reset-token" },
        idempotencyKey: "reset:manual-push",
        now: NOW,
      }),
    ).toBe(true);

    expect(
      await testDb.notificationQueue.findMany({
        select: { channel: true },
      }),
    ).toEqual([{ channel: "EMAIL" }]);
  });

  it("cannot select push-only for password link event", async () => {
    const definition = findSetting(
      notificationChannelKey(NOTIFICATION_EVENTS.passwordReset),
    );

    expect(definition).toBeDefined();
    expect(definition?.options?.map((option) => option.value)).toEqual([
      "EMAIL",
      "BOTH",
    ]);
    const result = await saveSettings(testDb, {
      [notificationChannelKey(NOTIFICATION_EVENTS.passwordReset)]: "PUSH",
    });
    expect(result).toEqual({
      ok: false,
      error: "invalid_value",
      message: "Password reset channel: choose a valid option.",
      messageKey: "errors.settings.option",
      messageValues: { label: "Password reset channel" },
    });
  });
});
