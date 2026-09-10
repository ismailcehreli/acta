import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  countScopeActivities,
  describeScope,
  listScopeActivities,
  listScopePeople,
  periodStart,
} from "@/server/activities/scope-feed";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §13: ekran düzeni her kademede aynıdır, yalnızca kapsam genişler. Akış her
// zaman görünürlük modülünün filtresiyle başlar; buradaki filtreler yalnızca
// daraltır (§8.4).

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function buildCompany() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const directorate = await createOrgUnit({ name: "Direktörlük", parentId: root.id });
  const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: directorate.id });
  const planning = await createOrgUnit({ name: "Planlama", parentId: directorate.id });

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
  const peerManager = await createUser(planning.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });

  return {
    units: { root, directorate, moldShop, planning },
    generalManager,
    director,
    manager,
    worker,
    peerManager,
  };
}

async function write(
  author: { id: string; orgUnitId: string },
  day: string,
  title: string,
  targetUnitId?: string,
) {
  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: author.orgUnitId,
      activityDate: new Date(`${day}T00:00:00.000Z`),
      title,
      description: "Açıklama",
      approvalStatus: "APPROVED",
    },
  });

  if (targetUnitId) {
    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: targetUnitId },
    });
  }

  return activity;
}

describe("kapsam başlığı kademeye göre genişler (§13)", () => {
  it("astı olmayan kişide kapsam yoktur", async () => {
    const { worker } = await buildCompany();

    const scope = await describeScope(testDb, {
      id: worker.id,
      isSystemAdmin: false,
    });

    expect(scope.hasScope).toBe(false);
    expect(scope.personCount).toBe(0);
  });

  it("tek departmanı olan müdürde 'Departmanım'", async () => {
    const { manager } = await buildCompany();

    const scope = await describeScope(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });

    expect(scope.label).toBe("Departmanım");
    expect(scope.personCount).toBe(1);
  });

  it("birden çok departmanı olan direktörde 'Departmanlarım'", async () => {
    const { director } = await buildCompany();

    const scope = await describeScope(testDb, {
      id: director.id,
      isSystemAdmin: false,
    });

    expect(scope.label).toBe("Departmanlarım");
  });

  it("kök birimdeki yöneticide 'Tüm şirket'", async () => {
    const { generalManager } = await buildCompany();

    const scope = await describeScope(testDb, {
      id: generalManager.id,
      isSystemAdmin: false,
    });

    expect(scope.label).toBe("Tüm şirket");
  });
});

describe("akış görünürlük modülünden beslenir", () => {
  it("akran müdürün faaliyeti kapsam dışındadır", async () => {
    const { manager, worker, peerManager } = await buildCompany();
    const own = await write(worker, "2026-08-17", "Kalıphane işi");
    const peerActivity = await write(peerManager, "2026-08-17", "Planlama işi");

    const { items: feed } = await listScopeActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      {},
      NOW,
    );
    const ids = feed.map((item) => item.id);

    expect(ids).toContain(own.id);
    expect(ids).not.toContain(peerActivity.id);
  });

  it("onay sürecindeki kayıt üst kademelerin akışında görünmez", async () => {
    // Onay akışı Sürüm 1'e alınınca (19.08.2026) bu testin iddiası daraldı:
    // kaydı **aktif onaylayıcı** görür (§8.2), onun üstündekiler görmez.
    // Akışın varlık sebebi zaten bu.
    const { manager, worker, director, generalManager } = await buildCompany();
    const pending = await testDb.activity.create({
      data: {
        authorId: worker.id,
        authorOrgUnitId: worker.orgUnitId,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Onay bekleyen",
        description: "Açıklama",
        approvalStatus: "PENDING_APPROVAL",
        approverId: manager.id,
      },
    });

    // Uygun onaylayıcılar listesi üretimde kayıtla birlikte doğuyor
    // (20.08.2026: birimde birden fazla müdür olabilir).
    await testDb.activityApprover.create({
      data: { activityId: pending.id, userId: manager.id },
    });

    for (const viewer of [director, generalManager]) {
      const { items } = await listScopeActivities(
        testDb,
        { id: viewer.id, isSystemAdmin: false },
        {},
        NOW,
      );
      expect(items.map((item) => item.id)).not.toContain(pending.id);
    }

    // Onaylayıcının akışında ise görünür: kendi önündeki iştir ve durumu
    // ekranda rozetle yazılıdır.
    const { items: feed } = await listScopeActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      {},
      NOW,
    );

    expect(feed.map((item) => item.id)).toContain(pending.id);
  });

  it("filtreler yalnızca daraltır, kapsam dışını açamaz", async () => {
    const { manager, peerManager, units } = await buildCompany();
    const peerActivity = await write(
      peerManager,
      "2026-08-17",
      "Planlama işi",
      units.moldShop.id,
    );

    // Kalıphane muhatap filtresi uygulansa bile akranın kaydı gelmez.
    const { items: feed } = await listScopeActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      { targetOrgUnitId: units.moldShop.id },
      NOW,
    );

    expect(feed.map((item) => item.id)).not.toContain(peerActivity.id);
  });
});

