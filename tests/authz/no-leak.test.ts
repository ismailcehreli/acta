import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cancelActivity, canCancelActivity } from "@/server/activities/cancel";
import { findOwnActivity, listOwnActivities } from "@/server/activities/read";
import { listScopeActivities } from "@/server/activities/scope-feed";
import { updateActivity } from "@/server/activities/write";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Sızıntı toleransı sıfır (§18.4). Bu dosya, matris testlerinden farklı olarak
// **gerçek okuma ve yazma yollarını** kullanır: bir yol görünürlük modülünü
// atlarsa matris testleri yeşil kalsa bile burası kırılır.
//
// Görev 2.2'nin açık bırakılan bitiş kanıtı da buradadır: sistem yöneticisi
// rolü, ağaçtan gelmeyen hiçbir içeriği açmaz (§15.1). Arama ve ek indirme
// yolları Görev 5.1 ve 5.2'de eklendiğinde bu dosyaya o denemeler de girecek.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

const GIZLI = "SIZMAMASI GEREKEN ICERIK";

async function scenario() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planlama", parentId: root.id });
  const it = await createOrgUnit({ name: "Bilgi İşlem", parentId: root.id });

  const author = await createUser(moldShop.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const peer = await createUser(planning.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });
  const sysAdmin = await createUser(it.id, {
    fullName: "Sistem Yöneticisi",
    isSystemAdmin: true,
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Kalıp bakımı",
      description: GIZLI,
      approvalStatus: "APPROVED",
    },
  });

  // Muhatap etiketi de erişim vermez (§8.3): Planlama Müdürü etiketlense bile
  // faaliyeti göremez.
  await testDb.activityTargetDept.create({
    data: { activityId: activity.id, orgUnitId: planning.id },
  });

  return { author, peer, sysAdmin, activity };
}

const yetkisizler = [
  ["akran müdür", "peer"],
  ["sistem yöneticisi", "sysAdmin"],
] as const;

describe("liste yolu sızdırmaz", () => {
  it.each(yetkisizler)("%s başkasının faaliyetini listede göremez", async (_ad, kim) => {
    const context = await scenario();
    const viewer = context[kim];

    const list = await listOwnActivities(
      testDb,
      { id: viewer.id, isSystemAdmin: viewer.isSystemAdmin },
      { period: "all", now: new Date() },
    );

    expect(list.map((item) => item.id)).not.toContain(context.activity.id);
    expect(JSON.stringify(list)).not.toContain(GIZLI);
  });
});

describe("detay yolu sızdırmaz", () => {
  it.each(yetkisizler)("%s detay kaydını çekemez", async (_ad, kim) => {
    const context = await scenario();
    const viewer = context[kim];

    const found = await findOwnActivity(
      testDb,
      { id: viewer.id, isSystemAdmin: viewer.isSystemAdmin },
      context.activity.id,
    );

    expect(found).toBeNull();
  });
});

describe("yazma yolları da kapalıdır", () => {
  it.each(yetkisizler)("%s başkasının faaliyetini düzeltemez", async (_ad, kim) => {
    const context = await scenario();
    const viewer = context[kim];

    const result = await updateActivity(
      testDb,
      viewer.id,
      {
        id: context.activity.id,
        activityDate: "2026-08-17",
        title: "Ele geçirilmiş başlık",
        description: "Değiştirilmiş açıklama",
        targetDepartmentIds: [context.activity.authorOrgUnitId],
      },
      new Date("2026-08-17T09:05:00.000Z"),
    );

    expect(result.ok).toBe(false);

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: context.activity.id },
    });
    expect(stored.title).toBe("Kalıp bakımı");
  });

  it.each(yetkisizler)("%s başkasının faaliyetini iptal edemez", async (_ad, kim) => {
    const context = await scenario();
    const viewer = context[kim];
    const actor = { id: viewer.id, isSystemAdmin: viewer.isSystemAdmin };

    expect(await canCancelActivity(testDb, context.activity, actor)).toBe(false);

    const result = await cancelActivity(
      testDb,
      actor,
      context.activity.id,
      "Yetkisiz iptal denemesi.",
      new Date("2026-08-17T09:05:00.000Z"),
    );

    expect(result.ok).toBe(false);

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: context.activity.id },
    });
    expect(stored.approvalStatus).toBe("APPROVED");
  });
});

