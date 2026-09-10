import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { dispatchNotifications } from "@/worker/notifications/dispatcher";
import type {
  EmailMessage,
  EmailTransport,
} from "@/worker/notifications/transport";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Kabul kriteri: **bildirim gecikmesi < 5 dakika** (§18.4, Görev 6.3).
//
// Gecikme iki parçadan oluşuyor:
//
//   1. İşçinin bir sonraki turunu beklemek — tur aralığı sabittir ve
//      `TICK_INTERVAL_MS` ile ölçülür.
//   2. Kuyruğun o turda işlenmesi — burada ölçülen bu.
//
// Ölçüm gerçek SMTP'ye çıkmıyor; taşıyıcı yerine sayaç konuyor. Sınanan şey
// posta sunucusunun hızı değil, **kuyruğun kendi işleme süresi**: yüz kişilik
// bir bildirim dalgası tek turda eriyor mu.

const NOW = new Date("2026-08-22T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Gönderimi sayan sahte taşıyıcı; ağa çıkmaz. */
function sayanTasiyici(): EmailTransport & { gonderilen: EmailMessage[] } {
  const gonderilen: EmailMessage[] = [];
  return {
    name: "kabul-olcumu",
    gonderilen,
    async send(message) {
      gonderilen.push(message);
    },
  };
}

describe("kuyruk işleme süresi", () => {
  it("yüz kişilik bildirim dalgası tek turda erir", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });

    const kisiler = [];
    for (let i = 0; i < 100; i += 1) {
      kisiler.push(await createUser(birim.id, { fullName: `Kişi ${i}` }));
    }

    for (const kisi of kisiler) {
      await enqueueNotification(testDb, {
        userId: kisi.id,
        eventType: NOTIFICATION_EVENTS.noActivityToday,
        payload: { day: "2026-08-21" },
        idempotencyKey: `no_activity_today:${kisi.id}:2026-08-21`,
        now: NOW,
      });
    }

    const tasiyici = sayanTasiyici();
    const basla = Date.now();

    const sonuc = await dispatchNotifications(testDb, tasiyici, {
      now: NOW,
      baseUrl: "http://localhost:3100",
    });

    const sureMs = Date.now() - basla;

    expect(sonuc.sent).toBe(100);
    expect(tasiyici.gonderilen).toHaveLength(100);

    // Kabul sınırı 5 dakika; ölçülen süre bunun çok altında olmalı.
    // Eşik bilerek gevşek: burada sınanan şey "makul mü", "ne kadar hızlı"
    // değil — kesin sayı kabul raporuna yazılıyor.
    expect(sureMs).toBeLessThan(30_000);
    console.log(`KUYRUK|100|${sureMs}`);
  });

  it("kuyruk boşken tur boşa dönmez", async () => {
    const sonuc = await dispatchNotifications(testDb, sayanTasiyici(), {
      now: NOW,
      baseUrl: "http://localhost:3100",
    });

    expect(sonuc.sent).toBe(0);
  });
});
