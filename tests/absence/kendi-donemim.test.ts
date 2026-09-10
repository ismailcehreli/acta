import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  cancelNoActivityPeriod,
  decideNoActivityPeriod,
  isNoActivityDay,
  listOwnAbsences,
  markOwnNoActivityPeriod,
} from "@/server/absence/service";
import { resolveAbsenceApproversForUser } from "@/server/absence/approval-routing";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Kişinin kendi "faaliyet beklenmiyor" dönemi (Görev 11.8).
//
// Kişi kendi dönemini girdiğinde talep, aynı departmandaki yöneticisinin
// onayına gider. Yönetici kendi dönemini doğrudan onaylı oluşturur.

const NOW = new Date("2026-08-22T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(kaliphane.id, { fullName: "Kadir Usta" });
  const nazli = await createUser(kaliphane.id, { fullName: "Nazlı Usta" });

  return { mudur, kadir, nazli, planlama };
}

describe("kişi kendi dönemini girer", () => {
  it("dönem kaydedilir ve onay bekler", async () => {
    const { kadir } = await sirket();

    const sonuc = await markOwnNoActivityPeriod(
      testDb,
      kadir.id,
      { startDate: "2026-09-01", endDate: "2026-09-05", note: "Yıllık izin" },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.status).toBe("PENDING");
    const kayit = await testDb.noActivityPeriod.findFirst({
      where: { userId: kadir.id },
    });
    expect(kayit?.markedById).toBe(kadir.id);
    expect(kayit?.status).toBe("PENDING");
    expect(await isNoActivityDay(testDb, kadir.id, "2026-09-03")).toBe(false);
  });

  it("müdürüne onay talebi bildirimi gider", async () => {
    const { mudur, kadir } = await sirket();

    await markOwnNoActivityPeriod(
      testDb,
      kadir.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );

    const bildirimler = await testDb.notificationQueue.findMany({
      where: { userId: mudur.id },
    });
    expect(bildirimler.map((b) => b.eventType)).toContain(
      NOTIFICATION_EVENTS.absenceRequestSubmitted,
    );
  });

  it("yönetici kendi dönemini doğrudan onaylı oluşturur", async () => {
    const { mudur } = await sirket();

    const sonuc = await markOwnNoActivityPeriod(
      testDb,
      mudur.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.status).toBe("APPROVED");
    expect(await isNoActivityDay(testDb, mudur.id, "2026-09-03")).toBe(true);
  });

  it("yönetici kendi döneminde vekil seçebilir", async () => {
    const { mudur, kadir, planlama } = await sirket();
    const vekil = await createUser(planlama.id, {
      fullName: "Planlama Müdürü",
      isUnitManager: true,
    });

    const sonuc = await markOwnNoActivityPeriod(
      testDb,
      mudur.id,
      {
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        deputyId: vekil.id,
      },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    const kayit = await testDb.noActivityPeriod.findUniqueOrThrow({
      where: { id: sonuc.id },
    });
    expect(kayit.status).toBe("APPROVED");
    expect(kayit.deputyId).toBe(vekil.id);

    const approvers = await resolveAbsenceApproversForUser(
      testDb,
      kadir.id,
      new Date("2026-09-03T09:00:00.000Z"),
    );
    expect(approvers).toEqual([{ id: vekil.id, route: "DEPUTY" }]);
  });

  it("yönetici çalışan talebini onaylayınca günler geçerli olur", async () => {
    const { mudur, kadir } = await sirket();
    const talep = await markOwnNoActivityPeriod(
      testDb,
      kadir.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!talep.ok) throw new Error("talep kurulamadı");

    const karar = await decideNoActivityPeriod(
      testDb,
      mudur.id,
      talep.id,
      "APPROVED",
      "",
      NOW,
    );

    expect(karar.ok).toBe(true);
    if (!karar.ok) return;
    expect(karar.status).toBe("APPROVED");
    expect(await isNoActivityDay(testDb, kadir.id, "2026-09-03")).toBe(true);
    const bildirimler = await testDb.notificationQueue.findMany({
      where: { userId: kadir.id },
    });
    expect(bildirimler.map((b) => b.eventType)).toContain(
      NOTIFICATION_EVENTS.absenceRequestApproved,
    );
  });

  it("yönetici talebi gerekçesiz reddedemez", async () => {
    const { mudur, kadir } = await sirket();
    const talep = await markOwnNoActivityPeriod(
      testDb,
      kadir.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!talep.ok) throw new Error("talep kurulamadı");

    const karar = await decideNoActivityPeriod(
      testDb,
      mudur.id,
      talep.id,
      "REJECTED",
      "   ",
      NOW,
    );

    expect(karar.ok).toBe(false);
    if (!karar.ok) expect(karar.error).toBe("reason_required");
  });

  it("yönetici talebi gerekçeyle reddedince günler geçersiz kalır", async () => {
    const { mudur, kadir } = await sirket();
    const talep = await markOwnNoActivityPeriod(
      testDb,
      kadir.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!talep.ok) throw new Error("talep kurulamadı");

    const karar = await decideNoActivityPeriod(
      testDb,
      mudur.id,
      talep.id,
      "REJECTED",
      "Tarihleri yeniden kontrol edin.",
      NOW,
    );

    expect(karar.ok).toBe(true);
    expect(await isNoActivityDay(testDb, kadir.id, "2026-09-03")).toBe(false);
    const kayit = await testDb.noActivityPeriod.findUniqueOrThrow({
      where: { id: talep.id },
    });
    expect(kayit.status).toBe("REJECTED");
    expect(kayit.decisionReason).toBe("Tarihleri yeniden kontrol edin.");
  });

  it("kendi listesini görür", async () => {
    const { kadir, nazli } = await sirket();
    await markOwnNoActivityPeriod(
      testDb,
      kadir.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    await markOwnNoActivityPeriod(
      testDb,
      nazli.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );

    const liste = await listOwnAbsences(testDb, kadir.id);

    expect(liste).toHaveLength(1);
    expect(liste[0]?.userId).toBe(kadir.id);
  });
});

describe("en uzun dönem sınırı", () => {
  it("ayardaki gün sayısını aşan dönem reddedilir", async () => {
    const { kadir } = await sirket();
    await saveSettings(testDb, { [SETTING_KEYS.selfAbsenceMaxDays]: "30" });

    const sonuc = await markOwnNoActivityPeriod(
      testDb,
      kadir.id,
      { startDate: "2026-09-01", endDate: "2026-10-15" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (!sonuc.ok) expect(sonuc.error).toBe("too_long_for_self");
  });

  it("sınır içindeki dönem kabul edilir", async () => {
    const { kadir } = await sirket();
    await saveSettings(testDb, { [SETTING_KEYS.selfAbsenceMaxDays]: "30" });

    const sonuc = await markOwnNoActivityPeriod(
      testDb,
      kadir.id,
      { startDate: "2026-09-01", endDate: "2026-09-20" },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
  });

  // Sınır **yalnız kişinin kendi girişine** ait; müdür daha uzun dönem
  // girebilir çünkü onu tanıyan biri onaylamış oluyor.
  it("müdürün girdiği dönem bu sınıra takılmaz", async () => {
    const { mudur, kadir } = await sirket();
    await saveSettings(testDb, { [SETTING_KEYS.selfAbsenceMaxDays]: "10" });

    const { markNoActivityPeriod } = await import("@/server/absence/service");
    const sonuc = await markNoActivityPeriod(
      testDb,
      mudur.id,
      { userId: kadir.id, startDate: "2026-09-01", endDate: "2026-10-15" },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
  });
});

describe("kendi kaydını iptal edebilir", () => {
  it("kişi kendi girdiği dönemi gerekçeyle iptal eder", async () => {
    const { kadir } = await sirket();
    const acilan = await markOwnNoActivityPeriod(
      testDb,
      kadir.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    const sonuc = await cancelNoActivityPeriod(
      testDb,
      kadir.id,
      acilan.id,
      "Yanlış tarih girdim",
      NOW,
    );

    expect(sonuc.ok).toBe(true);
  });
});

describe("başkasının dönemine dokunamaz", () => {
  it("kendi listesinde başkasının kaydı çıkmaz", async () => {
    const { kadir, nazli } = await sirket();
    await markOwnNoActivityPeriod(
      testDb,
      nazli.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );

    expect(await listOwnAbsences(testDb, kadir.id)).toHaveLength(0);
  });

  it("başkasının kaydını iptal edemez", async () => {
    const { kadir, nazli } = await sirket();
    const acilan = await markOwnNoActivityPeriod(
      testDb,
      nazli.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    const sonuc = await cancelNoActivityPeriod(
      testDb,
      kadir.id,
      acilan.id,
      "Kendi kaydım değil",
      NOW,
    );

    expect(sonuc.ok).toBe(false);
  });
});
