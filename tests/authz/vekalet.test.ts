import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity, listPendingApprovals } from "@/server/activities/approval";
import { listApprovalGroups } from "@/server/activities/approval-groups";
import { createActivity } from "@/server/activities/write";
import {
  cancelNoActivityPeriod,
  markNoActivityPeriod,
} from "@/server/absence/service";
import { activeDeputyFor } from "@/server/authz/deputy";
import { canViewActivity, visibleActivityWhere } from "@/server/authz/visibility";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// VEKÂLET (§4.5, ürün sahibi kararı 21.08.2026).
//
// İki yüzü var ve ikisi ayrı kurallarla işliyor:
//
//   1. **Süre içinde** — vekil, vekâlet ettiği birimin **o döneme ait**
//      kayıtlarını görür ve o kişinin onayına düşmüş işleri karara bağlar.
//   2. **Süre bittikten sonra** — aynı dönemin kayıtlarını görmeye devam
//      eder; aylar sonra o döneme dair soru gelirse cevap verebilmeli.
//
// Bu dosyanın asıl sınadığı şey **pencerenin taşmaması**: vekil, vekâlet
// ettiği birimin daha eski kayıtlarını hiçbir zaman görmemeli. Bir haftalık
// izin, yılların arşivine kapı açmamalı.

const IZIN_ICI = new Date("2026-08-22T09:00:00.000Z");
const IZIN_SONRASI = new Date("2026-09-15T09:00:00.000Z");
/** Vekâletten aylar önce yazılmış bir kayıt: pencerenin dışında kalmalı. */
const ESKI_KAYIT = new Date("2026-01-15T09:00:00.000Z");

const viewer = (u: { id: string }) => ({ id: u.id, isSystemAdmin: false });

/**
 * Şirket:
 *   Acta HQ (kök)
 *     ├─ genelMudur (kök yöneticisi)
 *     └─ Kalıphane (onaya tabi)
 *         ├─ kalipMudur (yönetici — izne çıkacak)
 *         └─ kalipci    (çalışan)
 *     └─ Planlama
 *         └─ planMudur  (yönetici — vekil olacak)
 */
async function sirket() {
  const kok = await createOrgUnit({ name: "Acta HQ" });
  const kaliphane = await createOrgUnit({
    name: "Kalıphane",
    parentId: kok.id,
    requiresApproval: true,
  });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const genelMudur = await createUser(kok.id, {
    email: "gm@ornek.test",
    isUnitManager: true,
  });
  const kalipMudur = await createUser(kaliphane.id, {
    email: "kalip-mudur@ornek.test",
    isUnitManager: true,
  });
  const kalipci = await createUser(kaliphane.id, { email: "kalipci@ornek.test" });
  const planMudur = await createUser(planlama.id, {
    email: "plan-mudur@ornek.test",
    isUnitManager: true,
  });

  return { genelMudur, kalipMudur, kalipci, planMudur };
}

/** Genel müdür, kalıphane müdürü için izin girer ve planlama müdürünü vekil yapar. */
async function vekaletKur(kisiler: Awaited<ReturnType<typeof sirket>>) {
  const sonuc = await markNoActivityPeriod(
    testDb,
    kisiler.genelMudur.id,
    {
      userId: kisiler.kalipMudur.id,
      startDate: "2026-08-20",
      endDate: "2026-08-27",
      deputyId: kisiler.planMudur.id,
    },
    IZIN_ICI,
  );

  if (!sonuc.ok) throw new Error(`vekâlet kurulamadı: ${sonuc.message}`);
  return sonuc;
}

async function kayitYaz(yazar: { id: string; orgUnitId: string }, now: Date) {
  const sonuc = await createActivity(
    testDb,
    { id: yazar.id, orgUnitId: yazar.orgUnitId, requiresApproval: true },
    {
      activityDate: now.toISOString().slice(0, 10),
      title: "Kalıp bakımı",
      description: "Üç preste bakım yapıldı.",
      targetDepartmentIds: [],
    },
    now,
  );

  if (!sonuc.ok) throw new Error(`kayıt yazılamadı: ${sonuc.error}`);
  return sonuc.activity;
}

