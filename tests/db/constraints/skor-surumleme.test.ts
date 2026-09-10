import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

const TEMMUZ = new Date("2026-07-01T00:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sahne() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const kisi = await createUser(birim.id, { fullName: "Kadir Usta" });
  const faaliyet = await createActivity(kisi, { activityDate: TEMMUZ });
  return { kisi, faaliyet };
}

function frozenRevision(userId: string, revisionNo: number) {
  return {
    userId,
    periodStart: TEMMUZ,
    revisionNo,
    revisionReason: revisionNo === 1 ? "INITIAL" : "ACTIVITY_CREATED",
    regularity: 40,
    acceptance: null,
    approval: null,
    followUp: 30,
    total: 70,
    expectedDays: 22,
    writtenDays: 20,
    frozen: true,
    profile: "unapproved",
    weightRegularity: 60,
    weightAcceptance: 30,
    weightApproval: 30,
    weightFollowUp: 10,
    formulaVersion: 1,
  };
}

describe("skor sürümü veritabanı değişmezleri", () => {
  it("aynı kullanıcı-ay için iki farklı sürüm kabul edilir", async () => {
    const { kisi } = await sahne();
    await testDb.userScorePeriod.create({ data: frozenRevision(kisi.id, 1) });
    await testDb.userScorePeriod.create({ data: frozenRevision(kisi.id, 2) });

    expect(
      await testDb.userScorePeriod.count({
        where: { userId: kisi.id, periodStart: TEMMUZ },
      }),
    ).toBe(2);
  });

  it("aynı sürüm numarası ikinci kez yazılamaz", async () => {
    const { kisi } = await sahne();
    await testDb.userScorePeriod.create({ data: frozenRevision(kisi.id, 1) });

    await expect(
      testDb.userScorePeriod.create({ data: frozenRevision(kisi.id, 1) }),
    ).rejects.toThrow();
  });

  it("katkı var olmayan sürüme bağlanamaz", async () => {
    const { kisi, faaliyet } = await sahne();
    await testDb.userScorePeriod.create({ data: frozenRevision(kisi.id, 1) });

    await expect(
      testDb.userScorePeriodFact.create({
        data: {
          userId: kisi.id,
          periodStart: TEMMUZ,
          revisionNo: 2,
          activityId: faaliyet.id,
          kind: "WRITTEN",
          happenedOn: TEMMUZ,
        },
      }),
    ).rejects.toThrow(/SCORE_FACT_PERIOD_MISSING|foreign key/i);
  });

  it("sıfırıncı sürüm veritabanında reddedilir", async () => {
    const { kisi } = await sahne();
    await expect(
      testDb.userScorePeriod.create({ data: frozenRevision(kisi.id, 0) }),
    ).rejects.toThrow(/UserScorePeriod_revision_positive/);
  });

  it("geçersiz kılma mührü taslak sürüme yazılamaz", async () => {
    const { kisi } = await sahne();
    await expect(
      testDb.userScorePeriod.create({
        data: {
          ...frozenRevision(kisi.id, 1),
          frozen: false,
          voided: true,
          profile: null,
          weightRegularity: null,
          weightAcceptance: null,
          weightApproval: null,
          weightFollowUp: null,
          formulaVersion: null,
        },
      }),
    ).rejects.toThrow(/UserScorePeriod_voided_frozen/);
  });

  it("aynı yeniden hesaplama isteği iki skor sürümünün kaynağı olamaz", async () => {
    const { kisi } = await sahne();
    const istek = await testDb.scoreRecalculationRequest.create({
      data: {
        userId: kisi.id,
        periodStart: TEMMUZ,
        sourceType: "TEST",
        sourceId: "tek-kaynak",
      },
    });
    await testDb.userScorePeriod.create({
      data: { ...frozenRevision(kisi.id, 1), sourceRequestId: istek.id },
    });

    await expect(
      testDb.userScorePeriod.create({
        data: { ...frozenRevision(kisi.id, 2), sourceRequestId: istek.id },
      }),
    ).rejects.toThrow();
  });

  it("istek kimliği idempotenttir ve deneme sayısı negatif olamaz", async () => {
    const { kisi } = await sahne();
    const data = {
      userId: kisi.id,
      periodStart: TEMMUZ,
      sourceType: "TEST",
      sourceId: "aynı-olay",
    };
    await testDb.scoreRecalculationRequest.create({ data });
    await expect(
      testDb.scoreRecalculationRequest.create({ data }),
    ).rejects.toThrow();
    await expect(
      testDb.scoreRecalculationRequest.create({
        data: { ...data, sourceId: "negatif", attempts: -1 },
      }),
    ).rejects.toThrow(/ScoreRecalculationRequest_attempts_nonnegative/);
  });

  it("geçerli dönem kayıt defteri satırı yazılır, negatif pencere reddedilir", async () => {
    const valid = await testDb.scorePeriodLedger.create({
      data: {
        periodStart: TEMMUZ,
        closedAt: new Date("2026-08-02T06:00:00.000Z"),
        retroactiveDays: 1,
        formulaVersion: 1,
      },
    });
    expect(valid.retroactiveDays).toBe(1);

    await expect(
      testDb.scorePeriodLedger.create({
        data: {
          periodStart: new Date("2026-08-01"),
          closedAt: new Date("2026-09-02T06:00:00.000Z"),
          retroactiveDays: -1,
          formulaVersion: 1,
        },
      }),
    ).rejects.toThrow(/ScorePeriodLedger_retroactive_nonnegative/);

    await expect(
      testDb.scorePeriodLedger.create({
        data: {
          periodStart: new Date("2026-09-01"),
          closedAt: new Date("2026-10-02T06:00:00.000Z"),
          retroactiveDays: 1,
          formulaVersion: 0,
        },
      }),
    ).rejects.toThrow(/ScorePeriodLedger_formula_positive/);
  });
});

