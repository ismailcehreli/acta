import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  operationsSummary,
  teamParticipationToday,
} from "@/server/dashboard/summary";
import { JOB_NAMES, recordJobSuccess } from "@/server/jobs/status";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Ana ekranın kademeye göre değişen özetleri (§13.1). Düzen aynıdır; kapsam
// genişler. Ekip katılımı ayara bağlıdır ve varsayılanı kapalıdır (§12.1).

const NOW = new Date("2026-08-18T12:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function ekip() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birinci = await createUser(root.id, { fullName: "Bir" });
  const ikinci = await createUser(root.id, { fullName: "İki" });
  const ucuncu = await createUser(root.id, { fullName: "Üç" });

  return {
    root,
    hepsi: [birinci.id, ikinci.id, ucuncu.id],
    birinci,
    ikinci,
    ucuncu,
  };
}

async function faaliyetYaz(
  user: { id: string; orgUnitId: string },
  day: string,
  approvalStatus: "APPROVED" | "CANCELLED" = "APPROVED",
) {
  await testDb.activity.create({
    data: {
      authorId: user.id,
      authorOrgUnitId: user.orgUnitId,
      activityDate: new Date(`${day}T00:00:00.000Z`),
      title: "Başlık",
      description: "Açıklama",
      approvalStatus,
    },
  });
}

describe("ekip katılımı (§12.1)", () => {
  it("ayar kapalıyken hiç hesaplanmaz", async () => {
    const { hepsi, birinci } = await ekip();
    await faaliyetYaz(birinci, "2026-08-18");

    // Varsayılan kapalı: zorunlu görünürlük içi boş faaliyet yazdırabilir.
    expect(await teamParticipationToday(testDb, hepsi, NOW)).toBeNull();
  });

  it("ayar açıkken bugün yazanları sayar", async () => {
    const { hepsi, birinci, ikinci } = await ekip();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await faaliyetYaz(birinci, "2026-08-18");
    await faaliyetYaz(ikinci, "2026-08-18");
    // Aynı kişinin ikinci kaydı sayıyı artırmamalı.
    await faaliyetYaz(birinci, "2026-08-18");

    expect(await teamParticipationToday(testDb, hepsi, NOW)).toEqual({
      people: 3,
      wrote: 2,
    });
  });

  it("dünkü kayıt bugünü saymaz, iptal edilen de sayılmaz", async () => {
    const { hepsi, birinci, ikinci } = await ekip();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await faaliyetYaz(birinci, "2026-08-17");
    await faaliyetYaz(ikinci, "2026-08-18", "CANCELLED");

    expect(await teamParticipationToday(testDb, hepsi, NOW)).toEqual({
      people: 3,
      wrote: 0,
    });
  });

  it("faaliyet yazması beklenmeyen kişi paydaya girmez", async () => {
    const { hepsi, birinci, ucuncu } = await ekip();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await testDb.user.update({
      where: { id: ucuncu.id },
      data: { writesActivities: false },
    });
    await faaliyetYaz(birinci, "2026-08-18");

    // Payda 3 değil 2: beklenmeyen kişi oranı haksız yere düşürmemeli.
    expect(await teamParticipationToday(testDb, hepsi, NOW)).toEqual({
      people: 2,
      wrote: 1,
    });
  });

  it("kimseden faaliyet beklenmiyorsa blok gösterilmez", async () => {
    const { hepsi } = await ekip();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await testDb.user.updateMany({
      where: { id: { in: hepsi } },
      data: { writesActivities: false },
    });

    // "0/0" bir bilgi değil, kafa karışıklığıdır.
    expect(await teamParticipationToday(testDb, hepsi, NOW)).toBeNull();
  });

  it("astı olmayan için blok hiç yoktur", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });

    expect(await teamParticipationToday(testDb, [], NOW)).toBeNull();
  });
});

