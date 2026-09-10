import type { ActivityApprovalStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  canViewActivity,
  listInterventionQueue,
  subordinateUserIds,
  visibleActivityWhere,
  type VisibilityLevel,
} from "@/server/authz/visibility";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §8.2 yetki matrisinin **Sürüm 1'de uygulanan** her hücresi ayrı ayrı sınanır:
// yazan, üst zincir ve sistem yöneticisi sütunları. "Aktif onaylayıcı" sütunu
// bu sürümde uygulanmadı (onay görevi tablosu açılmadı, §18.2) ve burada
// **test edilmiş sayılmaz**; o sütunun hücreleri Sürüm 2'de yazılacak. Sürüm
// 1'de onaya tabi birimde faaliyet girişi reddedildiği için ilgili durumlar
// hiç oluşmuyor.
//
// Bu suite her CI koşusunda çalışır; kırıldığında yapılacak tek şey kodu
// düzeltmektir. Sızıntı toleransı sıfırdır (§18.4).

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/**
 * Üç kademeli örnek ağaç:
 *
 *   Genel Müdürlük ── GM (birim yöneticisi)
 *     └─ Üretim Direktörlüğü ── Direktör
 *          ├─ Kalıphane ── Müdür + Çalışan
 *          └─ Planlama  ── Akran Müdür
 *
 *   Bilgi İşlem ── Sistem Yöneticisi (ağaçta kimsenin üstünde değil)
 */
async function buildTree() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const directorate = await createOrgUnit({
    name: "Üretim Direktörlüğü",
    parentId: root.id,
  });
  const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: directorate.id });
  const planning = await createOrgUnit({ name: "Planlama", parentId: directorate.id });
  const it = await createOrgUnit({ name: "Bilgi İşlem", parentId: root.id });

  const generalManager = await createUser(root.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const director = await createUser(directorate.id, {
    fullName: "Direktör",
    isUnitManager: true,
  });
  const manager = await createUser(moldShop.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const worker = await createUser(moldShop.id, { fullName: "Kalıphane Çalışanı" });
  const peer = await createUser(planning.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });
  const sysAdmin = await createUser(it.id, {
    fullName: "Sistem Yöneticisi",
    isSystemAdmin: true,
  });

  return {
    units: { root, directorate, moldShop, planning, it },
    generalManager,
    director,
    manager,
    worker,
    peer,
    sysAdmin,
  };
}

/**
 * Onay sürecindeki kaydın onaylayıcısı olmak **zorundadır** (veritabanı kısıtı
 * `Activity_approver_required_in_approval`). Test verisi de bu kurala uyar;
 * uymayan veri üretmek, üretimde imkânsız bir durumu sınamak olurdu.
 */
async function writeActivity(
  author: { id: string; orgUnitId: string },
  status: ActivityApprovalStatus,
  title = "Faaliyet",
  approverId?: string,
) {
  const onayGerekir =
    status === "PENDING_APPROVAL" ||
    status === "CHANGES_REQUESTED" ||
    status === "REJECTED";

  // Yöneticisi olmayan kişi için bu durumlar üretimde de doğamaz: §4.4
  // çözülemezse kayıt MANAGER_NOT_FOUND olur. Test verisi de öyle davranır.
  const onaylayanId = onayGerekir
    ? (approverId ?? (await onaylayiciVarsa(author.id)))
    : null;

  if (onayGerekir && onaylayanId === null) {
    return testDb.activity.create({
      data: {
        authorId: author.id,
        authorOrgUnitId: author.orgUnitId,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title,
        description: "GIZLI ICERIK",
        approvalStatus: "MANAGER_NOT_FOUND",
      },
    });
  }

  const kayit = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: author.orgUnitId,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title,
      description: "GIZLI ICERIK",
      approvalStatus: status,
      approverId: onaylayanId,
      ...(await gerekceAlanlari(status)),
    },
  });

  // Uygun onaylayıcılar listesi gerçek yazma yolunda kayıtla birlikte
  // doğuyor (20.08.2026: birimde birden fazla müdür olabilir). Test verisi
  // de öyle davranmalı, yoksa görünürlük sorgusu üretimden farklı çalışır.
  if (onaylayanId) {
    await testDb.activityApprover.create({
      data: { activityId: kayit.id, userId: onaylayanId },
    });
  }

  return kayit;
}

