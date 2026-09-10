import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity, rejectActivity } from "@/server/activities/approval";
import { listApprovalGroups } from "@/server/activities/approval-groups";
import { listPendingApprovals } from "@/server/activities/approval";
import { createActivity } from "@/server/activities/write";
import { visibleActivityWhere } from "@/server/authz/visibility";
import { resolveManagers } from "@/server/org/resolve-manager";
import { listScopeActivities } from "@/server/activities/scope-feed";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Bir birimde **birden fazla müdür** (ürün sahibi kararı, 20.08.2026).
//
// Kural: kayıt her müdürün onay kuyruğunda görünür; **ilk karar veren
// süreci kapatır** ve kayıt diğerinin kuyruğundan düşer.
//
// Bu dosya o kuralın dört tarafını da sınar:
//   1. Uygun onaylayıcılar kayda yazılıyor mu (iki kişi).
//   2. İkisi de görüyor mu — ve **üçüncü kişi görmüyor mu**.
//   3. Biri karar verince diğerinin kuyruğu boşalıyor mu.
//   4. İkinci müdürün geç kalan kararı sessizce geçmiyor mu.

const NOW = new Date("2026-08-20T09:00:00.000Z");

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket" });
  const kaliphane = await createOrgUnit({
    name: "Kalıphane",
    parentId: kok.id,
    requiresApproval: true,
  });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const genelMudur = await createUser(kok.id, {
    fullName: "Genel Müdür",
    email: "gm@ornek.test",
    isUnitManager: true,
  });
  // Aynı birimin **iki** müdürü.
  const mudurA = await createUser(kaliphane.id, {
    fullName: "Müdür A",
    email: "mudur-a@ornek.test",
    isUnitManager: true,
  });
  const mudurB = await createUser(kaliphane.id, {
    fullName: "Müdür B",
    email: "mudur-b@ornek.test",
    isUnitManager: true,
  });
  const calisan = await createUser(kaliphane.id, {
    fullName: "Çalışan",
    email: "calisan@ornek.test",
  });
  // Başka departmandan biri: hiçbir koşulda görmemeli.
  const yabanci = await createUser(planlama.id, {
    fullName: "Planlamacı",
    email: "yabanci@ornek.test",
  });

  return { kok, kaliphane, genelMudur, mudurA, mudurB, calisan, yabanci };
}

async function kayitYaz(calisan: { id: string; orgUnitId: string }) {
  const sonuc = await createActivity(
    testDb,
    { id: calisan.id, orgUnitId: calisan.orgUnitId, requiresApproval: true },
    {
      activityDate: "2026-08-20",
      title: "Kalıp bakımı",
      description: "Üç preste bakım yapıldı.",
      targetDepartmentIds: [],
    },
    NOW,
  );

  if (!sonuc.ok) throw new Error(`kayıt yazılamadı: ${sonuc.error}`);
  return sonuc.activity;
}

