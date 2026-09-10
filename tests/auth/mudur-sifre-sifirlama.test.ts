import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { sendPasswordResetForUser } from "@/server/auth/reset";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { createOrgUnit, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Müdürün tetiklediği şifre sıfırlama (Görev 11.7).
//
// **Müdür şifre belirleyemez.** Yalnız "sıfırlama bağlantısı gönder" der;
// bağlantı personelin kendi e-postasına gider ve şifreyi kişi kendisi
// belirler.
//
// Gerekçe: müdürün belirlediği şifre, müdürün bildiği şifredir. O andan sonra
// "bu kaydı kim yazdı" sorusunun cevabı kesin olmaktan çıkar ve denetim
// izinin değeri düşer. Sıfırlama e-postası bu bağı kurmaz.

const NOW = new Date("2026-08-22T09:00:00.000Z");
const SECRET = "test-icin-en-az-otuz-iki-karakterlik-anahtar";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kisi() {
  const unit = await createOrgUnit({ name: "Kalıphane", type: "Kök" });
  return createUserWithPassword(unit.id, "eski-parola-1234", {
    fullName: "Kadir Usta",
  });
}

describe("sıfırlama tetikleme", () => {
  it("bildirim kuyruğuna sıfırlama olayı yazar", async () => {
    const kadir = await kisi();

    const sonuc = await sendPasswordResetForUser(testDb, kadir.id, NOW, SECRET);

    expect(sonuc.ok).toBe(true);
    const kuyruk = await testDb.notificationQueue.findMany({
      where: { userId: kadir.id },
    });
    expect(kuyruk.map((k) => k.eventType)).toContain(
      NOTIFICATION_EVENTS.passwordReset,
    );
  });

  // Parola **değişmiyor**: tetikleme yalnız bağlantı gönderiyor. Müdürün
  // tetiklemesiyle kullanıcının oturumu düşmemeli, işi yarıda kalmamalı.
  it("mevcut parolayı ve oturumu bozmaz", async () => {
    const kadir = await kisi();
    const onceki = await testDb.userCredential.findUnique({
      where: { userId: kadir.id },
    });

    await sendPasswordResetForUser(testDb, kadir.id, NOW, SECRET);

    const sonraki = await testDb.userCredential.findUnique({
      where: { userId: kadir.id },
    });
    expect(sonraki?.passwordHash).toBe(onceki?.passwordHash);
    expect(sonraki?.version).toBe(onceki?.version);
  });

  it("pasif kullanıcı için tetiklenmez", async () => {
    const kadir = await kisi();
    await testDb.user.update({
      where: { id: kadir.id },
      data: { isActive: false },
    });

    const sonuc = await sendPasswordResetForUser(testDb, kadir.id, NOW, SECRET);

    expect(sonuc.ok).toBe(false);
    expect(
      await testDb.notificationQueue.count({ where: { userId: kadir.id } }),
    ).toBe(0);
  });

  it("olmayan kullanıcı için tetiklenmez", async () => {
    const sonuc = await sendPasswordResetForUser(
      testDb,
      "3f2a9c1e-0000-4000-8000-000000000009",
      NOW,
      SECRET,
    );

    expect(sonuc.ok).toBe(false);
  });
});
