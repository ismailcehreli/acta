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

// Web push (§12.3, Görev 5.3b).
//
// Kritik davranış: **ölü abonelik düşürülür.** Tutulsaydı her turda boşuna
// denenir, kuyruk hiç boşalmaz ve günlük hata mesajıyla dolardı.

const NOW = new Date("2026-08-19T09:00:00.000Z");
// Mühürleme sırrı **verilmez**: işleyici de uygulamanın gerçek sırrını
// kullanıyor. Testin başka bir sırla mühürlemesi, gönderim testlerini
// sessizce "anahtar yok" dalına düşürürdü.

beforeEach(async () => {
  faaliyetler.clear();
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

// Bildirim gerçek bir faaliyete bağlanır: kuyruk satırı faaliyete yabancı
// anahtarla bağlı (bulgu 3). Uydurma kimlik artık yazılamaz.
const faaliyetler = new Map<string, string>();

async function kisi(fullName = "Kişi") {
  const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const user = await createUser(unit.id, { fullName });
  // Kişi kendi kaydını her zaman görür; buradaki testlerin konusu görünürlük
  // değil, push gönderim davranışı.
  const kayit = await createActivity(user, { approvalStatus: "APPROVED" });
  faaliyetler.set(user.id, kayit.id);
  return user;
}

/** Kişinin kendi kaydına ait bildirim yükü. */
function yuk(userId: string) {
  return { activityId: faaliyetler.get(userId), activityTitle: "Kayıt" };
}

async function anahtarKur(actorId: string) {
  const sonuc = await generateVapidKeys(
    testDb,
    { subject: "mailto:bt@ornek.test" },
    actorId,
    NOW,
  );
  if (!sonuc.ok) throw new Error(`kurulum: ${sonuc.message}`);
}

function abonelik(n: number) {
  return {
    endpoint: `https://push.ornek.test/abone-${n}`,
    p256dh: "BExampleKeyMaterial-p256dh",
    auth: "ExampleAuthSecret",
  };
}

/** Verilen sonucu döndüren sahte taşıyıcı; çağrıları kaydeder. */
function sahteTasiyici(
  sonuclar: Record<string, PushSendOutcome>,
): PushTransport & { cagrilar: string[] } {
  const cagrilar: string[] = [];
  return {
    cagrilar,
    async send(endpoint) {
      cagrilar.push(endpoint.endpoint);
      return sonuclar[endpoint.endpoint] ?? { ok: true };
    },
  };
}

describe("VAPID anahtarları", () => {
  it("üretilir ve özel anahtar mühürlü saklanır", async () => {
    const me = await kisi("Yönetici");
    await anahtarKur(me.id);

    const keys = await readVapidKeys(testDb);
    expect(keys).not.toBeNull();
    expect(keys?.publicKey.length).toBeGreaterThan(20);

    // Ham özel anahtar veritabanında düz durmamalı.
    const kayit = await testDb.systemSetting.findUniqueOrThrow({
      where: { key: "vapid_private_key_sealed" },
    });
    expect(kayit.value).not.toBe(keys?.privateKey);
  });

  it("yanlış sırla özel anahtar çözülemez", async () => {
    const me = await kisi("Yönetici");
    await anahtarKur(me.id);

    // Sessizce boş anahtarla göndermeye çalışmak yerine kanal kapanır.
    expect(await readVapidKeys(testDb, "baska-bir-sir-32-karakterlik-metin!")).toBeNull();
  });

  it("mevcut çift kazara ezilmez", async () => {
    const me = await kisi("Yönetici");
    await anahtarKur(me.id);
    const once = await readVapidKeys(testDb);

    const sonuc = await generateVapidKeys(
      testDb,
      { subject: "mailto:bt@ornek.test" },
      me.id,
      NOW,
    );

    // Yenilemek bütün abonelikleri öldürür; açıkça istenmelidir.
    expect(sonuc.ok).toBe(false);
    expect((await readVapidKeys(testDb))?.publicKey).toBe(once?.publicKey);
  });

  it("açıkça istenirse yenilenir", async () => {
    const me = await kisi("Yönetici");
    await anahtarKur(me.id);
    const once = await readVapidKeys(testDb);

    const sonuc = await generateVapidKeys(
      testDb,
      { subject: "mailto:bt@ornek.test", replace: true },
      me.id,
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    expect((await readVapidKeys(testDb))?.publicKey).not.toBe(once?.publicKey);
  });

  it("geçersiz iletişim adresi reddedilir", async () => {
    const me = await kisi("Yönetici");

    const sonuc = await generateVapidKeys(
      testDb,
      { subject: "bt@ornek.test" },
      me.id,
      NOW,
    );

    expect(sonuc.ok).toBe(false);
  });
});

describe("abonelik kaydı", () => {
  it("aynı tarayıcı ikinci kez abone olunca yeni kayıt açılmaz", async () => {
    const user = await kisi();

    await saveSubscription(testDb, user.id, abonelik(1), NOW);
    await saveSubscription(testDb, user.id, abonelik(1), NOW);

    expect(await countSubscriptions(testDb, user.id)).toBe(1);
  });

  it("ortak tarayıcıda abonelik sahibi değişir", async () => {
    const birinci = await kisi("Birinci");
    const ikinci = await testDb.user.create({
      data: {
        fullName: "İkinci",
        email: "ikinci@ornek.test",
        orgUnitId: birinci.orgUnitId,
      },
    });

    await saveSubscription(testDb, birinci.id, abonelik(1), NOW);
    await saveSubscription(testDb, ikinci.id, abonelik(1), NOW);

    // Bildirimler eski kullanıcıya gitmeye devam etseydi kayıt sızıntısı olurdu.
    expect(await countSubscriptions(testDb, birinci.id)).toBe(0);
    expect(await countSubscriptions(testDb, ikinci.id)).toBe(1);
  });

  it("başkasının aboneliği kaldırılamaz", async () => {
    const sahibi = await kisi("Sahibi");
    const baskasi = await testDb.user.create({
      data: {
        fullName: "Başkası",
        email: "baskasi@ornek.test",
        orgUnitId: sahibi.orgUnitId,
      },
    });
    await saveSubscription(testDb, sahibi.id, abonelik(1), NOW);

    const sonuc = await removeSubscription(testDb, baskasi.id, abonelik(1).endpoint);

    expect(sonuc).toBe(false);
    expect(await countSubscriptions(testDb, sahibi.id)).toBe(1);
  });
});

describe("kuyruğa yazma", () => {
  it("aboneliği olmayana push satırı yazılmaz", async () => {
    const user = await kisi();

    await enqueueNotification(testDb, {
      userId: user.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: yuk(user.id),
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

  it("aboneliği olana iki kanal da yazılır", async () => {
    const user = await kisi();
    await saveSubscription(testDb, user.id, abonelik(1), NOW);

    await enqueueNotification(testDb, {
      userId: user.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: yuk(user.id),
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

  it("push'a değmeyen olayda yalnız e-posta yazılır", async () => {
    const user = await kisi();
    await saveSubscription(testDb, user.id, abonelik(1), NOW);

    await enqueueNotification(testDb, {
      userId: user.id,
      eventType: NOTIFICATION_EVENTS.passwordReset,
      payload: { token: "x" },
      idempotencyKey: "password_reset:1",
      now: NOW,
    });

    // Parola sıfırlama bağlantısı postadadır; kilit ekranında işi yok.
    expect(
      await testDb.notificationQueue.count({ where: { channel: "PUSH" } }),
    ).toBe(0);
  });
});

describe("gönderim", () => {
  async function hazirla() {
    const user = await kisi();
    await anahtarKur(user.id);
    return user;
  }

  it("anahtar kurulmadıysa hiç denenmez", async () => {
    const user = await kisi();
    await saveSubscription(testDb, user.id, abonelik(1), NOW);
    await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.questionAsked,
        channel: "PUSH",
        payload: yuk(user.id),
        idempotencyKey: "push:1",
      },
    });

    const tasiyici = sahteTasiyici({});
    const sonuc = await dispatchPushNotifications(testDb, tasiyici, {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    expect(tasiyici.cagrilar).toEqual([]);
    expect(sonuc.sent).toBe(0);
  });

  it("ölü abonelik (410) düşürülür", async () => {
    const user = await hazirla();
    await saveSubscription(testDb, user.id, abonelik(1), NOW);
    await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.questionAsked,
        channel: "PUSH",
        payload: yuk(user.id),
        idempotencyKey: "push:1",
      },
    });

    const tasiyici = sahteTasiyici({
      [abonelik(1).endpoint]: { ok: false, gone: true },
    });
    const sonuc = await dispatchPushNotifications(testDb, tasiyici, {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    // Tutulsaydı her turda boşuna denenirdi.
    expect(sonuc.droppedSubscriptions).toBe(1);
    expect(await countSubscriptions(testDb, user.id)).toBe(0);
  });

  it("bir cihaza gitmesi yeter", async () => {
    const user = await hazirla();
    await saveSubscription(testDb, user.id, abonelik(1), NOW);
    await saveSubscription(testDb, user.id, abonelik(2), NOW);
    const kayit = await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.approvalPending,
        channel: "PUSH",
        payload: yuk(user.id),
        idempotencyKey: "push:1",
      },
    });

    // Bir eski telefon ölü, biri sağlam.
    const tasiyici = sahteTasiyici({
      [abonelik(1).endpoint]: { ok: false, gone: true },
    });
    const sonuc = await dispatchPushNotifications(testDb, tasiyici, {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    expect(sonuc.delivered).toBe(1);
    const guncel = await testDb.notificationQueue.findUniqueOrThrow({
      where: { id: kayit.id },
    });
    expect(guncel.status).toBe("SENT");
  });

  it("geçici hatada kayıt bekler, deneme sayısı artar", async () => {
    const user = await hazirla();
    await saveSubscription(testDb, user.id, abonelik(1), NOW);
    const kayit = await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.questionAsked,
        channel: "PUSH",
        payload: yuk(user.id),
        idempotencyKey: "push:1",
      },
    });

    const tasiyici = sahteTasiyici({
      [abonelik(1).endpoint]: { ok: false, gone: false, message: "503" },
    });
    await dispatchPushNotifications(testDb, tasiyici, {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    const guncel = await testDb.notificationQueue.findUniqueOrThrow({
      where: { id: kayit.id },
    });
    expect(guncel.status).toBe("PENDING");
    expect(guncel.attemptCount).toBe(1);
    // Abonelik düşürülmez: geçici hata kalıcı hata değildir.
    expect(await countSubscriptions(testDb, user.id)).toBe(1);
  });

  it("aboneliği kalmayan kayıt kuyrukta birikmez", async () => {
    const user = await hazirla();
    const kayit = await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.questionAsked,
        channel: "PUSH",
        payload: yuk(user.id),
        idempotencyKey: "push:1",
      },
    });

    const sonuc = await dispatchPushNotifications(testDb, sahteTasiyici({}), {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    expect(sonuc.givenUp).toBe(1);
    const guncel = await testDb.notificationQueue.findUniqueOrThrow({
      where: { id: kayit.id },
    });
    expect(guncel.status).toBe("FAILED");
  });

  it("e-posta kayıtlarına dokunulmaz", async () => {
    const user = await hazirla();
    await saveSubscription(testDb, user.id, abonelik(1), NOW);
    const eposta = await testDb.notificationQueue.create({
      data: {
        userId: user.id,
        eventType: NOTIFICATION_EVENTS.questionAsked,
        channel: "EMAIL",
        payload: yuk(user.id),
        idempotencyKey: "email:1",
      },
    });

    await dispatchPushNotifications(testDb, sahteTasiyici({}), {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    // İki kanal bağımsız: push turu e-posta kuyruğunu tüketmemeli.
    const guncel = await testDb.notificationQueue.findUniqueOrThrow({
      where: { id: eposta.id },
    });
    expect(guncel.status).toBe("PENDING");
    expect(guncel.attemptCount).toBe(0);
  });

  it("düşürülen abonelik gerçekten silinir", async () => {
    const user = await hazirla();
    await saveSubscription(testDb, user.id, abonelik(1), NOW);

    await dropSubscription(testDb, abonelik(1).endpoint);

    expect(await countSubscriptions(testDb, user.id)).toBe(0);
  });
});
