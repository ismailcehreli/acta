import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listProfileActivities, loadProfile } from "@/server/users/profile";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Profil sayfası bir **okuma yoludur**; §18.4 gereği yetkisiz erişimin
// engellendiğini kanıtlamadan bitmiş sayılmaz.
//
// Profil arşivi de v4 §8.2 görünürlük matrisine uyar: üst zincir yalnız
// onaylanmış ve iptal kayıtlarını görür. Süreçteki kaydın varlığı, başlığı ve
// sayısı profile sızmaz.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Şirket: Kök → Üretim (müdür Mert) → Kalıphane (usta Kadir). */
async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const uretim = await createOrgUnit({ name: "Üretim", parentId: kok.id });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: uretim.id });

  const genelMudur = await createUser(kok.id, {
    fullName: "Gökhan Genel",
    email: "gm@ornek.test",
    isUnitManager: true,
  });
  const mudur = await createUser(uretim.id, {
    fullName: "Mert Müdür",
    email: "mert@ornek.test",
    isUnitManager: true,
  });
  const ekipCalisani = await createUser(uretim.id, {
    fullName: "Üretim Çalışanı",
    email: "ekip@ornek.test",
  });
  const usta = await createUser(kaliphane.id, {
    fullName: "Kadir Usta",
    email: "kadir@ornek.test",
  });
  const yabanci = await createUser(kok.id, {
    fullName: "Yasin Yabancı",
    email: "yasin@ornek.test",
  });

  return { kok, uretim, kaliphane, genelMudur, mudur, ekipCalisani, usta, yabanci };
}

const bakan = (
  id: string,
  isSystemAdmin = false,
  extra: { orgUnitId?: string; isUnitManager?: boolean } = {},
) => ({ id, isSystemAdmin, ...extra });

describe("profili kim açabilir", () => {
  it("kişi kendi profilini görür", async () => {
    const { usta } = await sirket();

    const sonuc = await loadProfile(testDb, bakan(usta.id), usta.id, NOW);

    expect(sonuc.access).toBe("full");
    if (sonuc.access !== "full") return;
    expect(sonuc.person.fullName).toBe("Kadir Usta");
    expect(sonuc.person.orgUnitName).toBe("Kalıphane");
  });

  it("yönetici astının profilini görür", async () => {
    const { mudur, usta } = await sirket();

    const sonuc = await loadProfile(testDb, bakan(mudur.id), usta.id, NOW);

    expect(sonuc.access).toBe("full");
  });

  it("ast, yöneticisinin profilini göremez", async () => {
    const { mudur, usta } = await sirket();

    const sonuc = await loadProfile(testDb, bakan(usta.id), mudur.id, NOW);

    // Yukarı doğru bakış yok. "Var ama göremezsin" demek yerine kayıt yokmuş
    // gibi davranılır.
    expect(sonuc.access).toBe("none");
  });

  it("kapsam dışındaki eş kademe göremez", async () => {
    const { usta, yabanci } = await sirket();

    const sonuc = await loadProfile(testDb, bakan(yabanci.id), usta.id, NOW);

    expect(sonuc.access).toBe("none");
  });

  it("sistem yöneticisi üst veriyi görür, arşivi görmez", async () => {
    const { usta, yabanci } = await sirket();

    const sonuc = await loadProfile(testDb, bakan(yabanci.id, true), usta.id, NOW);

    // §15.1: işlevsel yetki içerik erişimi vermez. Kullanıcıyı yönetebilmesi
    // için kim olduğunu görmesi yeter; ne yazdığını görmesi gerekmez.
    expect(sonuc.access).toBe("metadata");
    if (sonuc.access !== "metadata") return;
    expect(sonuc.person.fullName).toBe("Kadir Usta");
    expect(sonuc).not.toHaveProperty("stats");
  });

  it("olmayan kişi için erişim yok", async () => {
    const { mudur } = await sirket();

    const sonuc = await loadProfile(
      testDb,
      bakan(mudur.id),
      "11111111-1111-4111-8111-111111111111",
      NOW,
    );

    expect(sonuc.access).toBe("none");
  });
});

