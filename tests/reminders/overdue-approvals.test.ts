import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity, requestChanges } from "@/server/activities/approval";
import { createActivity, updateActivity } from "@/server/activities/write";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";
import { sendOverdueApprovalReminders } from "@/worker/reminders/overdue-approvals";

import {
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Onay hatırlatması (§5.4). Müdür bakmazsa kayıt sessizce bekler: yazan
// "gönderdim" sanır, üst kademe hiç görmez.
//
// 17.08.2026 Pazartesi; 19.08 Çarşamba = 2 iş günü sonra.

const YAZIM = new Date("2026-08-17T09:00:00.000Z");
const IKI_IS_GUNU_SONRA = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function senaryo() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({
    name: "Kalıphane",
    parentId: root.id,
    requiresApproval: true,
  });

  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const calisan = await createUser(kaliphane.id, { fullName: "Kalıpçı" });

  return { mudur, calisan };
}

/** Faaliyet tarihi yazım gününe eşit: geçmişe dönük giriş sınırına takılmasın. */
function gun(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function yaz(
  calisan: { id: string; orgUnitId: string },
  now: Date = YAZIM,
) {
  const sonuc = await createActivity(
    testDb,
    { id: calisan.id, orgUnitId: calisan.orgUnitId, requiresApproval: true },
    {
      activityDate: gun(now),
      title: "Kalıp bakımı",
      description: "Haftalık bakım yapıldı.",
      targetDepartmentIds: [],
    },
    now,
  );
  if (!sonuc.ok) throw new Error(`kurulum: ${sonuc.message}`);
  return sonuc.activity;
}

async function hatirlatmalar() {
  return testDb.notificationQueue.findMany({
    where: { eventType: NOTIFICATION_EVENTS.approvalOverdue },
  });
}

describe("geciken onay hatırlatması", () => {
  it("eşiği aşan kayıt için onaylayıcıya gider", async () => {
    const { calisan, mudur } = await senaryo();
    await yaz(calisan);

    const sonuc = await sendOverdueApprovalReminders(testDb, IKI_IS_GUNU_SONRA);

    expect(sonuc).toEqual({ overdue: 1, queued: 1 });
    const kuyruk = await hatirlatmalar();
    expect(kuyruk).toHaveLength(1);
    expect(kuyruk[0].userId).toBe(mudur.id);
  });

  it("eşik dolmadan gitmez", async () => {
    const { calisan } = await senaryo();
    await yaz(calisan);

    // Ertesi gün: 1 iş günü, eşik 2.
    const sonuc = await sendOverdueApprovalReminders(
      testDb,
      new Date("2026-08-18T09:00:00.000Z"),
    );

    expect(sonuc).toEqual({ overdue: 0, queued: 0 });
    expect(await hatirlatmalar()).toHaveLength(0);
  });

  it("eşik ayardan değiştirilebilir", async () => {
    const { calisan } = await senaryo();
    await yaz(calisan);
    await saveSettings(testDb, {
      [SETTING_KEYS.pendingApprovalBusinessDays]: "1",
    });

    // Aynı an, eşik 1: artık gecikmiş sayılır. "Bugün iki, yarın bir" kararı
    // ekrandan verilebilmeli.
    const sonuc = await sendOverdueApprovalReminders(
      testDb,
      new Date("2026-08-18T09:00:00.000Z"),
    );

    expect(sonuc.queued).toBe(1);
  });

  it("aynı bekleyiş için ikinci kez gitmez", async () => {
    const { calisan } = await senaryo();
    await yaz(calisan);

    await sendOverdueApprovalReminders(testDb, IKI_IS_GUNU_SONRA);
    const ikinci = await sendOverdueApprovalReminders(
      testDb,
      new Date("2026-08-20T09:00:00.000Z"),
    );

    // Gecikmiş sayılmaya devam eder ama bildirim tekrarlanmaz.
    expect(ikinci.overdue).toBe(1);
    expect(ikinci.queued).toBe(0);
    expect(await hatirlatmalar()).toHaveLength(1);
  });

  it("onaylanan kayıt için gitmez", async () => {
    const { calisan, mudur } = await senaryo();
    const activity = await yaz(calisan);
    await approveActivity(testDb, mudur.id, activity.id, YAZIM);

    const sonuc = await sendOverdueApprovalReminders(testDb, IKI_IS_GUNU_SONRA);

    expect(sonuc).toEqual({ overdue: 0, queued: 0 });
  });

  it("düzeltme istenen kayıt için gitmez: top yazana geçti", async () => {
    const { calisan, mudur } = await senaryo();
    const activity = await yaz(calisan);
    await requestChanges(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: (await createApprovalReason("CHANGES_REQUESTED")).id },
      YAZIM,
    );

    const sonuc = await sendOverdueApprovalReminders(testDb, IKI_IS_GUNU_SONRA);

    expect(sonuc).toEqual({ overdue: 0, queued: 0 });
  });

  it("yeniden gönderilen kayıtta sayaç baştan başlar", async () => {
    const { calisan, mudur } = await senaryo();
    const activity = await yaz(calisan);
    await requestChanges(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: (await createApprovalReason("CHANGES_REQUESTED")).id },
      YAZIM,
    );

    // Yazan iki iş günü sonra düzeltip gönderiyor.
    await updateActivity(
      testDb,
      calisan.id,
      {
        id: activity.id,
        // Düzeltme günü: geçmişe dönük giriş sınırı düzeltmede de işler.
        activityDate: gun(IKI_IS_GUNU_SONRA),
        title: "Kalıp bakımı",
        description: "Üç numaralı kalıpta erken aşınma tespit edildi.",
        targetDepartmentIds: [],
      },
      IKI_IS_GUNU_SONRA,
    );

    // Aynı an: sayaç sıfırlandığı için henüz gecikme yok. Yazımdan itibaren
    // ölçseydik kayıt zaten gecikmiş sayılırdı.
    expect(
      await sendOverdueApprovalReminders(testDb, IKI_IS_GUNU_SONRA),
    ).toEqual({ overdue: 0, queued: 0 });

    // İki iş günü daha geçince gider.
    const sonra = await sendOverdueApprovalReminders(
      testDb,
      new Date("2026-08-21T09:00:00.000Z"),
    );
    expect(sonra.queued).toBe(1);
  });

  it("hafta sonu iş günü saymaz", async () => {
    const { calisan } = await senaryo();
    // Cuma yazılır; Pazartesi sabahı 1 iş günü geçmiş olur.
    await yaz(calisan, new Date("2026-08-21T09:00:00.000Z"));

    const pazartesi = await sendOverdueApprovalReminders(
      testDb,
      new Date("2026-08-24T09:00:00.000Z"),
    );

    expect(pazartesi.queued).toBe(0);
  });
});
