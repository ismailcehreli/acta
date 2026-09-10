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

async function kisi() {
  const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
  return createUser(unit.id);
}

async function olayEkle(userId: string, idempotencyKey: string) {
  return enqueueNotification(testDb, {
    userId,
    eventType: NOTIFICATION_EVENTS.questionAsked,
    payload: {},
    idempotencyKey,
    now: NOW,
  });
}

describe("bildirim olay ayarları", () => {
  it("kapatılan olay kuyruğa yazılmaz", async () => {
    const user = await kisi();
    const sonuc = await saveSettings(testDb, {
      [notificationEnabledKey(NOTIFICATION_EVENTS.questionAsked)]: "false",
    });

    expect(sonuc.ok).toBe(true);
    expect(await olayEkle(user.id, "kapali:1")).toBe(false);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("yalnız seçilen kanala kayıt yazar", async () => {
    const user = await kisi();
    await saveSubscription(
      testDb,
      user.id,
      {
        endpoint: "https://push.ornek.test/policy-1",
        p256dh: "BExampleKeyMaterial",
        auth: "ExampleAuthSecret",
      },
      NOW,
    );

    const sonuc = await saveSettings(testDb, {
      [notificationChannelKey(NOTIFICATION_EVENTS.questionAsked)]: "PUSH",
    });
    expect(sonuc.ok).toBe(true);

    expect(await olayEkle(user.id, "push:1")).toBe(true);
    expect(
      await testDb.notificationQueue.findMany({
        select: { channel: true },
        orderBy: { channel: "asc" },
      }),
    ).toEqual([{ channel: "PUSH" }]);
  });

  it("parola bağlantısı taşıyan olayın kapatma anahtarı yoktur", async () => {
    const key = notificationEnabledKey(NOTIFICATION_EVENTS.passwordReset);

    expect(findSetting(key)).toBeUndefined();

    const sonuc = await saveSettings(testDb, { [key]: "false" });
    expect(sonuc).toEqual({ ok: false, message: `Tanımsız ayar: ${key}` });
  });

  it("parola bağlantısı olayları varsayılan olarak e-postayı korur", async () => {
    const user = await kisi();

    expect(
      await enqueueNotification(testDb, {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.passwordReset,
        payload: { token: "sifirlama-belirteci" },
        idempotencyKey: "reset:1",
        now: NOW,
      }),
    ).toBe(true);

    const queue = await testDb.notificationQueue.findMany({
      select: { channel: true },
    });
    expect(queue).toEqual([{ channel: "EMAIL" }]);
  });

  it("zorunlu olay elle push kanalına çekilse bile e-postayı korur", async () => {
    const user = await kisi();
    await testDb.systemSetting.create({
      data: {
        key: notificationChannelKey(NOTIFICATION_EVENTS.passwordReset),
        value: "PUSH",
        description: "Test ayarı",
      },
    });

    expect(
      await enqueueNotification(testDb, {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.passwordReset,
        payload: { token: "sifirlama-belirteci" },
        idempotencyKey: "reset:elle-push",
        now: NOW,
      }),
    ).toBe(true);

    expect(
      await testDb.notificationQueue.findMany({
        select: { channel: true },
      }),
    ).toEqual([{ channel: "EMAIL" }]);
  });

  it("parola bağlantısı olayında yalnız push seçilemez", async () => {
    const definition = findSetting(
      notificationChannelKey(NOTIFICATION_EVENTS.passwordReset),
    );

    expect(definition).toBeDefined();
    expect(definition?.options?.map((option) => option.value)).toEqual([
      "EMAIL",
      "BOTH",
    ]);
    const sonuc = await saveSettings(testDb, {
      [notificationChannelKey(NOTIFICATION_EVENTS.passwordReset)]: "PUSH",
    });
    expect(sonuc).toEqual({
      ok: false,
      message: "Parola sıfırlama kanalı: geçerli bir seçenek seçin.",
    });
  });
});