describe("etkili-tarih olayları uygulama kodu atlanınca da zorunludur", () => {
  it("doğrudan kullanıcı bayrağı güncellemesi yeni tam durum olayı üretir", async () => {
    const { kisi } = await sahne();
    const once = await testDb.scoreUserStateEvent.count({
      where: { userId: kisi.id },
    });

    await testDb.user.update({
      where: { id: kisi.id },
      data: { isUnitManager: true },
    });

    const olay = await testDb.scoreUserStateEvent.findFirstOrThrow({
      where: { userId: kisi.id },
      orderBy: [{ effectiveAt: "desc" }, { recordedAt: "desc" }],
    });
    expect(await testDb.scoreUserStateEvent.count({ where: { userId: kisi.id } }))
      .toBe(once + 1);
    expect(olay.isUnitManager).toBe(true);
    expect(olay.orgUnitId).toBe(kisi.orgUnitId);
  });

  it("kullanıcı tarihçesi güncellenemez ve silinemez", async () => {
    const { kisi } = await sahne();
    const olay = await testDb.scoreUserStateEvent.findFirstOrThrow({
      where: { userId: kisi.id },
    });

    await expect(
      testDb.scoreUserStateEvent.update({
        where: { id: olay.id },
        data: { reason: "DEĞİŞTİR" },
      }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
    await expect(
      testDb.scoreUserStateEvent.delete({ where: { id: olay.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
  });

  it("birim, takvim, tatil ve ayar doğrudan yazılsa da tam tarihçe üretir", async () => {
    const { kisi } = await sahne();
    const birim = await testDb.orgUnit.findUniqueOrThrow({
      where: { id: kisi.orgUnitId },
    });

    await testDb.orgUnit.update({
      where: { id: birim.id },
      data: { requiresApproval: true },
    });
    await testDb.workCalendar.create({
      data: {
        id: 1,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1050,
      },
    });
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: birim.id,
        workingDays: [1, 2, 3, 4, 5, 6],
        workStartMinute: 480,
        workEndMinute: 1020,
        worksOnHolidays: false,
      },
    });
    await testDb.orgUnitWorkCalendar.delete({ where: { orgUnitId: birim.id } });
    const tatil = new Date("2026-07-15T00:00:00.000Z");
    await testDb.holiday.create({
      data: { date: tatil, description: "Tarihçe testi" },
    });
    await testDb.holiday.delete({ where: { date: tatil } });
    await testDb.systemSetting.create({
      data: {
        key: "retroactive_entry_days",
        value: "3",
        description: "Tarihçe testi",
      },
    });

    expect(
      await testDb.scoreOrgUnitStateEvent.count({
        where: { orgUnitId: birim.id, requiresApproval: true },
      }),
    ).toBe(1);
    expect(await testDb.scoreCompanyCalendarEvent.count()).toBe(1);
    expect(
      await testDb.scoreUnitCalendarEvent.findMany({
        where: { orgUnitId: birim.id },
        orderBy: { recordedAt: "asc" },
        select: { hasOwnCalendar: true },
      }),
    ).toEqual([{ hasOwnCalendar: true }, { hasOwnCalendar: false }]);
    expect(
      await testDb.scoreHolidayEvent.findMany({
        where: { holidayDate: tatil },
        orderBy: { recordedAt: "asc" },
        select: { isHoliday: true },
      }),
    ).toEqual([{ isHoliday: true }, { isHoliday: false }]);
    expect(
      await testDb.scoreSettingEvent.findFirstOrThrow({
        where: { key: "retroactive_entry_days" },
        select: { value: true },
      }),
    ).toEqual({ value: "3" });
  });

  it("bütün etkili-tarih tabloları güncelleme ve silmeye kapalıdır", async () => {
    const { kisi } = await sahne();
    const birim = await testDb.orgUnit.findUniqueOrThrow({
      where: { id: kisi.orgUnitId },
    });
    await testDb.workCalendar.create({
      data: {
        id: 1,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1050,
      },
    });
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: birim.id,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1050,
        worksOnHolidays: false,
      },
    });
    const tatil = await testDb.holiday.create({
      data: {
        date: new Date("2026-07-15T00:00:00.000Z"),
        description: "Değişmezlik testi",
      },
    });
    await testDb.systemSetting.create({
      data: {
        key: "retroactive_entry_days",
        value: "3",
        description: "Değişmezlik testi",
      },
    });

    const org = await testDb.scoreOrgUnitStateEvent.findFirstOrThrow({
      where: { orgUnitId: birim.id },
    });
    const company = await testDb.scoreCompanyCalendarEvent.findFirstOrThrow();
    const unit = await testDb.scoreUnitCalendarEvent.findFirstOrThrow();
    const holiday = await testDb.scoreHolidayEvent.findFirstOrThrow({
      where: { holidayDate: tatil.date },
    });
    const setting = await testDb.scoreSettingEvent.findFirstOrThrow();

    await expect(
      testDb.scoreOrgUnitStateEvent.delete({ where: { id: org.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
    await expect(
      testDb.scoreCompanyCalendarEvent.delete({ where: { id: company.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
    await expect(
      testDb.scoreUnitCalendarEvent.delete({ where: { id: unit.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
    await expect(
      testDb.scoreHolidayEvent.delete({ where: { id: holiday.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
    await expect(
      testDb.scoreSettingEvent.delete({ where: { id: setting.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
  });
});