async function listede(bakan: { id: string }, activityId: string, now: Date) {
  const where = await visibleActivityWhere(testDb, viewer(bakan), undefined, now);
  const satirlar = await testDb.activity.findMany({ where, select: { id: true } });
  return satirlar.some((satir) => satir.id === activityId);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("vekil kimler olabilir", () => {
  it("yönetici olmayan kişi için vekil tanımlanamaz", async () => {
    const kisiler = await sirket();

    const sonuc = await markNoActivityPeriod(
      testDb,
      kisiler.kalipMudur.id,
      {
        userId: kisiler.kalipci.id,
        startDate: "2026-08-20",
        endDate: "2026-08-27",
        deputyId: kisiler.kalipMudur.id,
      },
      IZIN_ICI,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("absent_not_manager");
  });

  it("vekilin kendisi de yönetici olmalı", async () => {
    const kisiler = await sirket();

    const sonuc = await markNoActivityPeriod(
      testDb,
      kisiler.genelMudur.id,
      {
        userId: kisiler.kalipMudur.id,
        startDate: "2026-08-20",
        endDate: "2026-08-27",
        deputyId: kisiler.kalipci.id,
      },
      IZIN_ICI,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("deputy_not_manager");
  });

  it("vekilsiz izin kaydı yönetici olmayan için de girilebilir", async () => {
    const kisiler = await sirket();

    const sonuc = await markNoActivityPeriod(
      testDb,
      kisiler.kalipMudur.id,
      {
        userId: kisiler.kalipci.id,
        startDate: "2026-08-20",
        endDate: "2026-08-27",
      },
      IZIN_ICI,
    );

    expect(sonuc.ok).toBe(true);
  });
});

describe("vekâlet süresince", () => {
  it("vekil, vekâlet ettiği birimin kaydını görür ve onaylayabilir", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI);
    expect(kayit.approvalStatus).toBe("PENDING_APPROVAL");

    // Normalde planlama müdürü kalıphaneyi hiç görmez.
    expect(await listede(kisiler.planMudur, kayit.id, IZIN_ICI)).toBe(true);
    expect(
      await canViewActivity(
        testDb,
        viewer(kisiler.planMudur),
        { id: kayit.id, authorId: kayit.authorId, approvalStatus: kayit.approvalStatus },
        undefined,
        IZIN_ICI,
      ),
    ).toBe("full");

    // Onay kuyruğunda da görünmeli.
    const kuyruk = await listPendingApprovals(testDb, kisiler.planMudur.id, IZIN_ICI);
    expect(kuyruk.map((k) => k.id)).toContain(kayit.id);

    const karar = await approveActivity(
      testDb,
      kisiler.planMudur.id,
      kayit.id,
      IZIN_ICI,
    );
    expect(karar.ok).toBe(true);
  });

  it("karar denetim izinde 'X adına Y' olarak durur", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI);
    await approveActivity(testDb, kisiler.planMudur.id, kayit.id, IZIN_ICI);

    const iz = await testDb.auditLog.findFirst({
      where: { objectId: kayit.id, action: "activity_approved" },
    });

    // İşi fiilen yapan vekil, adına yapılan ise izne çıkan yönetici.
    expect(iz?.userId).toBe(kisiler.planMudur.id);
    expect(iz?.actualUserId).toBe(kisiler.kalipMudur.id);
  });

  it("izindeki yöneticinin yetkisi alınmaz", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI);

    // Vekâlet ekler, çıkarmaz: izindeki müdür girerse hâlâ karar verebilir.
    const kuyruk = await listPendingApprovals(testDb, kisiler.kalipMudur.id, IZIN_ICI);
    expect(kuyruk.map((k) => k.id)).toContain(kayit.id);
  });

  it("bildirim vekile de gider", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI);

    for (const kisi of [kisiler.kalipMudur, kisiler.planMudur]) {
      const satirlar = await testDb.notificationQueue.findMany({
        where: { userId: kisi.id, eventType: "approval_pending" },
      });
      expect(satirlar).toHaveLength(1);
      expect(satirlar[0]?.payload).toMatchObject({ activityId: kayit.id });
    }
  });
});