describe("filtreler", () => {
  it("dönem filtresi eski kayıtları eler", async () => {
    const { director, worker } = await buildCompany();
    const today = await write(worker, "2026-08-17", "Bugünkü");
    const old = await write(worker, "2026-07-01", "Eski");

    const { items: bugun } = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "today" },
      NOW,
    );
    const { items: tumu } = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
    );

    expect(bugun.map((i) => i.id)).toEqual([today.id]);
    expect(tumu.map((i) => i.id)).toEqual(
      expect.arrayContaining([today.id, old.id]),
    );
  });

  it("kişi filtresi tek yazara indirir", async () => {
    const { director, worker, manager } = await buildCompany();
    const workerActivity = await write(worker, "2026-08-17", "Çalışanın işi");
    await write(manager, "2026-08-17", "Müdürün işi");

    const { items: feed } = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { authorId: worker.id },
      NOW,
    );

    expect(feed.map((i) => i.id)).toEqual([workerActivity.id]);
  });

  it("muhatap filtresi etiketlenen kayıtları seçer", async () => {
    const { director, worker, units } = await buildCompany();
    const tagged = await write(
      worker,
      "2026-08-17",
      "Planlamayı ilgilendiren",
      units.planning.id,
    );
    await write(worker, "2026-08-17", "Etiketsiz");

    const { items: feed } = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { targetOrgUnitId: units.planning.id },
      NOW,
    );

    expect(feed.map((i) => i.id)).toEqual([tagged.id]);
  });
});

describe("yönetim görünümü", () => {
  it("yöneticinin kendi kaydını dışarıda bırakır ve listeyle sayaç aynı kümeyi kullanır", async () => {
    const { manager, worker } = await buildCompany();
    const workerActivity = await write(worker, "2026-08-17", "Çalışanın işi");
    const managerActivity = await write(manager, "2026-08-17", "Müdürün işi");
    const selection = { subordinates: [worker.id], managedOnly: true };

    const viewer = { id: manager.id, isSystemAdmin: false };
    const [feed, count] = await Promise.all([
      listScopeActivities(testDb, viewer, { period: "all" }, NOW, selection),
      countScopeActivities(testDb, viewer, { period: "all" }, NOW, selection),
    ]);

    expect(feed.items.map((item) => item.id)).toEqual([workerActivity.id]);
    expect(feed.items.map((item) => item.id)).not.toContain(managerActivity.id);
    expect(count).toBe(feed.items.length);
  });
});

describe("okundu rozeti", () => {
  it("kişinin kendi okuması işaretlenir, başkasınınki görünmez", async () => {
    const { director, manager, worker } = await buildCompany();
    const activity = await write(worker, "2026-08-17", "Kalıphane işi");

    // Müdür okumuş olsun; direktörün akışında hâlâ okunmamış görünmeli
    // (§10.3: yönetici ekibinin okumasını göremez).
    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: manager.id },
    });

    const { items: directorFeed } = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      {},
      NOW,
    );
    expect(directorFeed[0].read).toBe(false);

    const { items: managerFeed } = await listScopeActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      {},
      NOW,
    );
    expect(managerFeed[0].read).toBe(true);
  });
});

