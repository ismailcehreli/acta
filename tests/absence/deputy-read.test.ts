import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { markNoActivityPeriod } from "@/server/absence/service";
import { listDeputyPeriods } from "@/server/absence/deputy-read";
import { AUDIT_ACTIONS } from "@/server/audit/log";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// VEKÂLET ÖZETİ ŞİRKET GÜNÜNE GÖRE KESİLİR (denetim 21.08.2026, bulgu 12).
//
// Dönemin `startDate`/`endDate` alanları birer **gün** değeridir ve
// veritabanında UTC gece yarısı olarak durur. Karar anları ise gerçek
// zamanlardır. İkisi doğrudan karşılaştırılıyordu; İstanbul UTC'den üç saat
// ileride olduğu için pencere kayıyordu:
//
//   · İstanbul'da dönemin ilk günü 00:30'da verilen karar özetin DIŞINDA
//     kalıyordu (UTC'de bir önceki güne düşüyor).
//   · İstanbul'da dönemin bitiminden sonraki gün 02:00'de verilen karar
//     özete GİRİYORDU (UTC'de hâlâ son gün).
//
// §16.5: bütün tarih yorumları Europe/Istanbul.

const IZIN_ICI = new Date("2026-08-21T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Tek günlük vekâlet: 21 Ağustos 2026. */
async function tekGunlukVekalet() {
  const kok = await createOrgUnit({ name: "Acta HQ" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const genelMudur = await createUser(kok.id, {
    email: "gm@ornek.test",
    isUnitManager: true,
  });
  const kalipMudur = await createUser(kaliphane.id, {
    email: "kalip@ornek.test",
    isUnitManager: true,
  });
  const vekil = await createUser(planlama.id, {
    email: "vekil@ornek.test",
    isUnitManager: true,
  });

  const donem = await markNoActivityPeriod(
    testDb,
    genelMudur.id,
    {
      userId: kalipMudur.id,
      startDate: "2026-08-21",
      endDate: "2026-08-21",
      deputyId: vekil.id,
    },
    IZIN_ICI,
  );
  if (!donem.ok) throw new Error("kurulum");

  return { kalipMudur, vekil };
}

/** Vekilin, adına iş yaptığı kişi için bıraktığı karar izi. */
async function kararIzi(vekilId: string, adinaId: string, createdAt: Date) {
  await testDb.auditLog.create({
    data: {
      userId: vekilId,
      actualUserId: adinaId,
      objectType: "activity",
      objectId: "00000000-0000-4000-8000-000000000001",
      action: AUDIT_ACTIONS.activityApproved,
      createdAt,
    },
  });
}

describe("dönem sınırları İstanbul gününe göre", () => {
  it("dönemin ilk günü gece yarısından sonraki karar sayılır", async () => {
    const { kalipMudur, vekil } = await tekGunlukVekalet();

    // İstanbul 21 Ağustos 00:30 = UTC 20 Ağustos 21:30.
    await kararIzi(vekil.id, kalipMudur.id, new Date("2026-08-20T21:30:00.000Z"));

    const donemler = await listDeputyPeriods(testDb, vekil.id, IZIN_ICI);

    expect(donemler).toHaveLength(1);
    expect(donemler[0]?.decisionCount).toBe(1);
  });

  it("dönemden sonraki günün ilk saatlerindeki karar sayılmaz", async () => {
    const { kalipMudur, vekil } = await tekGunlukVekalet();

    // İstanbul 22 Ağustos 02:00 = UTC 21 Ağustos 23:00. Dönem 21 Ağustos'ta
    // bitiyor; bu karar artık ertesi güne aittir.
    await kararIzi(vekil.id, kalipMudur.id, new Date("2026-08-21T23:00:00.000Z"));

    const donemler = await listDeputyPeriods(testDb, vekil.id, IZIN_ICI);

    expect(donemler[0]?.decisionCount).toBe(0);
  });

  it("dönem içindeki mesai saatindeki karar sayılır", async () => {
    const { kalipMudur, vekil } = await tekGunlukVekalet();

    // Kontrol testi: yukarıdaki iki sonucun sebebi sınır hesabı olmalı,
    // "hiç sayılmıyor" ya da "hep sayılıyor" değil.
    await kararIzi(vekil.id, kalipMudur.id, new Date("2026-08-21T11:00:00.000Z"));

    const donemler = await listDeputyPeriods(testDb, vekil.id, IZIN_ICI);

    expect(donemler[0]?.decisionCount).toBe(1);
  });

  it("dönemden önceki günün son saatindeki karar sayılmaz", async () => {
    const { kalipMudur, vekil } = await tekGunlukVekalet();

    // İstanbul 20 Ağustos 23:00 = UTC 20 Ağustos 20:00.
    await kararIzi(vekil.id, kalipMudur.id, new Date("2026-08-20T20:00:00.000Z"));

    const donemler = await listDeputyPeriods(testDb, vekil.id, IZIN_ICI);

    expect(donemler[0]?.decisionCount).toBe(0);
  });
});
