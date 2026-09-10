import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/server/audit/log";
import { DEMO_EMAIL_DOMAIN, DEMO_UNIT_NAMES, installDemoData } from "@/server/demo/data";
import {
  classifyLegacyDemoOrgUnits,
  DEMO_OBJECT_ORG_UNIT,
  DEMO_ORIGIN_CREATED,
  DEMO_ORIGIN_REUSED,
  listLegacyDemoOriginCandidates,
} from "@/server/demo/origin";
import { purgeDemoData } from "@/server/demo/purge";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kur(preexistingPlanlama = false) {
  const kok = await createOrgUnit({ name: "Acta HQ", type: "Kök" });
  const yonetici = await createUser(kok.id, {
    fullName: "Sistem Yöneticisi",
    email: "yonetici@sirket.test",
    isSystemAdmin: true,
  });
  const planlama = preexistingPlanlama
    ? await createOrgUnit({ name: "Production Planning", parentId: kok.id })
    : null;

  const sonuc = await installDemoData(testDb);
  if (!sonuc.ok) throw new Error(`kurulum başarısız: ${sonuc.error}`);

  return { kok, yonetici, planlama };
}

async function sayilar() {
  return {
    users: await testDb.user.count({
      where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    }),
    activities: await testDb.activity.count({
      where: { author: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } },
    }),
    units: await testDb.orgUnit.count({
      where: { name: { in: [...DEMO_UNIT_NAMES] } },
    }),
  };
}

