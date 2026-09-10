import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_WORK_CALENDAR, saveWorkCalendar } from "@/server/calendar/settings";
import { askQuestion, closeConversation } from "@/server/conversations/service";
import { markActivityAsRead } from "@/server/reads/service";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";
import { sendMissingActivityReminders } from "@/worker/reminders/no-activity";
import { sendOverdueAnswerReminders } from "@/worker/reminders/overdue-answers";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Ayarın ekranda görünmesi yetmez: **davranışı gerçekten değiştirmeli.**
// Bu dosya her parametrik kuralı iki farklı ayarla koşturup sonucun
// değiştiğini gösterir. Aksi hâlde ekran, hiçbir şeye bağlı olmayan bir form
// olurdu.

const ACILIS = new Date("2026-08-17T09:00:00.000Z"); // Pazartesi

beforeEach(async () => {
  await resetDatabase();
  await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const gm = await createOrgUnit({ name: "Genel Müdürlük", parentId: root.id });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: gm.id });

  const genelMudur = await createUser(gm.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const kalipMudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: kalipMudur.id,
      authorOrgUnitId: kaliphane.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Başlık",
      description: "Açıklama",
      approvalStatus: "APPROVED",
      createdAt: ACILIS,
      updatedAt: ACILIS,
    },
  });

  return { genelMudur, kalipMudur, activity };
}

describe("cevapsızlık hatırlatması ayarı (§12.2)", () => {
  async function konusmaAc() {
    const { genelMudur, activity } = await sirket();
    const soru = await askQuestion(
      testDb,
      { id: genelMudur.id, isSystemAdmin: false },
      { activityId: activity.id, text: "Bu ne durumda?" },
      ACILIS,
    );
    if (!soru.ok) throw new Error("kurulum");
    await testDb.notificationQueue.deleteMany({});
  }

  it("varsayılan üç iş günüyle Salı hatırlatma gitmez", async () => {
    await konusmaAc();

    const sonuc = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-18T09:00:00.000Z"),
    );

    expect(sonuc.overdueConversations).toBe(0);
  });

  it("ayar bire çekilince aynı gün hatırlatma gider", async () => {
    await konusmaAc();
    await saveSettings(testDb, {
      [SETTING_KEYS.overdueAnswerBusinessDays]: "1",
    });

    const sonuc = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-18T09:00:00.000Z"),
    );

    expect(sonuc.overdueConversations).toBe(1);
    expect(sonuc.queued).toBeGreaterThan(0);
  });
});

describe("üstün devreye girmesi ayarı (§9.3)", () => {
  async function konusma() {
    const { genelMudur, kalipMudur, activity } = await sirket();
    const soru = await askQuestion(
      testDb,
      { id: genelMudur.id, isSystemAdmin: false },
      { activityId: activity.id, text: "Bu ne durumda?" },
      ACILIS,
    );
    if (!soru.ok) throw new Error("kurulum");
    return { genelMudur, kalipMudur, conversation: soru.value };
  }

  /** Soranın üstü: kök birimin yöneticisi. Konuşma kurulduktan sonra eklenir. */
  async function baskanEkle() {
    const root = await testDb.orgUnit.findFirstOrThrow({ where: { parentId: null } });
    return createUser(root.id, { fullName: "Başkan", isUnitManager: true });
  }

  it("ayar değişmeden üst erken kapatamaz, ayar düşünce kapatabilir", async () => {
    const { conversation } = await konusma();
    const baskan = await baskanEkle();
    const carsamba = new Date("2026-08-19T09:00:00.000Z");

    // Varsayılan on iş günü: 19 Ağustos'ta iki iş günü geçmiş, yetmez.
    const erken = await closeConversation(
      testDb,
      { id: baskan.id, isSystemAdmin: false },
      conversation.id,
      carsamba,
    );
    expect(erken.ok).toBe(false);
    if (erken.ok) return;
    expect(erken.error).toBe("supervisor_too_early");

    await saveSettings(testDb, {
      [SETTING_KEYS.supervisorTakeoverBusinessDays]: "2",
    });

    // Aynı an, aynı kişi, aynı konuşma — yalnız ayar değişti.
    const sonra = await closeConversation(
      testDb,
      { id: baskan.id, isSystemAdmin: false },
      conversation.id,
      carsamba,
    );

    expect(sonra.ok).toBe(true);
    if (!sonra.ok) return;
    expect(sonra.value.closeType).toBe("NORMAL");
  });
});

describe("okundu sayma süresi ayarı (§10.2)", () => {
  it("varsayılan iki saniyenin altı kayıt bırakmaz", async () => {
    const { genelMudur, activity } = await sirket();

    const sonuc = await markActivityAsRead(
      testDb,
      { id: genelMudur.id, isSystemAdmin: false },
      activity.id,
      1_500,
      ACILIS,
    );

    expect(sonuc).toEqual({ ok: false, reason: "too_short" });
  });

  it("ayar bir saniyeye çekilince aynı süre kayıt bırakır", async () => {
    const { genelMudur, activity } = await sirket();
    await saveSettings(testDb, { [SETTING_KEYS.readDwellSeconds]: "1" });

    const sonuc = await markActivityAsRead(
      testDb,
      { id: genelMudur.id, isSystemAdmin: false },
      activity.id,
      1_500,
      ACILIS,
    );

    expect(sonuc).toEqual({ ok: true, recorded: true });
  });
});

describe("mesai öncesi hatırlatma süresi ayarı (§12.1)", () => {
  it("ayar 0 iken mesai öncesinde tetiklenmez, 60 iken tetiklenir", async () => {
    await sirket();
    // Varsayılan takvim: 08:00 - 17:30.
    // 17:00 İstanbul (14:00 UTC).
    const saat1700 = new Date("2026-08-17T14:00:00.000Z");

    // 0 dakika: mesai bitmeden önce tetiklenmez.
    await saveSettings(testDb, { [SETTING_KEYS.noActivityReminderLeadMinutes]: "0" });
    const sifir = await sendMissingActivityReminders(testDb, saat1700);
    expect(sifir.skippedNotDue).toBe(true);

    // 60 dakika: 16:30'dan sonra tetiklenir.
    await saveSettings(testDb, { [SETTING_KEYS.noActivityReminderLeadMinutes]: "60" });
    const altmis = await sendMissingActivityReminders(testDb, saat1700);
    expect(altmis.skippedNotDue).toBe(false);
    expect(altmis.queued).toBeGreaterThan(0);
  });
});