describe("son başarılı giriş", () => {
  it("kişi kendi son başarılı girişini görür", async () => {
    const { usta } = await sirket();
    const sonGiris = new Date("2026-08-18T07:30:00.000Z");
    await testDb.user.update({ where: { id: usta.id }, data: { lastLoginAt: sonGiris } });

    const sonuc = await loadProfile(testDb, bakan(usta.id), usta.id, NOW);

    expect(sonuc.access).toBe("full");
    if (sonuc.access !== "full") return;
    expect(sonuc.person.lastLoginVisible).toBe(true);
    expect(sonuc.person.lastLoginAt).toEqual(sonGiris);
  });

  it("yönetici aynı departmandaki çalışanın son girişini görür", async () => {
    const { mudur, ekipCalisani } = await sirket();
    const sonGiris = new Date("2026-08-18T08:15:00.000Z");
    await testDb.user.update({
      where: { id: ekipCalisani.id },
      data: { lastLoginAt: sonGiris },
    });

    const sonuc = await loadProfile(
      testDb,
      bakan(mudur.id, false, { orgUnitId: mudur.orgUnitId, isUnitManager: true }),
      ekipCalisani.id,
      NOW,
    );

    expect(sonuc.access).toBe("full");
    if (sonuc.access !== "full") return;
    expect(sonuc.person.lastLoginVisible).toBe(true);
    expect(sonuc.person.lastLoginAt).toEqual(sonGiris);
  });

  it("yönetici alt departmandaki kişinin son girişini göremez", async () => {
    const { mudur, usta } = await sirket();
    const sonGiris = new Date("2026-08-18T08:45:00.000Z");
    await testDb.user.update({ where: { id: usta.id }, data: { lastLoginAt: sonGiris } });

    const sonuc = await loadProfile(
      testDb,
      bakan(mudur.id, false, { orgUnitId: mudur.orgUnitId, isUnitManager: true }),
      usta.id,
      NOW,
    );

    expect(sonuc.access).toBe("full");
    if (sonuc.access !== "full") return;
    expect(sonuc.person.lastLoginVisible).toBe(false);
    expect(sonuc.person.lastLoginAt).toBeNull();
  });

  it("sistem yöneticisi son giriş bilgisini görür", async () => {
    const { yabanci, usta } = await sirket();
    const sonGiris = new Date("2026-08-18T09:00:00.000Z");
    await testDb.user.update({ where: { id: usta.id }, data: { lastLoginAt: sonGiris } });

    const sonuc = await loadProfile(testDb, bakan(yabanci.id, true), usta.id, NOW);

    expect(sonuc.access).toBe("metadata");
    if (sonuc.access !== "metadata") return;
    expect(sonuc.person.lastLoginVisible).toBe(true);
    expect(sonuc.person.lastLoginAt).toEqual(sonGiris);
  });
});