describe("okunmamış dikkat filtresi", () => {
  it("liste ve sayaç aynı açık ve okunmamış kayıt kümesini kullanır", async () => {
    const { manager, worker, peerManager } = await buildCompany();
    const oldest = await write(worker, "2026-08-10", "Eski okunmamış");
    const newest = await write(worker, "2026-08-17", "Yeni okunmamış");
    const read = await write(worker, "2026-08-17", "Okunmuş kayıt");
    const rejectedReason = await createApprovalReason("REJECTED");
    const rejected = await createActivity(worker, {
      title: "Reddedilen kayıt",
      approvalStatus: "REJECTED",
      approverId: manager.id,
      approvalReasonId: rejectedReason.id,
      approvalReasonKind: "REJECTED",
    });
    const cancelled = await createActivity(worker, {
      title: "İptal edilen kayıt",
      approvalStatus: "CANCELLED",
    });
    const own = await write(manager, "2026-08-17", "Yöneticinin kendi kaydı");
    const peer = await write(peerManager, "2026-08-17", "Akran kaydı");

    await testDb.readReceipt.create({
      data: { activityId: read.id, userId: manager.id },
    });
    const viewer = { id: manager.id, isSystemAdmin: false };
    const selection = { subordinates: [worker.id], managedOnly: true };
    const [feed, count] = await Promise.all([
      listScopeActivities(
        testDb,
        viewer,
        { period: "all", unreadOnly: true },
        NOW,
        { ...selection, order: "oldest" },
      ),
      countScopeActivities(
        testDb,
        viewer,
        { period: "all", unreadOnly: true },
        NOW,
        selection,
      ),
    ]);

    const ids = feed.items.map((item) => item.id);
    expect(ids).toEqual([oldest.id, newest.id]);
    expect(count).toBe(feed.items.length);
    expect(ids).not.toContain(rejected.id);
    expect(ids).not.toContain(cancelled.id);
    expect(ids).not.toContain(peer.id);

    // Yönetim seçimi olmasa bile yöneticinin kendi kaydı okunmamış iş
    // kuyruğuna girmez; bunun sebebi yalnızca yazar seçimi değildir.
    const allVisible = await listScopeActivities(
      testDb,
      viewer,
      { period: "all", unreadOnly: true },
      NOW,
      { order: "oldest" },
    );
    expect(allVisible.items.map((item) => item.id)).not.toContain(own.id);
  });

  it("aynı faaliyet bir kullanıcıda okunmuşken diğerinde okunmamış kalır", async () => {
    const { director, manager, worker } = await buildCompany();
    const activity = await write(worker, "2026-08-17", "Kişiye özel okunmamış");

    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: manager.id },
    });

    const managerFeed = await listScopeActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      { period: "all", unreadOnly: true },
      NOW,
      { subordinates: [worker.id], managedOnly: true, order: "oldest" },
    );
    const directorFeed = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all", unreadOnly: true },
      NOW,
      {
        subordinates: [manager.id, worker.id],
        managedOnly: true,
        order: "oldest",
      },
    );

    expect(managerFeed.items.map((item) => item.id)).not.toContain(activity.id);
    expect(directorFeed.items.map((item) => item.id)).toContain(activity.id);
  });
});

describe("filtre seçenekleri", () => {
  it("kişi listesi yalnızca kapsamdakileri içerir", async () => {
    const { manager, worker, peerManager } = await buildCompany();

    const people = await listScopePeople(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });
    const ids = people.map((p) => p.id);

    expect(ids).toContain(worker.id);
    expect(ids).not.toContain(peerManager.id);
    expect(ids).not.toContain(manager.id);
  });
});

// Denetim (18.08.2026, FAZ 4 bulgu 11): dönem sınırı UTC takvim
// gününden üretiliyordu. Şirket saati Europe/Istanbul (UTC+3) olduğu için
// gece yarısından sonraki ilk üç saatte "Bugün" akışı önceki günü gösteriyor,
// aynı sayfadaki günlük sayaçla çelişiyordu.
describe("dönem sınırı şirket saatinden hesaplanır", () => {
  it("İstanbul'da gece yarısı geçince 'bugün' yeni gündür", () => {
    // 17 Ağustos 21:30 UTC = 18 Ağustos 00:30 İstanbul.
    const start = periodStart("today", new Date("2026-08-17T21:30:00.000Z"));

    expect(start?.toISOString().slice(0, 10)).toBe("2026-08-18");
  });

  it("gündüz saatlerinde 'bugün' aynı gündür", () => {
    const start = periodStart("today", new Date("2026-08-18T09:00:00.000Z"));

    expect(start?.toISOString().slice(0, 10)).toBe("2026-08-18");
  });

  it("'bu hafta' kayan yedi gün değil, Pazartesi başlar", () => {
    // 19 Ağustos 2026 Çarşamba; haftanın başı 17 Ağustos Pazartesi.
    const start = periodStart("week", new Date("2026-08-19T09:00:00.000Z"));

    expect(start?.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("Pazar günü hâlâ aynı haftadadır", () => {
    // 23 Ağustos 2026 Pazar.
    const start = periodStart("week", new Date("2026-08-23T09:00:00.000Z"));

    expect(start?.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("Pazartesi gece yarısı yeni hafta başlar", () => {
    // 16 Ağustos 21:30 UTC = 17 Ağustos 00:30 İstanbul, Pazartesi.
    const start = periodStart("week", new Date("2026-08-16T21:30:00.000Z"));

    expect(start?.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("'tümü' dönem sınırı koymaz", () => {
    expect(periodStart("all", new Date("2026-08-18T09:00:00.000Z"))).toBeNull();
  });
});