describe("örnek birim kökeni", () => {
  it("veritabanı geçersiz köken değerini reddeder", async () => {
    await expect(
      testDb.$executeRawUnsafe(
        `INSERT INTO "DemoObject" ("objectType", "objectId", "origin") ` +
          `VALUES ('org_unit', 'gecersiz', 'TAHMIN_EDILDI')`,
      ),
    ).rejects.toThrow();
    expect(await testDb.demoObject.count()).toBe(0);
  });

  it("taze kurulum oluşturduğu ve yeniden kullandığı birimleri ayırır", async () => {
    const { planlama } = await kur(true);

    const kayitlar = await testDb.demoObject.findMany({
      where: { objectType: DEMO_OBJECT_ORG_UNIT },
      orderBy: { objectId: "asc" },
    });

    expect(kayitlar).toHaveLength(DEMO_UNIT_NAMES.length);
    expect(
      kayitlar.filter((kayit) => kayit.origin === DEMO_ORIGIN_CREATED),
    ).toHaveLength(DEMO_UNIT_NAMES.length - 1);
    expect(kayitlar).toContainEqual(
      expect.objectContaining({
        objectId: planlama!.id,
        origin: DEMO_ORIGIN_REUSED,
      }),
    );
  });

  it("ikinci kurulum oluşturulmuş birimin kökenini yeniden kullanıldı diye ezmez", async () => {
    await kur();

    const once = await testDb.demoObject.findMany({
      where: { objectType: DEMO_OBJECT_ORG_UNIT },
      select: { objectId: true, origin: true },
      orderBy: { objectId: "asc" },
    });
    const ikinci = await installDemoData(testDb);
    expect(ikinci.ok).toBe(true);
    const sonra = await testDb.demoObject.findMany({
      where: { objectType: DEMO_OBJECT_ORG_UNIT },
      select: { objectId: true, origin: true },
      orderBy: { objectId: "asc" },
    });

    expect(sonra).toEqual(once);
    expect(sonra.every((kayit) => kayit.origin === DEMO_ORIGIN_CREATED)).toBe(
      true,
    );
  });

  it("kökeni belirsiz eski kurulumda hiçbir şeyi silmez", async () => {
    const { yonetici } = await kur();
    await testDb.demoObject.deleteMany();
    const once = await sayilar();

    const adaylar = await listLegacyDemoOriginCandidates(testDb);
    const sonuc = await purgeDemoData(testDb, yonetici.id, new Date());

    expect(adaylar).toHaveLength(DEMO_UNIT_NAMES.length);
    expect(sonuc).toEqual({
      ok: false,
      error: "legacy_demo_origin_unknown",
      candidates: adaylar,
    });
    expect(await sayilar()).toEqual(once);
    expect(await testDb.demoObject.count()).toBe(0);
  });

  it("bütün eski birimler açıkça sınıflandırılınca tek seferde temizlenir", async () => {
    const { yonetici } = await kur();
    await testDb.demoObject.deleteMany();
    const adaylar = await listLegacyDemoOriginCandidates(testDb);

    const siniflandirma = await classifyLegacyDemoOrgUnits(
      testDb,
      yonetici.id,
      adaylar.map((aday) => ({
        orgUnitId: aday.id,
        origin: DEMO_ORIGIN_CREATED,
      })),
      new Date("2026-08-24T00:00:00.000Z"),
    );
    expect(siniflandirma).toEqual({
      ok: true,
      classified: DEMO_UNIT_NAMES.length,
    });

    const temizlik = await purgeDemoData(testDb, yonetici.id, new Date());
    expect(temizlik.ok).toBe(true);
    expect(await sayilar()).toEqual({ users: 0, activities: 0, units: 0 });
    expect(await testDb.demoObject.count()).toBe(0);
    expect(
      await testDb.auditLog.count({
        where: { action: AUDIT_ACTIONS.demoOriginClassified },
      }),
    ).toBe(1);
  });

  it("sahipli birimlerden biri silinemiyorsa önceki silmeleri de geri alır", async () => {
    const { yonetici } = await kur();
    const planlama = await testDb.orgUnit.findFirstOrThrow({
      where: { name: "Production Planning" },
      select: { id: true },
    });
    // Demo kurulumuna ait Planlama'nın altında gerçek bir birim doğmuş. Bu
    // bağlantı Planlama'yı silinemez yapar; diğer demo yaprakları daha önce
    // silinmiş olsa bile işlem bütünüyle geri dönmeli (§22.3).
    await createOrgUnit({ name: "Gerçek Alt Birim", parentId: planlama.id });
    const once = await sayilar();

    const sonuc = await purgeDemoData(testDb, yonetici.id, new Date());

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok || sonuc.error !== "blocked") {
      throw new Error("temizlik gerçek alt birimde engellenmeliydi");
    }
    expect(sonuc.detail).toContain("Production Planning");
    expect(await sayilar()).toEqual(once);
    expect(await testDb.demoObject.count()).toBe(DEMO_UNIT_NAMES.length);
  });

  it("eksik veya fazladan sınıflandırmayı atomik olarak reddeder", async () => {
    const { kok, yonetici } = await kur();
    await testDb.demoObject.deleteMany();
    const adaylar = await listLegacyDemoOriginCandidates(testDb);

    const eksik = await classifyLegacyDemoOrgUnits(
      testDb,
      yonetici.id,
      adaylar.slice(1).map((aday) => ({
        orgUnitId: aday.id,
        origin: DEMO_ORIGIN_CREATED,
      })),
    );
    expect(eksik).toEqual({ ok: false, error: "candidate_set_changed" });
    expect(await testDb.demoObject.count()).toBe(0);

    const fazla = await classifyLegacyDemoOrgUnits(testDb, yonetici.id, [
      ...adaylar.map((aday) => ({
        orgUnitId: aday.id,
        origin: DEMO_ORIGIN_CREATED,
      })),
      { orgUnitId: kok.id, origin: DEMO_ORIGIN_CREATED },
    ]);
    expect(fazla).toEqual({ ok: false, error: "candidate_set_changed" });
    expect(await testDb.demoObject.count()).toBe(0);
  });

  it("eski kurulumda gerçek birim açıkça yeniden kullanıldı diye işaretlenebilir", async () => {
    const { yonetici, planlama } = await kur(true);
    await testDb.demoObject.deleteMany();
    const adaylar = await listLegacyDemoOriginCandidates(testDb);

    const siniflandirma = await classifyLegacyDemoOrgUnits(
      testDb,
      yonetici.id,
      adaylar.map((aday) => ({
        orgUnitId: aday.id,
        origin:
          aday.id === planlama!.id ? DEMO_ORIGIN_REUSED : DEMO_ORIGIN_CREATED,
      })),
    );
    expect(siniflandirma.ok).toBe(true);

    const temizlik = await purgeDemoData(testDb, yonetici.id, new Date());
    expect(temizlik.ok).toBe(true);
    expect(
      await testDb.orgUnit.count({ where: { id: planlama!.id } }),
    ).toBe(1);
    expect(
      await testDb.user.count({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } }),
    ).toBe(0);
    expect(await testDb.demoObject.count()).toBe(0);
  });
});