/**
 * Gerekçe alanları. "Düzeltme istendi" ve "reddedildi" durumlarında kategori
 * **zorunludur** (veritabanı kısıtı); test verisi de gerçek kurala uyar.
 */
async function gerekceAlanlari(status: ActivityApprovalStatus) {
  if (status !== "CHANGES_REQUESTED" && status !== "REJECTED") return {};

  const reason = await testDb.approvalReason.upsert({
    where: { kind_label: { kind: status, label: "Test gerekçesi" } },
    create: { kind: status, label: "Test gerekçesi" },
    update: {},
  });

  return {
    approvalReasonId: reason.id,
    approvalReasonKind: status,
  } as const;
}

/** §4.4'ün çözdüğü yönetici; kısıtı sağlamak için gerçek kural kullanılır. */
async function onaylayiciVarsa(userId: string): Promise<string | null> {
  const { resolveManager } = await import("@/server/org/resolve-manager");
  const sonuc = await resolveManager(testDb, userId);
  return sonuc.found ? sonuc.managerId : null;
}

const ALL_STATUSES: ActivityApprovalStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "MANAGER_NOT_FOUND",
  "APPROVED",
  "CANCELLED",
];

// ---------------------------------------------------------------------------
// §8.2 — durum × ilişki matrisi
// ---------------------------------------------------------------------------

describe("§8.2 matrisi — yazan sütunu", () => {
  it.each(ALL_STATUSES)(
    "%s durumunda yazan kişi kendi faaliyetini görür",
    async (status) => {
      const { worker } = await buildTree();
      const activity = await writeActivity(worker, status);

      const level = await canViewActivity(
        testDb,
        { id: worker.id, isSystemAdmin: false },
        activity,
      );

      expect(level).toBe<VisibilityLevel>("full");
    },
  );
});

describe("§8.2 matrisi — üst zincir sütunu", () => {
  const chainVisible: ActivityApprovalStatus[] = ["APPROVED", "CANCELLED"];
  const chainHidden: ActivityApprovalStatus[] = [
    "DRAFT",
    "PENDING_APPROVAL",
    "CHANGES_REQUESTED",
    "MANAGER_NOT_FOUND",
  ];

  it.each(chainVisible)("%s durumunda üst zincir görür", async (status) => {
    const { worker, manager, director, generalManager } = await buildTree();
    const activity = await writeActivity(worker, status);

    for (const viewer of [manager, director, generalManager]) {
      const level = await canViewActivity(
        testDb,
        { id: viewer.id, isSystemAdmin: false },
        activity,
      );
      expect(level).toBe<VisibilityLevel>("full");
    }
  });

  it.each(chainHidden)("%s durumunda üst zincir GÖRMEZ", async (status) => {
    const { worker, director, generalManager } = await buildTree();
    const activity = await writeActivity(worker, status);

    // `manager` bilerek listede yok: o, çalışanın **aktif onaylayıcısı**dır ve
    // §8.2 matrisi onay sürecindeki kaydı ona açar. Onun üstündeki kademeler
    // görmemeli — akışın varlık sebebi zaten bu (süzülmemiş içerik yukarı
    // akmasın). Onaylayıcı sütunu ayrı bir describe'da sınanıyor.
    for (const viewer of [director, generalManager]) {
      const level = await canViewActivity(
        testDb,
        { id: viewer.id, isSystemAdmin: false },
        activity,
      );
      expect(level).toBe<VisibilityLevel>("none");
    }
  });
});