describe("işletim özeti (§12.4, §15.1)", () => {
  it("kuyruk, işler ve yedek durumu döner", async () => {
    const { birinci } = await ekip();
    await testDb.notificationQueue.createMany({
      data: [
        {
          userId: birinci.id,
          eventType: "question_asked",
          channel: "EMAIL",
          payload: {},
          idempotencyKey: "a",
          status: "PENDING",
        },
        {
          userId: birinci.id,
          eventType: "question_asked",
          channel: "EMAIL",
          payload: {},
          idempotencyKey: "b",
          status: "FAILED",
        },
      ],
    });

    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(
        testDb,
        jobName,
        new Date(NOW.getTime() - 10_000),
        jobName === JOB_NAMES.backup ? 24 * 60 : 1,
      );
    }

    const ozet = await operationsSummary(testDb, NOW);

    expect(ozet.queuePending).toBe(1);
    expect(ozet.queueFailed).toBe(1);
    expect(ozet.backupMonitoring).toBe(false);
    expect(ozet.jobsTotal).toBe(Object.values(JOB_NAMES).length - 1);
    expect(ozet.jobsDelayed).toBe(0);
    expect(ozet.backupAgeHours).toBe(0);
  });

  it("hiç yedek alınmadıysa yaş bilinmez", async () => {
    const ozet = await operationsSummary(testDb, NOW);

    expect(ozet.backupMonitoring).toBe(false);
    expect(ozet.backupAgeHours).toBeNull();
    // Yedek izlemesi kurulana kadar yedek dışındaki işler gecikmiş sayılır.
    expect(ozet.jobsDelayed).toBe(ozet.jobsTotal);
  });

  it("özet faaliyet içeriği taşımaz (§15.1)", async () => {
    const { birinci } = await ekip();
    await faaliyetYaz(birinci, "2026-08-18");

    const ozet = await operationsSummary(testDb, NOW);

    // Tip düzeyinde de içerik yok; burada gövdenin tamamı taranıyor.
    expect(JSON.stringify(ozet)).not.toContain("Başlık");
    expect(JSON.stringify(ozet)).not.toContain("Açıklama");
  });
});

// İzinli kişi katılım oranını düşürmez (21.08.2026).
//
// Ekran "katılım hesabında beklenen gün sayılmaz" diyordu ama kod izinli
// kişiyi paydada tutuyordu: yönetici, aslında var olmayan bir eksiklik
// görüyordu. Arayüzün söylediği ile kodun yaptığı ayrışmıştı.
describe("faaliyet beklenmeyen gün katılıma girmez", () => {
  it("izinli kişi paydadan düşer", async () => {
    const kok = await createOrgUnit({ name: "Şirket" });
    const mudur = await createUser(kok.id, {
      email: "mudur-izin@ornek.test",
      isUnitManager: true,
    });
    const calisan = await createUser(kok.id, { email: "calisan-izin@ornek.test" });
    const izinli = await createUser(kok.id, { email: "izinli@ornek.test" });

    await testDb.systemSetting.upsert({
      where: { key: "manager_participation_summary" },
      create: {
        key: "manager_participation_summary",
        value: "true",
        description: "test",
      },
      update: { value: "true" },
    });

    const gun = new Date("2026-08-21T09:00:00.000Z");

    // Çalışan yazdı, izinli yazmadı.
    await createActivity(calisan, { activityDate: new Date("2026-08-21T00:00:00.000Z") });

    await testDb.noActivityPeriod.create({
      data: {
        userId: izinli.id,
        startDate: new Date("2026-08-20T00:00:00.000Z"),
        endDate: new Date("2026-08-25T00:00:00.000Z"),
        note: "Yıllık izin",
        markedById: mudur.id,
      },
    });

    const sonuc = await teamParticipationToday(
      testDb,
      [calisan.id, izinli.id],
      gun,
    );

    // İzinli sayılmasaydı 1/2 çıkardı; doğrusu 1/1.
    expect(sonuc).toEqual({ people: 1, wrote: 1 });
  });

  it("izin aralığı dışındaki günde kişi yine beklenir", async () => {
    const kok = await createOrgUnit({ name: "Şirket" });
    const mudur = await createUser(kok.id, {
      email: "mudur-izin2@ornek.test",
      isUnitManager: true,
    });
    const izinli = await createUser(kok.id, { email: "izinli2@ornek.test" });

    await testDb.systemSetting.upsert({
      where: { key: "manager_participation_summary" },
      create: {
        key: "manager_participation_summary",
        value: "true",
        description: "test",
      },
      update: { value: "true" },
    });

    await testDb.noActivityPeriod.create({
      data: {
        userId: izinli.id,
        startDate: new Date("2026-08-10T00:00:00.000Z"),
        endDate: new Date("2026-08-12T00:00:00.000Z"),
        markedById: mudur.id,
      },
    });

    const sonuc = await teamParticipationToday(
      testDb,
      [izinli.id],
      new Date("2026-08-21T09:00:00.000Z"),
    );

    expect(sonuc).toEqual({ people: 1, wrote: 0 });
  });
});
