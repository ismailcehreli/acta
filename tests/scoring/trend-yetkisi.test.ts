import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeScorePeriod } from "@/server/scoring/close-period";
import { readScoreTrends } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Toplu trend okuması **kendi hedeflerini yetkilendirir** (denetim
// 25.08.2026, P8-1).
//
// Tek kişilik `readScoreTrend` hedef için `gorebilirMi` çağırıyordu; toplu
// `readScoreTrends` ise çağıranın verdiği listeyi olduğu gibi sorguya
// sokuyordu. Olguları `visibleActivityWhere` ile süzmek **hedef kişiye erişim
// denetimi değildir**: kapsam dışı kişi için bile dönem sayısı, donmuş payda
// ve profil üzerinden hesaplanan bir toplam dönüyordu.
//
// "Bugünkü çağıran zaten kapsamlı liste üretiyor" savunması yetmez: güvenlik
// servis sınırında durmalı, çağıranın sırasına bırakılmamalı (§18.4).

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

/** İki ayrı dal: kimse diğerinin astı değil. */
async function ikiDal() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const boyahane = await createOrgUnit({ name: "Boyahane", parentId: kok.id });

  const kaliphaneMuduru = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const boyaci = await createUser(boyahane.id, { fullName: "Boyahane Çalışanı" });

  // Boyacının Temmuz'da kaydı ve kapanmış dönemi olsun.
  await createActivity(boyaci, {
    activityDate: new Date("2026-07-15T00:00:00.000Z"),
  });
  await closeScorePeriod(testDb, KAPANIS);

  return { kaliphaneMuduru, boyaci };
}

describe("toplu trend okuması kapsam dışına veri vermez", () => {
  it("kapsam dışı kimlik doğrudan verilse bile sonuç dönmez", async () => {
    const { kaliphaneMuduru, boyaci } = await ikiDal();

    // Çağıran kapsamı hiç sormadan kimliği veriyor — yeni bir çağırıcının
    // yapabileceği şeyin aynısı.
    const trendler = await readScoreTrends(
      testDb,
      { id: kaliphaneMuduru.id, isSystemAdmin: false },
      [boyaci.id],
    );

    // Kimlik **hiç** girmemeli: boş trend döndürmek bile "böyle bir kişi var"
    // demenin bir yolu olurdu.
    expect(trendler.has(boyaci.id)).toBe(false);
    expect(trendler.size).toBe(0);
  });

  it("kapsam içi ve dışı karışık verildiğinde yalnız kapsam içi döner", async () => {
    const { kaliphaneMuduru, boyaci } = await ikiDal();

    const trendler = await readScoreTrends(
      testDb,
      { id: kaliphaneMuduru.id, isSystemAdmin: false },
      [boyaci.id, kaliphaneMuduru.id],
    );

    expect(trendler.has(boyaci.id)).toBe(false);
    // Kişinin kendisi her zaman kendi kapsamındadır.
    expect(trendler.has(kaliphaneMuduru.id)).toBe(true);
  });

  it("kapsam içi ast için trend döner", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const mudur = await createUser(birim.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
    });
    const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
    await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
    await closeScorePeriod(testDb, KAPANIS);

    const trendler = await readScoreTrends(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      [kadir.id],
    );

    expect(trendler.get(kadir.id)?.periods.length).toBeGreaterThan(0);
  });
});