describe("pencere dönem dışına taşmaz", () => {
  // Ürün sahibi kararı (21.08.2026): "işte görmemesi lazım. onun göreceği
  // kayıtlar onun vekil olduğu dönemleri kapsamalı."
  it("vekâlet ÖNCESİNE ait kayıt, vekâlet sürerken bile görünmez", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    // Vekâletten yedi ay önce yazılmış, onaylanmış bir kayıt.
    const eski = await kayitYaz(kisiler.kalipci, ESKI_KAYIT);
    await testDb.activity.update({
      where: { id: eski.id },
      data: { approvalStatus: "APPROVED" },
    });

    expect(await listede(kisiler.planMudur, eski.id, IZIN_ICI)).toBe(false);
    expect(await listede(kisiler.planMudur, eski.id, IZIN_SONRASI)).toBe(false);
  });

  it("vekâlet SONRASINA ait kayıt da görünmez", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    const sonraki = await kayitYaz(kisiler.kalipci, IZIN_SONRASI);
    await testDb.activity.update({
      where: { id: sonraki.id },
      data: { approvalStatus: "APPROVED" },
    });

    expect(await listede(kisiler.planMudur, sonraki.id, IZIN_SONRASI)).toBe(false);
  });

  it("vekâlet edilmeyen başka bir departman hiç açılmaz", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    // Genel müdürün kendi kaydı kalıphaneye ait değil; vekile açılmamalı.
    const kayit = await kayitYaz(kisiler.genelMudur, IZIN_ICI);

    expect(await listede(kisiler.planMudur, kayit.id, IZIN_ICI)).toBe(false);
  });
});

