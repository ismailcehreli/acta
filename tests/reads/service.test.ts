import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { updateActivity } from "@/server/activities/write";
import {
  countsAsRead,
  listActivityReaders,
  markActivityAsRead,
  READ_DWELL_MS,
} from "@/server/reads/service";
import { saveSettings, SETTING_KEYS } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §10: okundu bilgisi. Otomatik toplanır, kullanıcı başına ilk ve son okuma
// saklanır, yalnızca yazana ve okuyanın kendisine görünür.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function scenario() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planlama", parentId: root.id });

  const generalManager = await createUser(root.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const manager = await createUser(moldShop.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const author = await createUser(moldShop.id, { fullName: "Kalıphane Çalışanı" });
  const peer = await createUser(planning.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Kalıp bakımı",
      description: "Çatlak onarıldı.",
      approvalStatus: "APPROVED",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  return { generalManager, manager, author, peer, activity, moldShop };
}

const viewer = (user: { id: string }) => ({ id: user.id, isSystemAdmin: false });

describe("§10.2 — 'okundu' ne demektir", () => {
  it("iki saniyenin altı okundu saymaz", () => {
    expect(countsAsRead(1_999)).toBe(false);
    expect(countsAsRead(0)).toBe(false);
  });

  it("iki saniye ve üstü okundu sayar", () => {
    expect(countsAsRead(READ_DWELL_MS)).toBe(true);
    expect(countsAsRead(5_000)).toBe(true);
  });

  it("kısa süreli görüntüleme kayıt bırakmaz", async () => {
    const { manager, activity } = await scenario();

    const sonuc = await markActivityAsRead(
      testDb,
      viewer(manager),
      activity.id,
      1_500,
      NOW,
    );

    expect(sonuc).toEqual({ ok: false, reason: "too_short" });
    expect(await testDb.readReceipt.count()).toBe(0);
  });

  it("ayar iki saniyeden uzunsa istemci eşiği sunucu ayarını izler", async () => {
    const { manager, activity } = await scenario();
    await saveSettings(testDb, { [SETTING_KEYS.readDwellSeconds]: "5" });

    const erken = await markActivityAsRead(
      testDb,
      viewer(manager),
      activity.id,
      3_000,
      NOW,
    );
    expect(erken).toEqual({ ok: false, reason: "too_short" });

    const yeterli = await markActivityAsRead(
      testDb,
      viewer(manager),
      activity.id,
      5_000,
      NOW,
    );
    expect(yeterli).toEqual({ ok: true, recorded: true });
  });
});

describe("§10.3 — ilk ve son okuma", () => {
  it("ilk okuma korunur, son okuma güncellenir", async () => {
    const { manager, activity } = await scenario();
    const sonra = new Date(NOW.getTime() + 3_600_000);

    await markActivityAsRead(testDb, viewer(manager), activity.id, 3_000, NOW);
    await markActivityAsRead(testDb, viewer(manager), activity.id, 3_000, sonra);

    const kayit = await testDb.readReceipt.findUniqueOrThrow({
      where: { activityId_userId: { activityId: activity.id, userId: manager.id } },
    });

    expect(kayit.firstReadAt).toEqual(NOW);
    expect(kayit.lastReadAt).toEqual(sonra);
    // Ara okumalar saklanmaz: kullanıcı başına tek satır.
    expect(await testDb.readReceipt.count()).toBe(1);
  });

  it("yazarın kendi kaydı okuma sayılmaz", async () => {
    const { author, activity } = await scenario();

    const sonuc = await markActivityAsRead(
      testDb,
      viewer(author),
      activity.id,
      5_000,
      NOW,
    );

    expect(sonuc).toEqual({ ok: true, recorded: false });
    expect(await testDb.readReceipt.count()).toBe(0);
  });
});

describe("görünürlük kuralı okumaya da uygulanır", () => {
  it("göremediği faaliyeti okumuş sayılamaz", async () => {
    const { peer, activity } = await scenario();

    const sonuc = await markActivityAsRead(
      testDb,
      viewer(peer),
      activity.id,
      5_000,
      NOW,
    );

    expect(sonuc).toEqual({ ok: false, reason: "not_visible" });
    expect(await testDb.readReceipt.count()).toBe(0);
  });

  it("olmayan faaliyet okunmuş sayılamaz", async () => {
    const { manager } = await scenario();

    const sonuc = await markActivityAsRead(
      testDb,
      viewer(manager),
      "00000000-0000-0000-0000-000000000000",
      5_000,
      NOW,
    );

    expect(sonuc).toEqual({ ok: false, reason: "not_visible" });
  });
});

describe("§10.3 — okuma bilgisini kim görür", () => {
  async function okunmusFaaliyet() {
    const context = await scenario();
    await markActivityAsRead(
      testDb,
      viewer(context.manager),
      context.activity.id,
      3_000,
      NOW,
    );
    await markActivityAsRead(
      testDb,
      viewer(context.generalManager),
      context.activity.id,
      3_000,
      NOW,
    );
    return context;
  }

  it("yazan, kendi faaliyetini kimlerin okuduğunu görür", async () => {
    const { author, activity, manager, generalManager } = await okunmusFaaliyet();

    const okuyanlar = await listActivityReaders(
      testDb,
      viewer(author),
      activity.id,
    );

    expect(okuyanlar.map((r) => r.userId).sort()).toEqual(
      [manager.id, generalManager.id].sort(),
    );
  });

  it("okuyan yalnızca kendi okumasını görür", async () => {
    const { manager, activity } = await okunmusFaaliyet();

    const okuyanlar = await listActivityReaders(
      testDb,
      viewer(manager),
      activity.id,
    );

    expect(okuyanlar).toHaveLength(1);
    expect(okuyanlar[0].userId).toBe(manager.id);
  });

  it("yönetici, ekibinin ne okuduğunu göremez", async () => {
    const { generalManager, manager, activity } = await okunmusFaaliyet();

    const okuyanlar = await listActivityReaders(
      testDb,
      viewer(generalManager),
      activity.id,
    );

    // Genel Müdür üst kademe olmasına rağmen yalnız kendi kaydını görüyor;
    // "YK Başkanı istisnası" v3'te kaldırıldı ve burada yok.
    expect(okuyanlar).toHaveLength(1);
    expect(okuyanlar[0].userId).toBe(generalManager.id);
    expect(okuyanlar.map((r) => r.userId)).not.toContain(manager.id);
  });

  it("faaliyeti göremeyen kişi okuma bilgisini de göremez", async () => {
    const { peer, activity } = await okunmusFaaliyet();

    expect(await listActivityReaders(testDb, viewer(peer), activity.id)).toEqual(
      [],
    );
  });
});

describe("okundu, düzeltme penceresini kapatır (§5.5 bağlantısı)", () => {
  it("başkası okuduktan sonra yazan düzeltemez", async () => {
    const { author, manager, activity, moldShop } = await scenario();

    await markActivityAsRead(
      testDb,
      viewer(manager),
      activity.id,
      3_000,
      new Date(NOW.getTime() + 60_000),
    );

    const sonuc = await updateActivity(
      testDb,
      author.id,
      {
        id: activity.id,
        activityDate: "2026-08-17",
        title: "Düzeltilmiş başlık",
        description: "Düzeltilmiş açıklama",
        targetDepartmentIds: [moldShop.id],
      },
      new Date(NOW.getTime() + 120_000),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("already_read");
  });

  it("kimse okumadıysa pencere açık kalır", async () => {
    const { author, activity, moldShop } = await scenario();

    const sonuc = await updateActivity(
      testDb,
      author.id,
      {
        id: activity.id,
        activityDate: "2026-08-17",
        title: "Düzeltilmiş başlık",
        description: "Düzeltilmiş açıklama",
        targetDepartmentIds: [moldShop.id],
      },
      new Date(NOW.getTime() + 120_000),
    );

    expect(sonuc.ok).toBe(true);
  });
});