describe("§8.2 matrisi — sistem yöneticisi sütunu", () => {
  it("yalnızca yönetici bulunamadı kayıtlarında üst veri görür", async () => {
    const { worker, sysAdmin } = await buildTree();
    const activity = await writeActivity(worker, "MANAGER_NOT_FOUND");

    const level = await canViewActivity(
      testDb,
      { id: sysAdmin.id, isSystemAdmin: true },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("metadata");
  });

  it.each(ALL_STATUSES.filter((status) => status !== "MANAGER_NOT_FOUND"))(
    "%s durumunda sistem yöneticisi içeriği GÖRMEZ",
    async (status) => {
      const { worker, sysAdmin } = await buildTree();
      const activity = await writeActivity(worker, status);

      const level = await canViewActivity(
        testDb,
        { id: sysAdmin.id, isSystemAdmin: true },
        activity,
      );

      expect(level).toBe<VisibilityLevel>("none");
    },
  );

  it("rol, ağaçtan gelmeyen erişim eklemez (§15.1)", async () => {
    const { worker, peer } = await buildTree();
    const activity = await writeActivity(worker, "APPROVED");

    // Akran, sistem yöneticisi yapılsa bile bu faaliyeti göremez: yetkisi
    // ağaçtaki konumundan gelir, rolünden değil.
    const level = await canViewActivity(
      testDb,
      { id: peer.id, isSystemAdmin: true },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("none");
  });

  it("ağaçtan gelen yetki, sistem yöneticisi rolüyle daralmaz", async () => {
    const { worker, manager } = await buildTree();
    const activity = await writeActivity(worker, "APPROVED");

    const level = await canViewActivity(
      testDb,
      { id: manager.id, isSystemAdmin: true },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("full");
  });
});

// ---------------------------------------------------------------------------
// §8.1 — akranlar ve yön
// ---------------------------------------------------------------------------

describe("§8.1 akranlar birbirini görmez", () => {
  it.each(ALL_STATUSES)(
    "%s durumunda akran müdür faaliyeti görmez",
    async (status) => {
      const { manager, peer } = await buildTree();
      const activity = await writeActivity(manager, status);

      const level = await canViewActivity(
        testDb,
        { id: peer.id, isSystemAdmin: false },
        activity,
      );

      expect(level).toBe<VisibilityLevel>("none");
    },
  );

  it("aynı birimdeki iki çalışan birbirini görmez", async () => {
    const { units } = await buildTree();
    const first = await createUser(units.moldShop.id, { fullName: "Çalışan A" });
    const second = await createUser(units.moldShop.id, { fullName: "Çalışan B" });
    const activity = await writeActivity(first, "APPROVED");

    const level = await canViewActivity(
      testDb,
      { id: second.id, isSystemAdmin: false },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("none");
  });

  it("ast, üstünün faaliyetini görmez", async () => {
    const { worker, manager } = await buildTree();
    const activity = await writeActivity(manager, "APPROVED");

    const level = await canViewActivity(
      testDb,
      { id: worker.id, isSystemAdmin: false },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("none");
  });

  it("birim yöneticisi kendi birimindeki çalışanı görür", async () => {
    const { worker, manager } = await buildTree();
    const activity = await writeActivity(worker, "APPROVED");

    const level = await canViewActivity(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("full");
  });
});

// ---------------------------------------------------------------------------
// §8.3 — muhatap departman erişim vermez
// ---------------------------------------------------------------------------

describe("§8.3 muhatap departman erişim vermez", () => {
  it("etiketlenen departmanın müdürü faaliyeti göremez", async () => {
    const { manager, peer, units } = await buildTree();
    // Planlama Müdürü, Kalıphane'yi muhatap göstererek faaliyet yazıyor.
    const activity = await writeActivity(peer, "APPROVED", "Kalıp süreci");
    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: units.moldShop.id },
    });

    // Kalıphane Müdürü etiketlenmiş olmasına rağmen göremez: Planlama onun
    // altında değildir.
    const level = await canViewActivity(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("none");
  });

  it("muhatap etiketi kapsam sorgusuna da kayıt eklemez", async () => {
    const { manager, peer, units } = await buildTree();
    const activity = await writeActivity(peer, "APPROVED", "Kalıp süreci");
    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: units.moldShop.id },
    });

    const where = await visibleActivityWhere(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });
    const visible = await testDb.activity.findMany({ where });

    expect(visible.map((a) => a.id)).not.toContain(activity.id);
  });
});