describe("dönem kaydı silinmez", () => {
  // Denetim 21.08.2026, bulgu 7: dönem satırı fiziksel siliniyordu ve
  // vekilin bütün geçmiş görünürlüğü o satırdan türediği için, yönetici
  // "kişi döndü, satırı kaldırayım" dediğinde vekil o dönemin kayıtlarını
  // bir anda kaybediyordu.
  it("vekâlet bitince satır kaldırılamaz; pencere ayakta kalır", async () => {
    const kisiler = await sirket();
    const kurulum = await vekaletKur(kisiler);
    if (!kurulum.ok) throw new Error("kurulum");

    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI);
    await approveActivity(testDb, kisiler.planMudur.id, kayit.id, IZIN_ICI);
    expect(await listede(kisiler.planMudur, kayit.id, IZIN_SONRASI)).toBe(true);

    // Silme veritabanı seviyesinde reddedilir.
    await expect(
      testDb.noActivityPeriod.delete({ where: { id: kurulum.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);

    // Pencere yerinde.
    expect(await listede(kisiler.planMudur, kayit.id, IZIN_SONRASI)).toBe(true);
  });

  it("gerekçeli iptal pencereyi bilerek kapatır", async () => {
    const kisiler = await sirket();
    const kurulum = await vekaletKur(kisiler);
    if (!kurulum.ok) throw new Error("kurulum");

    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI);
    expect(await listede(kisiler.planMudur, kayit.id, IZIN_ICI)).toBe(true);

    // "Sehven girildi" — dönem hiç yaşanmamış sayılır, kapsam kapanır.
    const iptal = await cancelNoActivityPeriod(
      testDb,
      kisiler.genelMudur.id,
      kurulum.id,
      "sehven girildi",
      IZIN_ICI,
    );
    expect(iptal.ok).toBe(true);

    expect(await listede(kisiler.planMudur, kayit.id, IZIN_ICI)).toBe(false);
    expect(await activeDeputyFor(testDb, kisiler.planMudur.id, IZIN_ICI)).toEqual([]);

    // Onay kuyruğu da kapanmalı. Kuyruk ayrı bir sorgudan besleniyordu ve
    // iptal koşulunu taşımayı unutmak, vekâleti alınmış kişinin ekranında
    // kararı bekleyen kayıtlar bırakırdı (bulgu 2).
    const kuyruk = await listPendingApprovals(testDb, kisiler.planMudur.id, IZIN_ICI);
    expect(kuyruk.map((k) => k.id)).not.toContain(kayit.id);

    const gruplar = await listApprovalGroups(testDb, kisiler.planMudur.id, IZIN_ICI);
    expect(gruplar.flatMap((g) => g.items.map((madde) => madde.id))).not.toContain(kayit.id);
  });
});

describe("vekâlet bittikten sonra", () => {
  it("o dönemin kayıtları görünmeye devam eder", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    // Vekilin hiç eline almadığı ama **o döneme ait** bir kayıt.
    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI);
    await approveActivity(testDb, kisiler.planMudur.id, kayit.id, IZIN_ICI);

    // Vekâlet bitti; aktif kapsam kapandı ama pencere duruyor.
    expect(await activeDeputyFor(testDb, kisiler.planMudur.id, IZIN_SONRASI)).toEqual(
      [],
    );
    expect(await listede(kisiler.planMudur, kayit.id, IZIN_SONRASI)).toBe(true);
    expect(
      await canViewActivity(
        testDb,
        viewer(kisiler.planMudur),
        { id: kayit.id, authorId: kayit.authorId, approvalStatus: "APPROVED" },
        undefined,
        IZIN_SONRASI,
      ),
    ).toBe("full");
  });

  it("kararı BAŞKASI vermiş olsa da dönemin kaydı görünür kalır", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    // Dönemin kaydı, ama kararı izinden dönen müdür veriyor. Vekil bu kayda
    // hiç dokunmadı; yine de o döneme dair bir soru gelirse cevap
    // verebilmeli — pencerenin süresiz olmasının bütün gerekçesi bu.
    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI);
    const karar = await approveActivity(
      testDb,
      kisiler.kalipMudur.id,
      kayit.id,
      IZIN_ICI,
    );
    expect(karar.ok).toBe(true);

    expect(await listede(kisiler.planMudur, kayit.id, IZIN_SONRASI)).toBe(true);
    expect(
      await canViewActivity(
        testDb,
        viewer(kisiler.planMudur),
        { id: kayit.id, authorId: kayit.authorId, approvalStatus: "APPROVED" },
        undefined,
        IZIN_SONRASI,
      ),
    ).toBe("full");
  });

  it("dönemde onaya düşmüş ama karara bağlanmamış kayıt artık görünmez", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    // Onay bekleyen kayıt: kuyruk hakkı vekâletle birlikte biter. Kayıt
    // hâlâ onay bekliyor ve artık vekilin işi değil.
    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI);
    expect(await listede(kisiler.planMudur, kayit.id, IZIN_ICI)).toBe(true);

    expect(await listede(kisiler.planMudur, kayit.id, IZIN_SONRASI)).toBe(false);
  });

  it("kararını verdiği kayıt her hâlükârda görünür kalır", async () => {
    const kisiler = await sirket();
    await vekaletKur(kisiler);

    // Vekâletten önce yazılmış ama devralınan kuyrukta bekleyen kayıt:
    // pencerenin dışında kalır, ama vekil kararını verdiği için görünür.
    const devralinan = await kayitYaz(kisiler.kalipci, ESKI_KAYIT);
    const karar = await approveActivity(
      testDb,
      kisiler.planMudur.id,
      devralinan.id,
      IZIN_ICI,
    );
    expect(karar.ok).toBe(true);

    expect(await listede(kisiler.planMudur, devralinan.id, IZIN_SONRASI)).toBe(true);
  });
});
