import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeScorePeriod,
  drainScorePeriodWork,
} from "@/server/scoring/close-period";
import { correctUserScoreHistory } from "@/server/scoring/historical-correction";
import { readScoreTrend } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const TEMMUZ_BASI = new Date("2026-07-01T00:00:00.000Z");
const KAPANIS = new Date("2026-08-25T12:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, {
    [SETTING_KEYS.scoringEnabled]: "true",
    [SETTING_KEYS.retroactiveEntryDays]: "1",
  });
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("gecikmiş kapanış etkili-tarih görüntüsünü kullanır", () => {
  it("dönem bittikten sonraki rol, birim ve takvim değişikliği Temmuz'a uygulanmaz", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const eskiBirim = await createOrgUnit({
      name: "Eski Birim",
      parentId: kok.id,
      requiresApproval: false,
    });
    const yeniBirim = await createOrgUnit({
      name: "Yeni Birim",
      parentId: kok.id,
      requiresApproval: true,
    });
    const kisi = await createUser(eskiBirim.id, {
      fullName: "Temmuz Çalışanı",
      isUnitManager: false,
    });

    // Dönem içindeki güvenilir başlangıç görüntüsü. Sonraki gerçek tablo
    // değişiklikleri veritabanı tetikleyicisiyle ayrıca olay üretir.
    await testDb.scoreOrgUnitStateEvent.createMany({
      data: [
        {
          orgUnitId: eskiBirim.id,
          effectiveAt: TEMMUZ_BASI,
          parentId: kok.id,
          isActive: true,
          requiresApproval: false,
          reason: "TEST_BASELINE",
        },
        {
          orgUnitId: yeniBirim.id,
          effectiveAt: TEMMUZ_BASI,
          parentId: kok.id,
          isActive: true,
          requiresApproval: true,
          reason: "TEST_BASELINE",
        },
      ],
    });
    await testDb.scoreUnitCalendarEvent.create({
      data: {
        orgUnitId: eskiBirim.id,
        effectiveAt: TEMMUZ_BASI,
        hasOwnCalendar: true,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1050,
        worksOnHolidays: false,
        reason: "TEST_BASELINE",
      },
    });
    await testDb.scoreCompanyCalendarEvent.create({
      data: {
        effectiveAt: TEMMUZ_BASI,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1050,
        reason: "TEST_BASELINE",
      },
    });

    // Temmuz bittikten sonra kişi yönetici olur ve haftanın yedi günü çalışan
    // başka bir birime taşınır. Güncel satırlar artık Temmuz'u temsil etmez.
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: yeniBirim.id,
        workingDays: [1, 2, 3, 4, 5, 6, 7],
        workStartMinute: 420,
        workEndMinute: 1140,
        worksOnHolidays: true,
      },
    });
    await testDb.user.update({
      where: { id: kisi.id },
      data: { orgUnitId: yeniBirim.id, isUnitManager: true },
    });

    await closeScorePeriod(testDb, KAPANIS);

    const donem = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: kisi.id, periodStart: TEMMUZ_BASI },
      select: { profile: true, expectedDays: true },
    });
    expect(donem.profile).toBe("unapproved");
    expect(donem.expectedDays, "Temmuz'un hafta içi günleri").toBe(23);
  });

  it("dönem içinde ayrılan çalışanın paydası ayrılış gününden önce biter", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const kisi = await createUser(birim.id, { fullName: "Ayrılan Çalışan" });

    await testDb.scoreOrgUnitStateEvent.create({
      data: {
        orgUnitId: birim.id,
        effectiveAt: TEMMUZ_BASI,
        parentId: kok.id,
        isActive: true,
        requiresApproval: false,
        reason: "TEST_BASELINE",
      },
    });
    await testDb.scoreUserStateEvent.create({
      data: {
        userId: kisi.id,
        effectiveAt: new Date("2026-07-20T09:00:00.000Z"),
        isActive: false,
        isScored: true,
        writesActivities: true,
        isUnitManager: false,
        orgUnitId: birim.id,
        reason: "DEACTIVATED",
      },
    });
    await testDb.user.update({
      where: { id: kisi.id },
      data: { isActive: false },
    });

    await closeScorePeriod(testDb, KAPANIS);

    const donem = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: kisi.id, periodStart: TEMMUZ_BASI },
      select: { expectedDays: true },
    });
    expect(donem.expectedDays, "1–19 Temmuz arasındaki hafta içleri").toBe(13);
  });

  it("dönemden sonra eklenen birim takvimi ve tatil Temmuz'a geriye yürümez", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const kisi = await createUser(birim.id, { fullName: "Takvim Çalışanı" });

    // Bu iki güncel satır Temmuz bittikten sonra oluşuyor. Tarihçe sorgusu
    // güncel tabloyu yedek olarak kullanırsa Temmuz'a yanlışlıkla uygulanır.
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: birim.id,
        workingDays: [1, 2, 3, 4, 5, 6, 7],
        workStartMinute: 420,
        workEndMinute: 1140,
        worksOnHolidays: false,
      },
    });
    await testDb.holiday.create({
      data: {
        date: new Date("2026-07-15T00:00:00.000Z"),
        description: "Sonradan eklenen tatil",
      },
    });

    await closeScorePeriod(testDb, KAPANIS);

    const donem = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: kisi.id, periodStart: TEMMUZ_BASI },
      select: { expectedDays: true },
    });
    expect(donem.expectedDays, "Temmuz'un dönem sonundaki hafta içleri").toBe(23);
  });

  it("gerekçeli geçmiş düzeltmesi eski karneyi değiştirmeden yeni sürüm üretir", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const admin = await createUser(kok.id, {
      fullName: "Sistem Yöneticisi",
      isSystemAdmin: true,
      isScored: false,
      writesActivities: false,
    });
    const kisi = await createUser(birim.id, {
      fullName: "Düzeltilen Çalışan",
      isUnitManager: false,
    });
    await testDb.scoreOrgUnitStateEvent.create({
      data: {
        orgUnitId: birim.id,
        effectiveAt: TEMMUZ_BASI,
        parentId: kok.id,
        isActive: true,
        requiresApproval: false,
        reason: "TEST_BASELINE",
      },
    });

    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    const once = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: kisi.id, periodStart: TEMMUZ_BASI },
      select: { revisionNo: true, profile: true },
    });
    expect(once).toEqual({ revisionNo: 1, profile: "unapproved" });

    const correction = await correctUserScoreHistory(
      testDb,
      admin.id,
      {
        userId: kisi.id,
        effectiveAt: new Date("2026-07-01T09:00:00.000Z"),
        reason: "Temmuz ayında yönetici olduğu doğrulandı",
        state: {
          isActive: true,
          isScored: true,
          writesActivities: true,
          isUnitManager: true,
          orgUnitId: birim.id,
        },
      },
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(correction).toMatchObject({ ok: true, queuedPeriods: 1 });

    await closeScorePeriod(testDb, new Date("2026-08-10T09:01:00.000Z"));

    const surumler = await testDb.userScorePeriod.findMany({
      where: { userId: kisi.id, periodStart: TEMMUZ_BASI },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true, profile: true, revisionReason: true },
    });
    expect(surumler).toEqual([
      { revisionNo: 1, profile: "unapproved", revisionReason: "INITIAL" },
      {
        revisionNo: 2,
        profile: "manager",
        revisionReason: "USER_HISTORY_CORRECTION",
      },
    ]);
  });

  it("kişi o ay puanlanmamalıysa eski karneye geri düşmeden geçersiz kılınır", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const admin = await createUser(kok.id, {
      fullName: "Sistem Yöneticisi",
      isSystemAdmin: true,
      isScored: false,
      writesActivities: false,
    });
    const kisi = await createUser(birim.id, {
      fullName: "Yanlışlıkla Puanlanan Çalışan",
    });

    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    const correction = await correctUserScoreHistory(
      testDb,
      admin.id,
      {
        userId: kisi.id,
        effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
        reason: "Temmuz ayında puan kapsamına hiç girmemeliydi",
        state: {
          isActive: true,
          isScored: false,
          writesActivities: true,
          isUnitManager: false,
          orgUnitId: birim.id,
        },
      },
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(correction).toMatchObject({ ok: true, queuedPeriods: 1 });

    await closeScorePeriod(testDb, new Date("2026-08-10T09:01:00.000Z"));

    const surumler = await testDb.userScorePeriod.findMany({
      where: { userId: kisi.id, periodStart: TEMMUZ_BASI },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true, voided: true },
    });
    expect(surumler).toEqual([
      { revisionNo: 1, voided: false },
      { revisionNo: 2, voided: true },
    ]);
    expect(
      await readScoreTrend(
        testDb,
        { id: kisi.id, isSystemAdmin: false },
        kisi.id,
      ),
    ).toEqual({ periods: [], declining: false });
  });
});