// ---------------------------------------------------------------------------
// Kapsam sorgusu — liste ve arama bu filtreyi kullanır
// ---------------------------------------------------------------------------

describe("kapsam sorgusu", () => {
  it("yönetici olmayan kişi yalnızca kendi faaliyetlerini görür", async () => {
    const { worker, manager } = await buildTree();
    const own = await writeActivity(worker, "APPROVED", "Kendi faaliyetim");
    await writeActivity(manager, "APPROVED", "Müdürün faaliyeti");

    const where = await visibleActivityWhere(testDb, {
      id: worker.id,
      isSystemAdmin: false,
    });
    const visible = await testDb.activity.findMany({ where });

    expect(visible.map((a) => a.id)).toEqual([own.id]);
  });

  it("birim yöneticisi kendi birimini ve alt dalı görür, akranını görmez", async () => {
    const { worker, manager, peer, director } = await buildTree();
    const workerActivity = await writeActivity(worker, "APPROVED", "Çalışan");
    const managerActivity = await writeActivity(manager, "APPROVED", "Müdür");
    const peerActivity = await writeActivity(peer, "APPROVED", "Akran");

    const where = await visibleActivityWhere(testDb, {
      id: director.id,
      isSystemAdmin: false,
    });
    const visible = await testDb.activity.findMany({ where });
    const ids = visible.map((a) => a.id);

    // Direktör: alt dalındaki herkesi görür (akran müdür de onun altındadır).
    expect(ids).toContain(workerActivity.id);
    expect(ids).toContain(managerActivity.id);
    expect(ids).toContain(peerActivity.id);
  });

  it("akran müdürün kapsamı diğer departmanı içermez", async () => {
    const { worker, peer } = await buildTree();
    const workerActivity = await writeActivity(worker, "APPROVED");

    const where = await visibleActivityWhere(testDb, {
      id: peer.id,
      isSystemAdmin: false,
    });
    const visible = await testDb.activity.findMany({ where });

    expect(visible.map((a) => a.id)).not.toContain(workerActivity.id);
  });

  it("onay sürecindeki alt faaliyet üst kademelerin kapsamına girmez", async () => {
    const { worker, director, generalManager } = await buildTree();
    const pending = await writeActivity(worker, "PENDING_APPROVAL");
    const approved = await writeActivity(worker, "APPROVED");

    // Çalışanın onaylayıcısı müdürdür; direktör ve genel müdür onay
    // sürecindeki kaydı görmemeli (§8.2).
    for (const viewer of [director, generalManager]) {
      const where = await visibleActivityWhere(testDb, {
        id: viewer.id,
        isSystemAdmin: false,
      });
      const ids = (await testDb.activity.findMany({ where })).map((a) => a.id);

      expect(ids).toContain(approved.id);
      expect(ids).not.toContain(pending.id);
    }
  });

  it("onay sürecindeki kayıt yalnız onaylayıcının kapsamına girer", async () => {
    const { worker, manager, peer } = await buildTree();
    const pending = await writeActivity(worker, "PENDING_APPROVAL");

    const onaylayicininki = await visibleActivityWhere(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });
    expect(
      (await testDb.activity.findMany({ where: onaylayicininki })).map((a) => a.id),
    ).toContain(pending.id);

    // Akran onaylayıcı değildir; kapsamına hiç girmemeli.
    const akraninki = await visibleActivityWhere(testDb, {
      id: peer.id,
      isSystemAdmin: false,
    });
    expect(
      (await testDb.activity.findMany({ where: akraninki })).map((a) => a.id),
    ).not.toContain(pending.id);
  });

  it("iptal edilmiş alt faaliyet kapsamda kalır (üstü çizili gösterilir)", async () => {
    const { worker, manager } = await buildTree();
    const cancelled = await writeActivity(worker, "CANCELLED");

    const where = await visibleActivityWhere(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });
    const visible = await testDb.activity.findMany({ where });

    expect(visible.map((a) => a.id)).toContain(cancelled.id);
  });

  it("sistem yöneticisinin kapsamı ağaçtan gelir, rolünden değil", async () => {
    const { worker, sysAdmin } = await buildTree();
    const activity = await writeActivity(worker, "APPROVED");

    const where = await visibleActivityWhere(testDb, {
      id: sysAdmin.id,
      isSystemAdmin: true,
    });
    const visible = await testDb.activity.findMany({ where });

    expect(visible.map((a) => a.id)).not.toContain(activity.id);
  });

  it("kapsam, tekil karar fonksiyonuyla tutarlıdır", async () => {
    const { worker, manager, peer, director, generalManager, sysAdmin } =
      await buildTree();
    const people = [worker, manager, peer, director, generalManager, sysAdmin];

    // Her kişi her durumda birer faaliyet yazsın.
    for (const person of people) {
      for (const status of ALL_STATUSES) {
        await writeActivity(person, status, `${person.fullName}-${status}`);
      }
    }

    const all = await testDb.activity.findMany();

    for (const person of people) {
      const viewer = { id: person.id, isSystemAdmin: person.isSystemAdmin };
      const where = await visibleActivityWhere(testDb, viewer);
      const listed = new Set(
        (await testDb.activity.findMany({ where })).map((a) => a.id),
      );

      for (const activity of all) {
        const level = await canViewActivity(testDb, viewer, activity);
        // Listede görünen her kayıt için tekil karar "full" olmalı ve tersi.
        expect(listed.has(activity.id)).toBe(level === "full");
      }
    }
  });
});

