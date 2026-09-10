import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  visibleActivitySql,
  visibleActivityWhere,
  type Viewer,
} from "@/server/authz/visibility";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Görünürlük kuralının iki gösterimi var: Prisma filtresi (liste, detay) ve
// SQL parçası (arama). İkisinin ayrışması sessiz bir sızıntı demektir — bu
// dosya ikisini birbirine bağlar: **aynı kümeyi** döndürmek zorundalar.
//
// Test senaryoyu tek tek elle kurmaz; ağacın her kademesinden bakan için,
// her onay durumundan kayıt bulunan bir şirkette karşılaştırır.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

const DURUMLAR = [
  "APPROVED",
  "CANCELLED",
  "PENDING_APPROVAL",
  // Onay akışı Sürüm 1'e alınınca bu durum da gerçek oldu (19.08.2026);
  // denklik sınaması onu da kapsamalı.
  "CHANGES_REQUESTED",
  // Reddetme de 19.08.2026'da geldi; süzülmemiş içeriğin yukarı akmadığı
  // burada da sınanmalı.
  "REJECTED",
  "MANAGER_NOT_FOUND",
  "DRAFT",
] as const;

async function sirket() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const gm = await createOrgUnit({ name: "Genel Müdürlük", parentId: root.id });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: gm.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: gm.id });

  const baskan = await createUser(root.id, { fullName: "Başkan", isUnitManager: true });
  const genelMudur = await createUser(gm.id, { fullName: "Genel Müdür", isUnitManager: true });
  const kalipMudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const planlamaMudur = await createUser(planlama.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });
  const kalipCalisan = await createUser(kaliphane.id, { fullName: "Kalıphane Çalışanı" });
  const sistemYoneticisi = await createUser(gm.id, {
    fullName: "Sistem Yöneticisi",
    isSystemAdmin: true,
  });

  const yazarlar = [
    baskan,
    genelMudur,
    kalipMudur,
    planlamaMudur,
    kalipCalisan,
    sistemYoneticisi,
  ];

  // Her yazardan her durumda bir kayıt: kombinasyonların hiçbiri boşta kalmasın.
  // Onay sürecindeki durumlar onaylayıcı ister (veritabanı kısıtı); onaylayıcı
  // §4.4'ün çözdüğü gerçek yöneticidir, yoksa kayıt MANAGER_NOT_FOUND doğar —
  // üretimdeki davranışın aynısı.
  const { resolveManager } = await import("@/server/org/resolve-manager");
  let gun = 1;
  for (const yazar of yazarlar) {
    for (const durum of DURUMLAR) {
      const onayGerekir =
        durum === "PENDING_APPROVAL" ||
        durum === "CHANGES_REQUESTED" ||
        durum === "REJECTED";
      const yonetici = onayGerekir
        ? await resolveManager(testDb, yazar.id)
        : null;
      const onaylayanId =
        yonetici && yonetici.found ? yonetici.managerId : null;
      const gercekDurum =
        onayGerekir && onaylayanId === null ? "MANAGER_NOT_FOUND" : durum;

      await testDb.activity.create({
        data: {
          authorId: yazar.id,
          authorOrgUnitId: yazar.orgUnitId,
          activityDate: new Date(Date.UTC(2026, 7, (gun % 28) + 1)),
          title: `${yazar.fullName} ${durum}`,
          description: "Açıklama",
          approvalStatus: gercekDurum,
          approverId: gercekDurum === durum ? onaylayanId : null,
          ...(gercekDurum === "CHANGES_REQUESTED" || gercekDurum === "REJECTED"
            ? {
                approvalReasonId: (
                  await testDb.approvalReason.upsert({
                    where: {
                      kind_label: { kind: gercekDurum, label: "Test gerekçesi" },
                    },
                    create: { kind: gercekDurum, label: "Test gerekçesi" },
                    update: {},
                  })
                ).id,
                approvalReasonKind: gercekDurum,
              }
            : {}),
        },
      });
      gun += 1;
    }
  }

  return { yazarlar };
}

async function prismaIdleri(viewer: Viewer): Promise<string[]> {
  const where = await visibleActivityWhere(testDb, viewer);
  const rows = await testDb.activity.findMany({ where, select: { id: true } });
  return rows.map((r) => r.id).sort();
}

async function sqlIdleri(viewer: Viewer): Promise<string[]> {
  const filtre = await visibleActivitySql(testDb, viewer, "a");
  const rows = await testDb.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT a."id" FROM "Activity" a WHERE ${filtre}`,
  );
  return rows.map((r) => r.id).sort();
}

describe("görünürlüğün iki gösterimi aynı kümeyi verir", () => {
  it("her kademeden bakan için sonuçlar birebir aynıdır", async () => {
    const { yazarlar } = await sirket();

    for (const kisi of yazarlar) {
      const viewer: Viewer = {
        id: kisi.id,
        isSystemAdmin: kisi.isSystemAdmin,
      };

      const prismaSonuc = await prismaIdleri(viewer);
      const sqlSonuc = await sqlIdleri(viewer);

      expect(sqlSonuc, `${kisi.fullName} için kümeler ayrıştı`).toEqual(prismaSonuc);
      // Küme boş olsaydı karşılaştırma hiçbir şey kanıtlamazdı.
      expect(prismaSonuc.length).toBeGreaterThan(0);
    }
  });

  it("astı olmayan kişi yalnızca kendi kayıtlarını görür", async () => {
    const { yazarlar } = await sirket();
    const calisan = yazarlar.find((y) => y.fullName === "Kalıphane Çalışanı")!;
    const viewer: Viewer = { id: calisan.id, isSystemAdmin: false };

    const sqlSonuc = await sqlIdleri(viewer);
    const kendi = await testDb.activity.findMany({
      where: { authorId: calisan.id },
      select: { id: true },
    });

    expect(sqlSonuc).toEqual(kendi.map((r) => r.id).sort());
  });

  it("takma ad koddan gelmeyen bir değer olamaz", async () => {
    const { yazarlar } = await sirket();

    await expect(
      visibleActivitySql(testDb, { id: yazarlar[0].id, isSystemAdmin: false }, 'a" OR "1'),
    ).rejects.toThrow(/Geçersiz tablo takma adı/);
  });
});
