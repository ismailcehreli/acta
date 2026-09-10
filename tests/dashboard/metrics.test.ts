import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  countScopeActivities,
  listScopeActivities,
} from "@/server/activities/scope-feed";
import { countOwnActivities, listOwnActivities } from "@/server/activities/read";
import { dashboardMetrics, personalDashboardMetrics } from "@/server/dashboard/metrics";
import { subordinateUserIds } from "@/server/authz/visibility";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-18T12:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function soruAc(activityId: string, askerId: string, responsibleId: string) {
  return testDb.conversation.create({
    data: { activityId, askerId, responsibleId, status: "OPEN" },
  });
}

describe("dashboard sayaç kapsamı", () => {
  it("kişisel ve yönetilen alan sayaçlarını birbirine karıştırmaz", async () => {
    const birim = await createOrgUnit({ name: "Üretim" });
    const yonetici = await createUser(birim.id, {
      fullName: "Birim Yöneticisi",
      isUnitManager: true,
    });
    const calisan = await createUser(birim.id, { fullName: "Çalışan" });

    await createActivity(yonetici, {
      activityDate: new Date("2026-08-18T00:00:00.000Z"),
    });
    await createActivity(calisan, {
      activityDate: new Date("2026-08-18T00:00:00.000Z"),
    });

    const personal = await personalDashboardMetrics(
      testDb,
      { id: yonetici.id, isSystemAdmin: false },
      "week",
      NOW,
    );
    const managed = await dashboardMetrics(
      testDb,
      { id: yonetici.id, isSystemAdmin: false },
      await subordinateUserIds(testDb, yonetici.id),
      "week",
      NOW,
    );

    expect(personal.activities).toBe(1);
    expect(personal.contributors).toBe(1);
    expect(managed.activities).toBe(1);
    expect(managed.contributors).toBe(1);
  });

  it("iptal edilen ve reddedilen kayıt sayaçlarda yer almaz", async () => {
    // Sayaç "ne kadar iş yapıldı" sorusuna cevap veriyor; iptal edilen kayıt
    // yapılmamış sayılır, reddedilen kayıt da yönetime sunulmaya uygun
    // bulunmamıştır. Skor ikisini de saymıyordu (`scoring/collect.ts`);
    // dashboard sayıyordu ve aynı ay için iki farklı sayı çıkıyordu.
    const birim = await createOrgUnit({ name: "Üretim" });
    const yonetici = await createUser(birim.id, {
      fullName: "Birim Yöneticisi",
      isUnitManager: true,
    });
    const calisan = await createUser(birim.id, { fullName: "Çalışan" });

    const gun = new Date("2026-08-18T00:00:00.000Z");
    // Reddedilen kayıtta gerekçe **ve** reddeden zorunlu; veritabanı kısıtları
    // ikisini de arıyor. Reddeden yazarın kendisi olamaz, bu yüzden ret
    // yalnız çalışanın kaydında kuruluyor.
    const gerekce = await createApprovalReason("REJECTED");

    await createActivity(yonetici, { activityDate: gun });
    await createActivity(yonetici, { activityDate: gun, approvalStatus: "CANCELLED" });

    await createActivity(calisan, { activityDate: gun });
    await createActivity(calisan, { activityDate: gun, approvalStatus: "CANCELLED" });
    await createActivity(calisan, {
      activityDate: gun,
      approvalStatus: "REJECTED",
      approverId: yonetici.id,
      approvalReasonId: gerekce.id,
      approvalReasonKind: "REJECTED",
    });

    const personal = await personalDashboardMetrics(
      testDb,
      { id: yonetici.id, isSystemAdmin: false },
      "week",
      NOW,
    );
    const calisaninKendisi = await personalDashboardMetrics(
      testDb,
      { id: calisan.id, isSystemAdmin: false },
      "week",
      NOW,
    );
    const managed = await dashboardMetrics(
      testDb,
      { id: yonetici.id, isSystemAdmin: false },
      await subordinateUserIds(testDb, yonetici.id),
      "week",
      NOW,
    );

    expect(personal.activities).toBe(1);
    // Reddedilen kayıt yazarın kendi sayacında da görünmez.
    expect(calisaninKendisi.activities).toBe(1);
    expect(managed.activities).toBe(1);
  });

  it("yalnız iptal/reddedilmiş kaydı olan kişi katkı veren sayılmaz", async () => {
    const birim = await createOrgUnit({ name: "Üretim" });
    const yonetici = await createUser(birim.id, {
      fullName: "Birim Yöneticisi",
      isUnitManager: true,
    });
    const calisan = await createUser(birim.id, { fullName: "Çalışan" });

    const gun = new Date("2026-08-18T00:00:00.000Z");
    await createActivity(calisan, { activityDate: gun, approvalStatus: "CANCELLED" });

    const managed = await dashboardMetrics(
      testDb,
      { id: yonetici.id, isSystemAdmin: false },
      await subordinateUserIds(testDb, yonetici.id),
      "week",
      NOW,
    );

    expect(managed.activities).toBe(0);
    expect(managed.contributors).toBe(0);
  });

  it("yönetilen açık soru sayacı faaliyeti bir kez sayar ve listeyle eşleşir", async () => {
    const birim = await createOrgUnit({ name: "Üretim" });
    const yonetici = await createUser(birim.id, {
      fullName: "Birim Yöneticisi",
      isUnitManager: true,
    });
    const calisan = await createUser(birim.id, { fullName: "Çalışan" });
    const soran = await createUser(birim.id, { fullName: "Soran" });
    const ikinciSoran = await createUser(birim.id, { fullName: "İkinci Soran" });

    const kendiSorusu = await createActivity(calisan, { title: "Yalnız kendi sorusu" });
    await soruAc(kendiSorusu.id, yonetici.id, calisan.id);

    const karisik = await createActivity(calisan, { title: "Kendi ve gelen soru" });
    await soruAc(karisik.id, yonetici.id, calisan.id);
    await soruAc(karisik.id, soran.id, calisan.id);

    const ikiGelen = await createActivity(calisan, { title: "İki gelen soru" });
    await soruAc(ikiGelen.id, soran.id, calisan.id);
    await soruAc(ikiGelen.id, ikinciSoran.id, calisan.id);

    const viewer = { id: yonetici.id, isSystemAdmin: false };
    const asts = await subordinateUserIds(testDb, yonetici.id);
    const filters = { period: "all" as const, openQuestions: true };
    const [metrics, liste, sayac] = await Promise.all([
      dashboardMetrics(testDb, viewer, asts, "week", NOW),
      listScopeActivities(testDb, viewer, filters, NOW, {
        managedOnly: true,
        subordinates: asts,
      }),
      countScopeActivities(testDb, viewer, filters, NOW, {
        managedOnly: true,
        subordinates: asts,
      }),
    ]);

    expect(metrics.openQuestions).toBe(2);
    expect(sayac).toBe(2);
    expect(liste.items).toHaveLength(sayac);
    expect(new Set(liste.items.map((item) => item.id))).toEqual(
      new Set([karisik.id, ikiGelen.id]),
    );
  });

  it("kişisel açık soru sayacı kendi sorusunu saymaz", async () => {
    const birim = await createOrgUnit({ name: "Üretim" });
    const calisan = await createUser(birim.id, { fullName: "Çalışan" });
    const soran = await createUser(birim.id, { fullName: "Soran" });

    const kendiSorusu = await createActivity(calisan, { title: "Kendi sorusu" });
    await soruAc(kendiSorusu.id, calisan.id, soran.id);

    const gelenSoru = await createActivity(calisan, { title: "Gelen soru" });
    await soruAc(gelenSoru.id, soran.id, calisan.id);

    const viewer = { id: calisan.id, isSystemAdmin: false };
    const filters = { period: "all" as const, now: NOW, openQuestions: true };
    const [metrics, liste, sayac] = await Promise.all([
      personalDashboardMetrics(testDb, viewer, "week", NOW),
      // Kişisel dashboard sayacı faaliyetlerim listesindeki aynı koşulu kullanır.
      // Listeyi burada ayrıca çağırmak, count/list eşitliğini kanıtlar.
      listOwnActivities(testDb, viewer, filters),
      countOwnActivities(testDb, viewer, filters),
    ]);

    expect(metrics.openQuestions).toBe(1);
    expect(liste.map((item) => item.id)).toEqual([gelenSoru.id]);
    expect(sayac).toBe(1);
  });
});