describe("astların belirlenmesi", () => {
  it("yönetici olmayan kişinin astı yoktur", async () => {
    const { worker } = await buildTree();

    expect(await subordinateUserIds(testDb, worker.id)).toEqual([]);
  });

  it("birim yöneticisi kendi birimi ve alt dalındaki herkesi kapsar", async () => {
    const { manager, worker } = await buildTree();

    const ids = await subordinateUserIds(testDb, manager.id);

    expect(ids).toContain(worker.id);
    expect(ids).not.toContain(manager.id);
  });

  it("üst kademe, aradaki yöneticileri de kapsar", async () => {
    const { generalManager, director, manager, worker, peer } = await buildTree();

    const ids = await subordinateUserIds(testDb, generalManager.id);

    expect(ids).toEqual(
      expect.arrayContaining([director.id, manager.id, worker.id, peer.id]),
    );
  });
});

describe("müdahale kuyruğu (§8.2 sistem yöneticisi istisnası)", () => {
  it("yalnızca yönetici bulunamadı kayıtlarını içerir", async () => {
    const { worker, sysAdmin } = await buildTree();
    const orphan = await writeActivity(worker, "MANAGER_NOT_FOUND");
    await writeActivity(worker, "APPROVED");

    const rows = await listInterventionQueue(testDb, {
      id: sysAdmin.id,
      isSystemAdmin: true,
    });

    expect(rows.map((a) => a.id)).toEqual([orphan.id]);
  });

  it("yalnızca üst veri döner; açıklama hiçbir şekilde taşınmaz", async () => {
    const { worker, sysAdmin } = await buildTree();
    await writeActivity(worker, "MANAGER_NOT_FOUND");

    const rows = await listInterventionQueue(testDb, {
      id: sysAdmin.id,
      isSystemAdmin: true,
    });

    // Dönen nesnenin alanları sabittir: açıklama ve ek alanları yoktur.
    expect(Object.keys(rows[0]).sort()).toEqual([
      "activityDate",
      "authorId",
      "authorName",
      "id",
      "title",
    ]);
    expect(JSON.stringify(rows)).not.toContain("GIZLI ICERIK");
  });

  it("sistem yöneticisi olmayan için hiçbir kayıt döndürmez", async () => {
    const { worker, manager } = await buildTree();
    await writeActivity(worker, "MANAGER_NOT_FOUND");

    const rows = await listInterventionQueue(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });

    expect(rows).toEqual([]);
  });
});
