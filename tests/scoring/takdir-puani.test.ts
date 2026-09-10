import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { appreciateActivity } from "@/server/scoring/appreciation";
import { closeScorePeriod } from "@/server/scoring/close-period";
import {
  readScoreTrend,
  readTeamScores,
  readUserScore,
} from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const CANLI_AN = new Date("2026-08-22T09:00:00.000Z");
const TAKDIR_ANI = new Date("2026-08-21T10:00:00.000Z");
const KAPANIS_ANI = new Date("2026-08-03T06:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, {
    [SETTING_KEYS.scoringEnabled]: "true",
    [SETTING_KEYS.appreciationEnabled]: "true",
    [SETTING_KEYS.scoringAppreciationPoints]: "2",
  });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sahne() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({
    name: "Kalıphane",
    parentId: kok.id,
    requiresApproval: true,
  });
  const mudur = await createUser(birim.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
    canAppreciate: true,
  });
  const calisan = await createUser(birim.id, { fullName: "Kadir Usta" });

  const onayli = await createActivity(calisan, {
    title: "Onaylanmış faaliyet",
    activityDate: new Date("2026-08-17T00:00:00.000Z"),
    approvalStatus: "APPROVED",
    approverId: mudur.id,
    approvalSubmittedAt: new Date("2026-08-17T08:00:00.000Z"),
    approvalDecidedAt: new Date("2026-08-17T09:00:00.000Z"),
  });
  const bekleyen = await createActivity(calisan, {
    title: "Onay bekleyen faaliyet",
    activityDate: new Date("2026-08-18T00:00:00.000Z"),
    approvalStatus: "PENDING_APPROVAL",
    approverId: mudur.id,
    approvalSubmittedAt: new Date("2026-08-18T08:00:00.000Z"),
  });

  return { kok, mudur, calisan, onayli, bekleyen };
}

describe("takdir puanı", () => {
  it("onaylanmış faaliyete verilen takdir genel puana eklenir", async () => {
    const { mudur, calisan, onayli } = await sahne();
    const bakan = { id: mudur.id, isSystemAdmin: false };

    const once = await readUserScore(testDb, bakan, calisan.id, CANLI_AN);
    expect(once).not.toBeNull();

    const sonuc = await appreciateActivity(
      testDb,
      mudur.id,
      onayli.id,
      TAKDIR_ANI,
    );
    expect(sonuc).toEqual({ ok: true });

    const sonra = await readUserScore(testDb, bakan, calisan.id, CANLI_AN);
    expect(sonra).not.toBeNull();
    expect(sonra?.appreciationCount).toBe(1);
    expect(sonra?.appreciationPointsPer).toBe(2);
    expect(sonra?.appreciationPoints).toBe(2);
    expect(sonra?.total).toBe((once?.total ?? 0) + 2);
    expect(sonra?.baseTotal).toBe((sonra?.total ?? 0) - 2);

    const ekip = await readTeamScores(testDb, bakan, CANLI_AN);
    expect(ekip.find((skor) => skor.userId === calisan.id)).toMatchObject({
      appreciationCount: 1,
      appreciationPoints: 2,
      total: sonra?.total,
    });
  });

  it("onay bekleyen faaliyetin takdiri skora girmez", async () => {
    const { mudur, calisan, onayli, bekleyen } = await sahne();
    const bakan = { id: mudur.id, isSystemAdmin: false };

    const once = await readUserScore(testDb, bakan, calisan.id, CANLI_AN);
    await appreciateActivity(testDb, mudur.id, onayli.id, TAKDIR_ANI);
    await appreciateActivity(testDb, mudur.id, bekleyen.id, TAKDIR_ANI);

    const sonra = await readUserScore(testDb, bakan, calisan.id, CANLI_AN);
    expect(sonra?.appreciationCount).toBe(1);
    expect(sonra?.appreciationPoints).toBe(2);
    expect(sonra?.total).toBe((once?.total ?? 0) + 2);
  });

  it("takdir başına puan açık dönemde ayardan değiştirilebilir", async () => {
    const { mudur, calisan, onayli } = await sahne();
    const bakan = { id: mudur.id, isSystemAdmin: false };

    await appreciateActivity(testDb, mudur.id, onayli.id, TAKDIR_ANI);
    const ikiPuan = await readUserScore(testDb, bakan, calisan.id, CANLI_AN);

    const ayar = await saveSettings(testDb, {
      [SETTING_KEYS.scoringAppreciationPoints]: "5",
    });
    expect(ayar.ok).toBe(true);
    expect(
      await testDb.scoreSettingEvent.findFirst({
        where: {
          key: SETTING_KEYS.scoringAppreciationPoints,
          value: "5",
        },
      }),
    ).not.toBeNull();

    const besPuan = await readUserScore(testDb, bakan, calisan.id, CANLI_AN);
    expect(besPuan?.appreciationPointsPer).toBe(5);
    expect(besPuan?.appreciationPoints).toBe(5);
    expect(besPuan?.total).toBe((ikiPuan?.total ?? 0) + 3);
  });

  it("kapanmış dönem takdir puanı ayar değişikliğinden etkilenmez", async () => {
    const { mudur, calisan } = await sahne();
    const temmuzFaaliyeti = await createActivity(calisan, {
      title: "Temmuz faaliyeti",
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: mudur.id,
      approvalSubmittedAt: new Date("2026-07-15T08:00:00.000Z"),
      approvalDecidedAt: new Date("2026-07-15T09:00:00.000Z"),
    });
    await appreciateActivity(
      testDb,
      mudur.id,
      temmuzFaaliyeti.id,
      new Date("2026-07-20T10:00:00.000Z"),
    );

    // Test zamanı Ağustos olduğu için güncel ayar olayı Temmuz tarihçesine
    // girmez; dönem için geçerli değeri açıkça Temmuz başına yazarız.
    await testDb.scoreSettingEvent.create({
      data: {
        key: SETTING_KEYS.scoringAppreciationPoints,
        value: "2",
        effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
        reason: "TEST",
      },
    });

    await closeScorePeriod(testDb, KAPANIS_ANI);
    const satir = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: calisan.id, periodStart: new Date("2026-07-01T00:00:00.000Z") },
      select: { total: true, appreciationPointsPer: true },
    });
    expect(satir.appreciationPointsPer).toBe(2);
    expect(
      await testDb.userScorePeriodFact.count({
        where: { userId: calisan.id, kind: "APPRECIATION" },
      }),
    ).toBe(1);

    const once = await readScoreTrend(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      calisan.id,
    );

    const ayar = await saveSettings(testDb, {
      [SETTING_KEYS.scoringAppreciationPoints]: "7",
    });
    expect(ayar.ok).toBe(true);

    const sonra = await readScoreTrend(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      calisan.id,
    );
    expect(once).toEqual({
      periods: [{ periodStart: "2026-07-01", total: satir.total }],
      declining: false,
    });
    expect(sonra).toEqual(once);
  });
});
