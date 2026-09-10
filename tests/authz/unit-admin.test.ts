import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  canManageUser,
  manageableUnitIds,
} from "@/server/authz/unit-admin";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Bölüm müdürünün işlevsel yetkisi (Görev 11.7).
//
// Yetki **kendi alt ağacıyla** sınırlıdır ve §15.1'deki ayrımı korur: işlevsel
// yetki içerik erişimi vermez. Müdür zaten kendi ekibinin faaliyetlerini
// görüyor; bu yetki yalnız kullanıcı kaydı üzerinde işlem açıyor.
//
// Sınanan asıl şey **sınırın kendisi**: müdür kendi ağacının dışına çıkamaz
// ve kimseye yetki dağıtamaz.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const uretim = await createOrgUnit({ name: "Üretim", parentId: kok.id });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: uretim.id });
  const boyahane = await createOrgUnit({ name: "Boyahane", parentId: uretim.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const gm = await createUser(kok.id, { fullName: "Genel Müdür", isUnitManager: true });
  const uretimMudur = await createUser(uretim.id, {
    fullName: "Üretim Müdürü",
    isUnitManager: true,
  });
  const kaliphaneMudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(kaliphane.id, { fullName: "Kadir Usta" });
  const boyaci = await createUser(boyahane.id, { fullName: "Boyacı" });
  const planlamaci = await createUser(planlama.id, { fullName: "Planlamacı" });
  const admin = await createUser(kok.id, {
    fullName: "Sistem Yöneticisi",
    isSystemAdmin: true,
  });

  return {
    birimler: { kok, uretim, kaliphane, boyahane, planlama },
    gm,
    uretimMudur,
    kaliphaneMudur,
    kadir,
    boyaci,
    planlamaci,
    admin,
  };
}

describe("yönetilebilir birimler", () => {
  it("müdür kendi birimini ve altını yönetir", async () => {
    const { birimler, uretimMudur } = await sirket();

    const idler = await manageableUnitIds(testDb, uretimMudur.id);

    expect(new Set(idler)).toEqual(
      new Set([birimler.uretim.id, birimler.kaliphane.id, birimler.boyahane.id]),
    );
  });

  it("kardeş birim listede yok", async () => {
    const { birimler, uretimMudur } = await sirket();

    const idler = await manageableUnitIds(testDb, uretimMudur.id);

    expect(idler).not.toContain(birimler.planlama.id);
  });

  it("üst birim listede yok", async () => {
    const { birimler, kaliphaneMudur } = await sirket();

    const idler = await manageableUnitIds(testDb, kaliphaneMudur.id);

    expect(idler).toEqual([birimler.kaliphane.id]);
  });

  it("yönetici olmayan kullanıcının listesi boş", async () => {
    const { kadir } = await sirket();

    expect(await manageableUnitIds(testDb, kadir.id)).toEqual([]);
  });

  it("sistem yöneticisi bütün aktif birimleri yönetir", async () => {
    const { birimler, admin } = await sirket();

    const idler = await manageableUnitIds(testDb, admin.id);

    expect(new Set(idler)).toEqual(new Set(Object.values(birimler).map((b) => b.id)));
  });
});

describe("kullanıcı yönetme yetkisi", () => {
  it("müdür kendi ağacındaki çalışanı yönetir", async () => {
    const { uretimMudur, kadir } = await sirket();

    expect(await canManageUser(testDb, uretimMudur.id, kadir.id)).toBe(true);
  });

  it("müdür kardeş ağaçtaki kişiyi yönetemez", async () => {
    const { uretimMudur, planlamaci } = await sirket();

    expect(await canManageUser(testDb, uretimMudur.id, planlamaci.id)).toBe(false);
  });

  it("müdür üstündeki kişiyi yönetemez", async () => {
    const { kaliphaneMudur, gm } = await sirket();

    expect(await canManageUser(testDb, kaliphaneMudur.id, gm.id)).toBe(false);
  });

  // Kendi hesabını yönetim ekranından değiştirmek, kendi yetkisini kaldırma
  // ya da kendini kilitleme yollarını açardı; profil ekranı bunun için var.
  it("müdür kendi hesabını bu yoldan yönetemez", async () => {
    const { uretimMudur } = await sirket();

    expect(await canManageUser(testDb, uretimMudur.id, uretimMudur.id)).toBe(false);
  });

  it("yönetici olmayan kimseyi yönetemez", async () => {
    const { kadir, boyaci } = await sirket();

    expect(await canManageUser(testDb, kadir.id, boyaci.id)).toBe(false);
  });

  it("sistem yöneticisi herkesi yönetir", async () => {
    const { admin, planlamaci } = await sirket();

    expect(await canManageUser(testDb, admin.id, planlamaci.id)).toBe(true);
  });

  it("root hesabı diğer sistem yöneticilerine bile kapalıdır", async () => {
    const { birimler, admin } = await sirket();
    const root = await createUser(birimler.kok.id, {
      fullName: "Ana Hesap",
      email: "root@ornek.test",
      isSystemAdmin: true,
      isRoot: true,
    });

    expect(await canManageUser(testDb, admin.id, root.id)).toBe(false);
    expect(await canManageUser(testDb, root.id, admin.id)).toBe(true);
  });

  // Ağaçta alt kademede olsa bile sistem yöneticisi hesabına dokunulmamalı:
  // işlevsel yetkiyi bir bölüm müdürünün eline bırakmak, yetki modelinin
  // tamamını atlatmanın kısa yolu olurdu.
  it("müdür kendi ağacındaki sistem yöneticisini yönetemez", async () => {
    const { birimler, uretimMudur } = await sirket();
    const altAdmin = await createUser(birimler.kaliphane.id, {
      fullName: "Ağaçtaki Yönetici",
      isSystemAdmin: true,
    });

    expect(await canManageUser(testDb, uretimMudur.id, altAdmin.id)).toBe(false);
  });
});