// Denetim (18.08.2026, bulgu 4): yukarıdaki yollarda `authorId = viewer`
// koşulu tek başına yeterli olduğu için, görünürlük filtresi tamamen kaldırılsa
// bile testler yeşil kalıyordu — yani "bir yol modülü atlarsa kırılır" iddiası
// kanıtlanmıyordu. Aşağıdaki blok, sonucu **yalnızca kapsamın** belirlediği
// yolu kullanır: yöneticinin akışı.
describe("kapsam akışı gerçekten görünürlük modülüne bağlıdır", () => {
  async function iceIceTree() {
    const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
    const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
    const planning = await createOrgUnit({ name: "Planlama", parentId: root.id });

    const moldManager = await createUser(moldShop.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
    });
    const moldWorker = await createUser(moldShop.id, { fullName: "Kalıphane Çalışanı" });
    const planningManager = await createUser(planning.id, {
      fullName: "Planlama Müdürü",
      isUnitManager: true,
    });

    const own = await testDb.activity.create({
      data: {
        authorId: moldWorker.id,
        authorOrgUnitId: moldShop.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Kendi ekibimin işi",
        description: GIZLI,
        approvalStatus: "APPROVED",
      },
    });
    const foreign = await testDb.activity.create({
      data: {
        authorId: planningManager.id,
        authorOrgUnitId: planning.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Akranın işi",
        description: GIZLI,
        approvalStatus: "APPROVED",
      },
    });

    return { moldManager, own, foreign };
  }

  it("yönetici yalnızca kendi ekibinin kayıtlarını görür", async () => {
    const { moldManager, own, foreign } = await iceIceTree();

    const { items: feed } = await listScopeActivities(
      testDb,
      { id: moldManager.id, isSystemAdmin: false },
      { period: "all" },
      new Date("2026-08-17T09:00:00.000Z"),
    );
    const ids = feed.map((item) => item.id);

    // Bu iddia yalnızca kapsam filtresi çalışıyorsa doğrudur: burada
    // `authorId = viewer` gibi ikinci bir daraltma yoktur.
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
  });

  it("onay sürecindeki kayıt akışta hiç görünmez", async () => {
    const { moldManager } = await iceIceTree();
    const root = await testDb.orgUnit.findFirstOrThrow({ where: { parentId: null } });
    const stranger = await createUser(root.id, { fullName: "Yabancı" });
    // Onay sürecindeki kaydın onaylayıcısı olmak zorunda (veritabanı kısıtı);
    // onaylayıcı **başkası**, bakan kişi değil. Sızıntı iddiası da tam bu:
    // onaylayıcısı olmadığın onay kaydını göremezsin.
    const baskaOnaylayici = await createUser(root.id, {
      fullName: "Başka Onaylayıcı",
    });
    const hidden = await testDb.activity.create({
      data: {
        authorId: stranger.id,
        authorOrgUnitId: root.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Onay bekleyen",
        description: GIZLI,
        approvalStatus: "PENDING_APPROVAL",
        approverId: baskaOnaylayici.id,
      },
    });

    const { items: feed } = await listScopeActivities(
      testDb,
      { id: moldManager.id, isSystemAdmin: false },
      { period: "all" },
      new Date("2026-08-17T09:00:00.000Z"),
    );

    expect(feed.map((item) => item.id)).not.toContain(hidden.id);
  });
});

describe("yazarın kendi erişimi bozulmaz", () => {
  it("yazan kişi kendi kaydını listede ve detayda görür", async () => {
    const { author, activity } = await scenario();
    const viewer = { id: author.id, isSystemAdmin: false };

    const list = await listOwnActivities(testDb, viewer, {
      period: "all",
      now: new Date(),
    });
    const detail = await findOwnActivity(testDb, viewer, activity.id);

    expect(list.map((item) => item.id)).toContain(activity.id);
    expect(detail?.description).toBe(GIZLI);
  });
});

// Denetim (18.08.2026, bulgu 1): yetkisiz erişim ile var olmayan kayıt
// farklı cevaplar veriyordu. Kullanıcı, formdaki gizli kimlik alanını
// değiştirerek kaydın varlığını ve durumunu öğrenebiliyordu.
describe("cevaplar kaydın varlığını ele vermez", () => {
  const OLMAYAN_ID = "00000000-0000-0000-0000-000000000000";

  it("düzeltme: yetkisiz kayıt ile olmayan kayıt aynı cevabı alır", async () => {
    const { peer, activity } = await scenario();
    const now = new Date("2026-08-17T09:05:00.000Z");

    const input = {
      activityDate: "2026-08-17",
      title: "Deneme başlığı",
      description: "Deneme açıklaması",
      targetDepartmentIds: [activity.authorOrgUnitId],
    };

    const yetkisiz = await updateActivity(
      testDb,
      peer.id,
      { ...input, id: activity.id },
      now,
    );
    const olmayan = await updateActivity(
      testDb,
      peer.id,
      { ...input, id: OLMAYAN_ID },
      now,
    );

    expect(yetkisiz).toEqual(olmayan);
  });

  it("iptal: yetkisiz kayıt ile olmayan kayıt aynı cevabı alır", async () => {
    const { peer, activity } = await scenario();
    const actor = { id: peer.id, isSystemAdmin: false };
    const now = new Date("2026-08-17T09:05:00.000Z");

    const yetkisiz = await cancelActivity(
      testDb,
      actor,
      activity.id,
      "Yetkisiz iptal denemesi.",
      now,
    );
    const olmayan = await cancelActivity(
      testDb,
      actor,
      OLMAYAN_ID,
      "Yetkisiz iptal denemesi.",
      now,
    );

    expect(yetkisiz.ok).toBe(false);
    expect(olmayan.ok).toBe(false);
    if (yetkisiz.ok || olmayan.ok) return;
    expect(yetkisiz.message).toBe(olmayan.message);
  });

  it("iptal edilmiş kaydın durumu yetkisiz kişiye açıklanmaz", async () => {
    const { author, peer, activity } = await scenario();
    const now = new Date("2026-08-17T09:05:00.000Z");

    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      "Yazarın kendi iptali.",
      now,
    );

    const yetkisiz = await cancelActivity(
      testDb,
      { id: peer.id, isSystemAdmin: false },
      activity.id,
      "Yetkisiz iptal denemesi.",
      now,
    );

    expect(yetkisiz.ok).toBe(false);
    if (yetkisiz.ok) return;
    // "Zaten iptal edilmiş" demek, kaydın varlığını ve durumunu ele verirdi.
    expect(yetkisiz.message).toBe("Faaliyet bulunamadı.");
  });
});
