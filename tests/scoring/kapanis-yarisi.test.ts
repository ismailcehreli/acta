import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeScorePeriod } from "@/server/scoring/close-period";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

// İki kapanış işçisi aynı dönemde yarışabilir (denetim 25.08.2026,
// P8-7).
//
// "Var mı?" okuması ile `create` ayrı işlemlerdeydi: iki işçi de boş görüp
// aynı `(userId, periodStart)` satırını yazmaya kalkıyor, biri `P2002`
// tekillik hatasıyla **bütün çağrıdan** düşüyordu. Dağıtım sırasında eski ve
// yeni worker bir arada çalışabiliyor; sonuç yalancı iş arızası ve kısmi
// kapanış.
//
// Beklenen davranış: ikisi de hatasız tamamlanır, tek dönem ve tek katkı
// kümesi kalır.

// Kapanış, geriye giriş penceresi kapandıktan sonra koşar (P8-R2-2):
// varsayılan ayarla 31 Temmuz kaydı 1 Ağustos'ta hâlâ girilebiliyor.
const KAPANIS = new Date(Date.UTC(2026, 7, 3, 6, 0, 0));

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("eşzamanlı kapanış", () => {
  it("iki işçi aynı dönemi kapatınca ikisi de hatasız biter", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
    for (const gun of ["2026-07-15", "2026-07-16", "2026-07-17"]) {
      await createActivity(kadir, {
        activityDate: new Date(`${gun}T00:00:00.000Z`),
      });
    }

    // **İki ayrı bağlantı**: aynı istemciyi paylaşmak yarışı gizlerdi.
    const ikinci = new PrismaClient({
      datasources: { db: { url: testDatabaseUrl } },
    });

    try {
      const sonuclar = await Promise.allSettled([
        closeScorePeriod(testDb, KAPANIS),
        closeScorePeriod(ikinci, KAPANIS),
      ]);

      const hatalar = sonuclar.flatMap((s) =>
        s.status === "rejected" ? [String(s.reason)] : [],
      );
      expect(hatalar, `kapanış hata verdi: ${hatalar.join(" · ")}`).toEqual([]);

      // Tek dönem, tek katkı kümesi.
      const donemler = await testDb.userScorePeriod.count({
        where: { userId: kadir.id, periodStart: new Date("2026-07-01T00:00:00.000Z") },
      });
      expect(donemler).toBe(1);

      const olgular = await testDb.userScorePeriodFact.count({
        where: { userId: kadir.id, kind: "WRITTEN" },
      });
      expect(olgular).toBe(3);

      // Kurulumda tek kişi var: biri yazar, diğeri atlar. Toplam **bir**
      // olmalı; iki olsaydı aynı dönem iki kez sayılmış olurdu.
      const yazilanToplam = sonuclar.flatMap((s) =>
        s.status === "fulfilled" ? [s.value.written] : [],
      );
      expect(yazilanToplam.reduce((a, b) => a + b, 0)).toBe(1);
    } finally {
      await ikinci.$disconnect();
    }
  });
});
