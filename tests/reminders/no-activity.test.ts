import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { markNoActivityPeriod } from "@/server/absence/service";
import { addHoliday, saveWorkCalendar } from "@/server/calendar/settings";
import { DEFAULT_WORK_CALENDAR } from "@/server/calendar/settings";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";
import { sendMissingActivityReminders } from "@/worker/reminders/no-activity";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Mesai sonu hatırlatması (§12.1). Sahte saatle sınanır: hafta içi tetiklenir,
// hafta sonu ve tatilde tetiklenmez, izinliye gitmez, faaliyet girene gitmez.
//
// Şirket saati Europe/Istanbul (UTC+3): 15:00 UTC = 18:00 İstanbul, yani
// varsayılan mesai bitişinden (17:30) sonrası.

const MESAI_SONRASI = new Date("2026-08-17T15:00:00.000Z"); // Pazartesi 18:00
const MESAI_ICINDE = new Date("2026-08-17T09:00:00.000Z"); // Pazartesi 12:00

beforeEach(async () => {
  await resetDatabase();
  await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function ekip() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: root.id });

  const mudur = await createUser(kaliphane.id, {
    fullName: "Müdür",
    isUnitManager: true,
  });
  const calisan = await createUser(kaliphane.id, { fullName: "Çalışan" });

  return { mudur, calisan, kaliphane };
}

async function faaliyetYaz(
  author: { id: string; orgUnitId: string },
  day: string,
  approvalStatus: "APPROVED" | "CANCELLED" = "APPROVED",
) {
  return testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: author.orgUnitId,
      activityDate: new Date(`${day}T00:00:00.000Z`),
      title: "Başlık",
      description: "Açıklama",
      approvalStatus,
    },
  });
}

