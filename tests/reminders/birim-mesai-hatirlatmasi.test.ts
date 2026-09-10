import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { saveUnitWorkCalendar } from "@/server/calendar/unit-calendar";
import { saveWorkCalendar } from "@/server/calendar/settings";
import { sendMissingActivityReminders } from "@/worker/reminders/no-activity";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Mesai sonu hatırlatması artık **birimin** penceresine bakıyor (Görev 11.9).
//
// Ürün sahibinin somut ihtiyacı: bir depo 07:00–17:00, diğeri 08:00–18:00
// çalışıyor. Şirket geneli tek pencerede depo çalışanına bir saat geç
// hatırlatma gidiyordu.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** 22 Ağustos 2026 Cumartesi değil; 21 Ağustos 2026 Cuma seçildi. */
const CUMA = "2026-08-21";

/** Verilen saatte (şirket saati) bir an. UTC = İstanbul − 3. */
function saat(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 7, 21, (h as number) - 3, m as number));
}

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const depoA = await createOrgUnit({ name: "Depo A", parentId: kok.id });
  const depoB = await createOrgUnit({ name: "Depo B", parentId: kok.id });

  const ahmet = await createUser(depoA.id, { fullName: "Ahmet" });
  const zeynep = await createUser(depoB.id, { fullName: "Zeynep" });

  await saveWorkCalendar(testDb, {
    workingDays: [1, 2, 3, 4, 5],
    workStartMinute: 8 * 60,
    workEndMinute: 18 * 60,
  });

  return { depoA, depoB, ahmet, zeynep };
}

describe("mesai penceresi birim bazlı", () => {
  it("erken kapanan depoya mesaisinden 1 saat önce (16:00) hatırlatma gider", async () => {
    const { depoA, ahmet, zeynep } = await sirket();
    await saveUnitWorkCalendar(testDb, depoA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: false,
    });

    const sonuc = await sendMissingActivityReminders(testDb, saat("16:05"));

    expect(sonuc.queued).toBe(1);
    const kuyruk = await testDb.notificationQueue.findMany();
    expect(kuyruk.map((k) => k.userId)).toEqual([ahmet.id]);
    // Geç kapanan deponun hatırlatma vakti (17:00) henüz gelmedi.
    expect(kuyruk.map((k) => k.userId)).not.toContain(zeynep.id);
  });

  it("geç kapanan depoya da kendi mesaisinden 1 saat önce (17:00) gider", async () => {
    const { depoA, zeynep } = await sirket();
    await saveUnitWorkCalendar(testDb, depoA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: false,
    });

    const sonuc = await sendMissingActivityReminders(testDb, saat("17:05"));

    // İkisinin de hatırlatma vakti geldi; ikisine de gider.
    expect(sonuc.queued).toBe(2);
    const kuyruk = await testDb.notificationQueue.findMany();
    expect(kuyruk.map((k) => k.userId)).toContain(zeynep.id);
  });
});

describe("resmî tatil bayrağı", () => {
  it("tatilde çalışmayan birime hatırlatma gitmez", async () => {
    const { ahmet } = await sirket();
    await testDb.holiday.create({
      data: { date: new Date(`${CUMA}T00:00:00.000Z`), description: "Deneme tatili" },
    });

    const sonuc = await sendMissingActivityReminders(testDb, saat("18:05"));

    expect(sonuc.queued).toBe(0);
    expect(
      await testDb.notificationQueue.count({ where: { userId: ahmet.id } }),
    ).toBe(0);
  });

  it("tatilde çalışan birime gider", async () => {
    const { depoA, ahmet, zeynep } = await sirket();
    await testDb.holiday.create({
      data: { date: new Date(`${CUMA}T00:00:00.000Z`), description: "Deneme tatili" },
    });
    await saveUnitWorkCalendar(testDb, depoA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 8 * 60,
      workEndMinute: 18 * 60,
      worksOnHolidays: true,
    });

    const sonuc = await sendMissingActivityReminders(testDb, saat("18:05"));

    expect(sonuc.queued).toBe(1);
    const kuyruk = await testDb.notificationQueue.findMany();
    expect(kuyruk.map((k) => k.userId)).toEqual([ahmet.id]);
    expect(kuyruk.map((k) => k.userId)).not.toContain(zeynep.id);
  });
});

describe("çalışma günü birim bazlı", () => {
  it("cumartesi çalışan birime cumartesi de gider", async () => {
    const { depoA, ahmet } = await sirket();
    await saveUnitWorkCalendar(testDb, depoA.id, {
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 8 * 60,
      workEndMinute: 18 * 60,
      worksOnHolidays: false,
    });

    // 22 Ağustos 2026 Cumartesi, 18:05 şirket saati.
    const cumartesi = new Date(Date.UTC(2026, 7, 22, 15, 5));
    const sonuc = await sendMissingActivityReminders(testDb, cumartesi);

    expect(sonuc.queued).toBe(1);
    const kuyruk = await testDb.notificationQueue.findMany();
    expect(kuyruk.map((k) => k.userId)).toEqual([ahmet.id]);
  });
});