// **Geçmişe etkili düzeltme kişiyi kapalı döneme ekleyebilmelidir**
// (denetim 25.08.2026, P8-R5-2). Çıkarma yönü yukarıda; buradaki test
// karşı yönü ölçüyor. Karnesi olmaması düzeltmenin **amacıdır**, bayat istek
// işareti değildir: ayrım dönem sonu görüntüsündeki uygunluktur.
describe("geçmişe etkili düzeltme kapalı döneme ekleyebilir", () => {
  it("sehven kapsam dışı bırakılan kişiye gerekçeli düzeltme ilk karneyi yazar", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({
      name: "Kalıphane",
      parentId: kok.id,
      requiresApproval: false,
    });
    const admin = await createUser(kok.id, {
      fullName: "Sistem Yöneticisi",
      isSystemAdmin: true,
      isScored: false,
      writesActivities: false,
    });
    // Temmuz boyunca sehven puan kapsamı dışında işaretlenmiş çalışan.
    const kisi = await createUser(birim.id, {
      fullName: "Kapsam Dışı Bırakılan",
      isScored: false,
    });
    await createActivity(kisi, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    expect(
      await testDb.userScorePeriod.count({ where: { userId: kisi.id } }),
      "kapanış anında kapsam dışı olduğu için karnesi olmamalı",
    ).toBe(0);
    const defter = await testDb.scorePeriodLedger.findUniqueOrThrow({
      where: { periodStart: TEMMUZ_BASI },
      select: { formulaVersion: true },
    });

    const correction = await correctUserScoreHistory(
      testDb,
      admin.id,
      {
        userId: kisi.id,
        effectiveAt: TEMMUZ_BASI,
        reason: "Temmuz ayında puan kapsamında olmalıydı, sehven dışlandı",
        state: {
          isActive: true,
          isScored: true,
          writesActivities: true,
          isUnitManager: false,
          orgUnitId: birim.id,
        },
      },
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(correction).toMatchObject({ ok: true, queuedPeriods: 1 });

    // Gerçek kuyruk işçisi.
    const tur = await drainScorePeriodWork(
      testDb,
      new Date("2026-08-10T09:01:00.000Z"),
    );
    expect(tur).toMatchObject({ processed: 1, written: 1 });

    const surumler = await testDb.userScorePeriod.findMany({
      where: { userId: kisi.id, periodStart: TEMMUZ_BASI },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true, voided: true, revisionReason: true, formulaVersion: true },
    });
    // İlk sürüm, dönem kayıt defterindeki formül sürümüyle yazılır: düzeltme
    // öncesi bir karne olmadığı için kopyalanacak hesap sürümü de yoktur.
    expect(surumler).toEqual([
      {
        revisionNo: 1,
        voided: false,
        revisionReason: "USER_HISTORY_CORRECTION",
        formulaVersion: defter.formulaVersion,
      },
    ]);

    // Karne ekranda da görünür ve girilen gün paydaya yansımıştır.
    const trend = await readScoreTrend(
      testDb,
      { id: kisi.id, isSystemAdmin: false },
      kisi.id,
    );
    expect(trend.periods).toHaveLength(1);
    expect(trend.periods[0].periodStart).toBe("2026-07-01");

    // Kuyrukta bekleyen iş kalmamalı.
    expect(
      await testDb.scoreRecalculationRequest.count({ where: { processedAt: null } }),
    ).toBe(0);
  });
});