describe("istatistikler bakanın kapsamıyla sınırlıdır", () => {
  it("onay sürecindeki kayıt, onaylayıcı olmayan üst kademenin sayısına girmez", async () => {
    const { genelMudur, mudur, usta } = await sirket();

    await createActivity(usta, {
      title: "Onaylanmış iş",
      approvalStatus: "APPROVED",
      approverId: mudur.id,
    });
    await createActivity(usta, {
      title: "Onay bekleyen iş",
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });

    const mudurGoruyor = await loadProfile(testDb, bakan(mudur.id), usta.id, NOW);
    const gmGoruyor = await loadProfile(testDb, bakan(genelMudur.id), usta.id, NOW);

    expect(mudurGoruyor.access).toBe("full");
    if (mudurGoruyor.access !== "full") return;
    expect(mudurGoruyor.stats.total).toBe(2);
    expect(mudurGoruyor.stats.pending).toBe(1);

    expect(gmGoruyor.access).toBe("full");
    if (gmGoruyor.access !== "full") return;
    // Üst zincir süreçteki kaydı ve ondan türeyen sayıyı görmez (§8.2).
    expect(gmGoruyor.stats.total).toBe(1);
    expect(gmGoruyor.stats.pending).toBe(0);
  });

  it("iptal edilen kayıt kişinin kendi sayacında da görünür", async () => {
    const { usta, mudur } = await sirket();
    await createActivity(usta, { approvalStatus: "APPROVED", approverId: mudur.id });
    await createActivity(usta, { approvalStatus: "CANCELLED", approverId: mudur.id });

    const sonuc = await loadProfile(testDb, bakan(usta.id), usta.id, NOW);

    expect(sonuc.access).toBe("full");
    if (sonuc.access !== "full") return;
    // İptal silme değildir (§16.6); kişi kendi geçmişinde onu da görür.
    expect(sonuc.stats.total).toBe(2);
  });

  it("bu ay sayacı yalnız içinde bulunulan ayı sayar", async () => {
    const { usta, mudur } = await sirket();
    await createActivity(usta, {
      activityDate: new Date("2026-08-03T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: mudur.id,
    });
    await createActivity(usta, {
      activityDate: new Date("2026-07-28T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: mudur.id,
    });

    const sonuc = await loadProfile(testDb, bakan(usta.id), usta.id, NOW);

    expect(sonuc.access).toBe("full");
    if (sonuc.access !== "full") return;
    expect(sonuc.stats.total).toBe(2);
    expect(sonuc.stats.thisMonth).toBe(1);
    expect(sonuc.stats.lastActivityDate?.toISOString()).toContain("2026-08-03");
  });

  it("hiç faaliyeti olmayan kişinin son tarihi boştur", async () => {
    const { usta } = await sirket();

    const sonuc = await loadProfile(testDb, bakan(usta.id), usta.id, NOW);

    expect(sonuc.access).toBe("full");
    if (sonuc.access !== "full") return;
    expect(sonuc.stats.total).toBe(0);
    expect(sonuc.stats.lastActivityDate).toBeNull();
  });
});

describe("arşiv listesi", () => {
  it("bakanın göremeyeceği kayıt listede yer almaz", async () => {
    const { genelMudur, mudur, usta } = await sirket();
    await createActivity(usta, {
      title: "Herkesin gördüğü",
      approvalStatus: "APPROVED",
      approverId: mudur.id,
    });
    await createActivity(usta, {
      title: "Süzülmemiş taslak",
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });

    const gmListesi = await listProfileActivities(testDb, bakan(genelMudur.id), usta.id);

    expect(gmListesi.map((k) => k.title)).toEqual(["Herkesin gördüğü"]);
  });

  it("kişi kendi süzülmemiş kaydını profilinde görür", async () => {
    const { usta, mudur } = await sirket();
    await createActivity(usta, {
      title: "Kendi taslağım",
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });

    const liste = await listProfileActivities(testDb, bakan(usta.id), usta.id);

    expect(liste.map((k) => k.title)).toEqual(["Kendi taslağım"]);
  });

  it("aktif onaylayıcı süzülmemiş kaydı görür", async () => {
    const { usta, mudur } = await sirket();
    await createActivity(usta, {
      title: "Onayımda bekleyen",
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });

    const liste = await listProfileActivities(testDb, bakan(mudur.id), usta.id);

    expect(liste.map((k) => k.title)).toEqual(["Onayımda bekleyen"]);
  });

  it("reddedilen kayıt üst kademeye hiç sızmaz", async () => {
    const { usta, mudur, genelMudur } = await sirket();
    const gerekce = await createApprovalReason("REJECTED");
    await createActivity(usta, {
      title: "Reddedilen iş",
      approvalStatus: "REJECTED",
      approverId: mudur.id,
      approvalReasonId: gerekce.id,
      approvalReasonKind: "REJECTED",
    });

    const liste = await listProfileActivities(testDb, bakan(genelMudur.id), usta.id);

    expect(liste).toEqual([]);
  });

  it("kişinin kendi listesi yeniden eskiye sıralıdır", async () => {
    const { usta, mudur } = await sirket();
    await createActivity(usta, {
      title: "Önce",
      activityDate: new Date("2026-08-10T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: mudur.id,
    });
    await createActivity(usta, {
      title: "Sonra",
      activityDate: new Date("2026-08-18T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: mudur.id,
    });

    const liste = await listProfileActivities(testDb, bakan(usta.id), usta.id);

    expect(liste.map((k) => k.title)).toEqual(["Sonra", "Önce"]);
    expect(liste[0]?.activityNo).toBeGreaterThan(0);
  });

  it("kapsam dışındaki kişi hiçbirini açamaz", async () => {
    const { usta, yabanci, mudur } = await sirket();
    await createActivity(usta, { approvalStatus: "APPROVED", approverId: mudur.id });

    // Bu kişi profili zaten açamıyor (`loadProfile` → "none"); liste de
    // kaydın varlığını sızdırmamalı.
    const liste = await listProfileActivities(testDb, bakan(yabanci.id), usta.id);

    expect(liste).toEqual([]);
  });
});