describe("ne zaman tetiklenir", () => {
  it("hafta içi mesai bitince hatırlatma kuyruğa yazılır", async () => {
    await ekip();

    const sonuc = await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    expect(sonuc.skippedNotDue).toBe(false);
    expect(sonuc.queued).toBe(2);
    const kuyruk = await testDb.notificationQueue.findMany();
    expect(kuyruk).toHaveLength(2);
    expect(kuyruk[0].eventType).toBe("no_activity_today");
  });

  it("mesai bitmeden tetiklenmez", async () => {
    await ekip();

    const sonuc = await sendMissingActivityReminders(testDb, MESAI_ICINDE);

    expect(sonuc.skippedNotDue).toBe(true);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("hafta sonu tetiklenmez", async () => {
    await ekip();
    // 22 Ağustos 2026 Cumartesi.
    const cumartesi = new Date("2026-08-22T15:00:00.000Z");

    const sonuc = await sendMissingActivityReminders(testDb, cumartesi);

    expect(sonuc.skippedNotDue).toBe(true);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("resmî tatilde tetiklenmez", async () => {
    await ekip();
    await addHoliday(testDb, { date: "2026-08-17", description: "Deneme tatili" });

    const sonuc = await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    expect(sonuc.skippedNotDue).toBe(true);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("takvim değişince yeni çalışma günü de tetikler", async () => {
    await ekip();
    await saveWorkCalendar(testDb, {
      ...DEFAULT_WORK_CALENDAR,
      workingDays: [1, 2, 3, 4, 5, 6],
    });
    const cumartesi = new Date("2026-08-22T15:00:00.000Z");

    const sonuc = await sendMissingActivityReminders(testDb, cumartesi);

    expect(sonuc.skippedNotDue).toBe(false);
    expect(sonuc.queued).toBeGreaterThan(0);
  });

  it("mesai bitişi takvimden okunur", async () => {
    await ekip();
    await saveWorkCalendar(testDb, {
      ...DEFAULT_WORK_CALENDAR,
      workEndMinute: 20 * 60, // 20:00
    });

    // 18:00 İstanbul: yeni mesai bitişinden önce.
    expect((await sendMissingActivityReminders(testDb, MESAI_SONRASI)).skippedNotDue).toBe(
      true,
    );
    // 20:30 İstanbul.
    const gec = new Date("2026-08-17T17:30:00.000Z");
    expect((await sendMissingActivityReminders(testDb, gec)).skippedNotDue).toBe(false);
  });
});

describe("kime gitmez", () => {
  it("bugün faaliyet girene gitmez", async () => {
    const { calisan } = await ekip();
    await faaliyetYaz(calisan, "2026-08-17");

    const sonuc = await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    expect(sonuc.skippedHasActivity).toBe(1);
    expect(sonuc.queued).toBe(1);
    const kuyruk = await testDb.notificationQueue.findMany();
    expect(kuyruk.map((k) => k.userId)).not.toContain(calisan.id);
  });

  it("dünkü faaliyet bugünü kurtarmaz", async () => {
    const { calisan } = await ekip();
    await faaliyetYaz(calisan, "2026-08-16");

    const sonuc = await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    expect(sonuc.queued).toBe(2);
  });

  it("iptal edilmiş faaliyet 'girdi' saymaz", async () => {
    const { calisan } = await ekip();
    await faaliyetYaz(calisan, "2026-08-17", "CANCELLED");

    const sonuc = await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    expect(sonuc.skippedHasActivity).toBe(0);
    expect(sonuc.queued).toBe(2);
  });

  it("faaliyet yazması beklenmeyen kişiye gitmez", async () => {
    const { calisan } = await ekip();
    await testDb.user.update({
      where: { id: calisan.id },
      data: { writesActivities: false },
    });

    const sonuc = await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    // Kişi hiç aday listesine girmez: "atlandı" bile sayılmaz, çünkü ondan
    // faaliyet beklenmiyor (§7.4 istisnası).
    expect(sonuc.queued).toBe(1);
    const kuyruk = await testDb.notificationQueue.findMany();
    expect(kuyruk.map((k) => k.userId)).not.toContain(calisan.id);
  });

  it("'faaliyet beklenmiyor' işareti taşıyana gitmez", async () => {
    const { mudur, calisan } = await ekip();
    await markNoActivityPeriod(
      testDb,
      mudur.id,
      { userId: calisan.id, startDate: "2026-08-17", endDate: "2026-08-21" },
      MESAI_ICINDE,
    );

    const sonuc = await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    expect(sonuc.skippedNoActivityMark).toBe(1);
    const kuyruk = await testDb.notificationQueue.findMany();
    expect(kuyruk.map((k) => k.userId)).not.toContain(calisan.id);
  });

  it("onay bekleyen talep hatırlatmayı durdurmaz", async () => {
    const { calisan } = await ekip();
    await testDb.noActivityPeriod.create({
      data: {
        userId: calisan.id,
        startDate: new Date("2026-08-17T00:00:00.000Z"),
        endDate: new Date("2026-08-21T00:00:00.000Z"),
        note: "Onay bekleyen talep",
        markedById: calisan.id,
        status: "PENDING",
      },
    });

    const sonuc = await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    expect(sonuc.skippedNoActivityMark).toBe(0);
    expect(sonuc.queued).toBe(2);
    expect((await testDb.notificationQueue.findMany()).map((k) => k.userId)).toContain(
      calisan.id,
    );
  });

  it("pasifleştirilmiş kullanıcıya gitmez", async () => {
    const { calisan } = await ekip();
    await testDb.user.update({
      where: { id: calisan.id },
      data: { isActive: false },
    });

    const sonuc = await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    expect(sonuc.queued).toBe(1);
    const kuyruk = await testDb.notificationQueue.findMany();
    expect(kuyruk.map((k) => k.userId)).not.toContain(calisan.id);
  });

  it("hatırlatma yalnız kişiye gider, yöneticisine değil", async () => {
    const { mudur, calisan } = await ekip();
    await faaliyetYaz(mudur, "2026-08-17");

    await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    const kuyruk = await testDb.notificationQueue.findMany();
    // Yalnız çalışan; yöneticiye "ekibin girmedi" bildirimi yok (§12.1).
    expect(kuyruk).toHaveLength(1);
    expect(kuyruk[0].userId).toBe(calisan.id);
  });
});

describe("günde tek hatırlatma", () => {
  it("aynı gün ikinci tur yeni kayıt yazmaz", async () => {
    await ekip();

    await sendMissingActivityReminders(testDb, MESAI_SONRASI);
    const ikinci = await sendMissingActivityReminders(
      testDb,
      new Date("2026-08-17T16:00:00.000Z"),
    );

    expect(ikinci.queued).toBe(0);
    expect(await testDb.notificationQueue.count()).toBe(2);
  });

  it("ertesi gün yeniden yazılır", async () => {
    await ekip();
    await sendMissingActivityReminders(testDb, MESAI_SONRASI);

    // 18 Ağustos Salı 18:00.
    const ertesiGun = await sendMissingActivityReminders(
      testDb,
      new Date("2026-08-18T15:00:00.000Z"),
    );

    expect(ertesiGun.queued).toBe(2);
    expect(await testDb.notificationQueue.count()).toBe(4);
  });
});

describe("mesai öncesi hatırlatma süresi ayarı (§12.1)", () => {
  it("varsayılan 60 dakika ile mesai bitmeden önce tetiklenir", async () => {
    await ekip();

    // 17:30 mesai bitişi; 60 dk önce = 16:30.
    // 16:25 İstanbul (13:25 UTC): henüz erken.
    const erken = new Date("2026-08-17T13:25:00.000Z");
    expect((await sendMissingActivityReminders(testDb, erken)).skippedNotDue).toBe(true);

    // 16:35 İstanbul (13:35 UTC): 16:30 geçmiş, tetiklenmeli.
    const vaktinde = new Date("2026-08-17T13:35:00.000Z");
    const sonuc = await sendMissingActivityReminders(testDb, vaktinde);
    expect(sonuc.skippedNotDue).toBe(false);
    expect(sonuc.queued).toBe(2);
  });

  it("ayar 0'a çekilince mesai bitmeden önce tetiklenmez, mesai bitince tetiklenir", async () => {
    await ekip();
    await saveSettings(testDb, {
      [SETTING_KEYS.noActivityReminderLeadMinutes]: "0",
    });

    // 17:00 İstanbul (14:00 UTC): mesai 17:30'da bittiği için 0 dk ile henüz erken.
    const mesaiIci = new Date("2026-08-17T14:00:00.000Z");
    expect((await sendMissingActivityReminders(testDb, mesaiIci)).skippedNotDue).toBe(true);

    // 17:35 İstanbul (14:35 UTC): mesai bitti, tetiklenmeli.
    const mesaiSonu = new Date("2026-08-17T14:35:00.000Z");
    const sonuc = await sendMissingActivityReminders(testDb, mesaiSonu);
    expect(sonuc.skippedNotDue).toBe(false);
    expect(sonuc.queued).toBe(2);
  });

  it("ayar 90 dakikaya çekilince 1.5 saat önce tetiklenir", async () => {
    await ekip();
    await saveSettings(testDb, {
      [SETTING_KEYS.noActivityReminderLeadMinutes]: "90",
    });

    // 17:30 - 90 dk = 16:00.
    // 15:55 İstanbul (12:55 UTC): henüz erken.
    const erken = new Date("2026-08-17T12:55:00.000Z");
    expect((await sendMissingActivityReminders(testDb, erken)).skippedNotDue).toBe(true);

    // 16:05 İstanbul (13:05 UTC): tetiklenmeli.
    const vaktinde = new Date("2026-08-17T13:05:00.000Z");
    const sonuc = await sendMissingActivityReminders(testDb, vaktinde);
    expect(sonuc.skippedNotDue).toBe(false);
    expect(sonuc.queued).toBe(2);
  });

  it("mesai başlangıcından daha önceye taşınamaz (clamping)", async () => {
    await ekip();
    // Mesai: 16:00 - 17:00 (kısa mesai).
    await saveWorkCalendar(testDb, {
      ...DEFAULT_WORK_CALENDAR,
      workStartMinute: 16 * 60,
      workEndMinute: 17 * 60,
    });
    // Süre: 120 dakika (17:00 - 120 = 15:00, mesai başlangıcı olan 16:00'dan önce).
    await saveSettings(testDb, {
      [SETTING_KEYS.noActivityReminderLeadMinutes]: "120",
    });

    // 15:30 İstanbul (12:30 UTC): mesai bile başlamadı, tetiklenmemeli.
    const mesaiOncesi = new Date("2026-08-17T12:30:00.000Z");
    expect((await sendMissingActivityReminders(testDb, mesaiOncesi)).skippedNotDue).toBe(
      true,
    );

    // 16:05 İstanbul (13:05 UTC): mesai başladı (16:00 alt sınırı), tetiklenmeli.
    const baslangicSonrasi = new Date("2026-08-17T13:05:00.000Z");
    const sonuc = await sendMissingActivityReminders(testDb, baslangicSonrasi);
    expect(sonuc.skippedNotDue).toBe(false);
    expect(sonuc.queued).toBe(2);
  });
});