const viewer = (u: { id: string }) => ({ id: u.id, isSystemAdmin: false });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("bir birimde iki müdür", () => {
  it("çalışanın iki yöneticisi de çözülür", async () => {
    const { mudurA, mudurB, calisan } = await sirket();

    const sonuc = await resolveManagers(testDb, calisan.id);

    expect(sonuc.found).toBe(true);
    if (!sonuc.found) return;
    expect([...sonuc.managerIds].sort()).toEqual([mudurA.id, mudurB.id].sort());
  });

  it("müdürler birbirinin yöneticisi değildir — ikisinin de üstü genel müdürdür", async () => {
    const { genelMudur, mudurA, mudurB } = await sirket();

    for (const mudur of [mudurA, mudurB]) {
      const sonuc = await resolveManagers(testDb, mudur.id);
      expect(sonuc.found).toBe(true);
      if (!sonuc.found) continue;
      expect(sonuc.managerIds).toEqual([genelMudur.id]);
    }
  });

  it("kayıt yazılınca iki müdür de uygun onaylayıcı olarak yazılır", async () => {
    const { mudurA, mudurB, calisan } = await sirket();
    const kayit = await kayitYaz(calisan);

    expect(kayit.approvalStatus).toBe("PENDING_APPROVAL");

    const uygunlar = await testDb.activityApprover.findMany({
      where: { activityId: kayit.id },
      select: { userId: true },
    });
    expect(uygunlar.map((u) => u.userId).sort()).toEqual(
      [mudurA.id, mudurB.id].sort(),
    );
  });

  it("kayıt her iki müdürün de onay kuyruğunda görünür", async () => {
    const { mudurA, mudurB, calisan } = await sirket();
    const kayit = await kayitYaz(calisan);

    for (const mudur of [mudurA, mudurB]) {
      const kuyruk = await listPendingApprovals(testDb, mudur.id);
      expect(kuyruk.map((k) => k.id)).toContain(kayit.id);

      // Kayıt ve iş kuralı 20 Ağustos sahte saatinde kuruluyor. Varsayılan
      // “bu hafta” gerçek saate bırakılırsa test sonraki pazartesi boşalır.
      const gruplar = await listApprovalGroups(testDb, mudur.id, NOW);
      expect(gruplar.flatMap((g) => g.items.map((i) => i.id))).toContain(kayit.id);
    }
  });

  it("iki müdür de kaydı görür; başka departmandaki kişi görmez", async () => {
    const { mudurA, mudurB, calisan, yabanci } = await sirket();
    const kayit = await kayitYaz(calisan);

    for (const mudur of [mudurA, mudurB]) {
      const where = await visibleActivityWhere(testDb, viewer(mudur));
      const ids = (await testDb.activity.findMany({ where })).map((a) => a.id);
      expect(ids).toContain(kayit.id);
    }

    const yabanciWhere = await visibleActivityWhere(testDb, viewer(yabanci));
    const yabanciIds = (await testDb.activity.findMany({ where: yabanciWhere })).map(
      (a) => a.id,
    );
    expect(yabanciIds).not.toContain(kayit.id);

    // Akış da aynı sonucu vermeli: kapsam tek modülden besleniyor.
    const { items } = await listScopeActivities(testDb, viewer(yabanci), {}, NOW);
    expect(items.map((i) => i.id)).not.toContain(kayit.id);
  });

  it("onay bekleyen kayıt üst kademeye akmaz — iki müdürlü birimde de", async () => {
    const { genelMudur, calisan } = await sirket();
    const kayit = await kayitYaz(calisan);

    const where = await visibleActivityWhere(testDb, viewer(genelMudur));
    const ids = (await testDb.activity.findMany({ where })).map((a) => a.id);

    // Genel müdür zincirdedir ama onaylayıcı değildir: süzülmemiş içerik
    // yukarı akmaz.
    expect(ids).not.toContain(kayit.id);
  });

  it("biri onaylayınca kayıt diğerinin kuyruğundan düşer", async () => {
    const { mudurA, mudurB, calisan } = await sirket();
    const kayit = await kayitYaz(calisan);

    const sonuc = await approveActivity(testDb, mudurA.id, kayit.id, NOW);
    expect(sonuc.ok).toBe(true);

    expect(await listPendingApprovals(testDb, mudurA.id)).toHaveLength(0);
    expect(await listPendingApprovals(testDb, mudurB.id)).toHaveLength(0);

    // "Kim onayladı" sorusunun cevabı kararı veren kişidir.
    const guncel = await testDb.activity.findUniqueOrThrow({
      where: { id: kayit.id },
    });
    expect(guncel.approvalStatus).toBe("APPROVED");
    expect(guncel.approverId).toBe(mudurA.id);
  });

  it("ikinci müdürün geç kalan kararı sessizce geçmez", async () => {
    const { mudurA, mudurB, calisan } = await sirket();
    const kayit = await kayitYaz(calisan);

    const ilk = await approveActivity(testDb, mudurA.id, kayit.id, NOW);
    expect(ilk.ok).toBe(true);

    const gerekce = await testDb.approvalReason.create({
      data: { kind: "REJECTED", label: "Mükerrer kayıt" },
    });

    // B kaydı reddetmeye çalışıyor ama süreç kapandı. Sessizce geçerse
    // onaylanmış bir kayıt geriye dönerdi.
    const gec = await rejectActivity(
      testDb,
      mudurB.id,
      kayit.id,
      { reasonId: gerekce.id, note: "Geç kalan karar" },
      NOW,
    );

    expect(gec.ok).toBe(false);

    const guncel = await testDb.activity.findUniqueOrThrow({
      where: { id: kayit.id },
    });
    expect(guncel.approvalStatus).toBe("APPROVED");
    expect(guncel.approverId).toBe(mudurA.id);
  });

  it("uygun onaylayıcı olmayan kişi karar veremez", async () => {
    const { genelMudur, calisan } = await sirket();
    const kayit = await kayitYaz(calisan);

    // Genel müdür zincirdedir ama bu kaydın onaylayıcısı değildir.
    const sonuc = await approveActivity(testDb, genelMudur.id, kayit.id, NOW);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("not_found");

    const guncel = await testDb.activity.findUniqueOrThrow({
      where: { id: kayit.id },
    });
    expect(guncel.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("her iki müdüre de bildirim gider", async () => {
    const { mudurA, mudurB, calisan } = await sirket();
    const kayit = await kayitYaz(calisan);

    for (const mudur of [mudurA, mudurB]) {
      const satirlar = await testDb.notificationQueue.findMany({
        where: { userId: mudur.id, eventType: "approval_pending" },
      });
      expect(satirlar).toHaveLength(1);
      expect(satirlar[0].payload).toMatchObject({ activityId: kayit.id });
    }
  });
});
