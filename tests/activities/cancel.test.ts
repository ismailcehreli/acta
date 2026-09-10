import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cancelActivity } from "@/server/activities/cancel";
import { createActivity } from "@/server/activities/write";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §5.5: iptal yazan kişiye veya üstündeki herhangi bir yöneticiye açıktır,
// gerekçe zorunludur, kayıt silinmez ve iptal geri alınamaz.

const NOW = new Date("2026-08-17T09:00:00.000Z");
const REASON = "Yanlış vardiyaya yazıldı, doğrusu ayrıca girilecek.";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/**
 * Üç kademeli ağaç: Genel Müdürlük → Direktörlük → Kalıphane.
 * Yazan Kalıphane'de; direktör ve genel müdür üst zincirde; akran ise
 * başka bir departmanın müdürü.
 */
async function setup() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const directorate = await createOrgUnit({
    name: "Üretim Direktörlüğü",
    type: "Direktörlük",
    parentId: root.id,
  });
  const department = await createOrgUnit({
    name: "Kalıphane",
    type: "Departman",
    parentId: directorate.id,
  });
  const peerDepartment = await createOrgUnit({
    name: "Planlama",
    type: "Departman",
    parentId: directorate.id,
  });

  const generalManager = await createUser(root.id, { isUnitManager: true });
  const director = await createUser(directorate.id, { isUnitManager: true });
  const author = await createUser(department.id, { isUnitManager: true });
  const peer = await createUser(peerDepartment.id, { isUnitManager: true });
  const teammate = await createUser(department.id);

  const created = await createActivity(
    testDb,
    { id: author.id, orgUnitId: department.id, requiresApproval: false },
    {
      activityDate: "2026-08-17",
      title: "Kalıp bakımı",
      description: "Çatlak onarıldı.",
      targetDepartmentIds: [department.id],
    },
    NOW,
  );

  if (!created.ok) throw new Error("kurulum başarısız");

  return {
    department,
    generalManager,
    director,
    author,
    peer,
    teammate,
    activity: created.activity,
  };
}

describe("iptal yetkisi (§5.5)", () => {
  it("yazan kişi kendi faaliyetini iptal edebilir", async () => {
    const { author, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("doğrudan üstü iptal edebilir", async () => {
    const { director, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: director.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("zincirdeki üst kademe de iptal edebilir", async () => {
    const { generalManager, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: generalManager.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("akran iptal edemez", async () => {
    const { peer, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: peer.id, isSystemAdmin: false }, activity.id, REASON, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_allowed");

    // Faaliyet gerçekten dokunulmamış olmalı.
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("APPROVED");
  });

  it("aynı birimdeki ast iptal edemez", async () => {
    const { teammate, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: teammate.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_allowed");
  });
});

describe("gerekçe zorunluluğu", () => {
  it("boş gerekçeyle iptal reddedilir", async () => {
    const { author, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false }, activity.id, "   ", NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("reason_required");
  });

  it("gerekçe kayıt altına alınır", async () => {
    const { author, activity } = await setup();

    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false }, activity.id, REASON, NOW);

    const record = await testDb.cancellationRecord.findUniqueOrThrow({
      where: { activityId: activity.id },
    });
    expect(record.reason).toBe(REASON);
    expect(record.cancelledById).toBe(author.id);
  });
});

describe("iptalin sonuçları", () => {
  it("kayıt silinmez, iptal durumuna geçer", async () => {
    const { author, activity } = await setup();

    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false }, activity.id, REASON, NOW);

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("CANCELLED");
    expect(stored.title).toBe("Kalıp bakımı");
  });

  it("iptal geri alınamaz — veritabanı da izin vermez", async () => {
    const { author, activity } = await setup();
    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false }, activity.id, REASON, NOW);

    await expect(
      testDb.activity.update({
        where: { id: activity.id },
        data: { approvalStatus: "APPROVED" },
      }),
    ).rejects.toThrow(/ACTIVITY_INVALID_STATUS_TRANSITION/);
  });

  it("ikinci kez iptal edilemez", async () => {
    const { author, activity } = await setup();
    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false }, activity.id, REASON, NOW);

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_cancelled");
  });

  it("olmayan faaliyet iptal edilemez", async () => {
    const { author } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      "00000000-0000-0000-0000-000000000000",
      REASON,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });
});

describe("açık konuşmaların kapanması", () => {
  async function withOpenConversation() {
    const context = await setup();
    const conversation = await testDb.conversation.create({
      data: {
        activityId: context.activity.id,
        askerId: context.director.id,
        responsibleId: context.author.id,
      },
    });
    return { ...context, conversation };
  }

  it("iptal edilince açık konuşmalar ayrı bir türle kapanır", async () => {
    const { author, activity, conversation } = await withOpenConversation();

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.closedConversationCount).toBe(1);

    const stored = await testDb.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(stored.status).toBe("CLOSED");
        // İptal kapanışı idari kapatmayla aynı türe karışmaz (açık soru 9).
    expect(stored.closeType).toBe("CANCELLED_ACTIVITY");
    expect(stored.closeReason).toBeNull();
    expect(stored.closedById).toBe(author.id);
  });

  it("konuşmanın diğer tarafına bildirim kuyruğa yazılır", async () => {
    const { author, director, activity } = await withOpenConversation();

    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false }, activity.id, REASON, NOW);

    const notifications = await testDb.notificationQueue.findMany();

    // İptali yapan kişiye kendi işleminin bildirimi gitmez.
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe(director.id);
    expect(notifications[0].eventType).toBe("activity_cancelled");
    expect(notifications[0].status).toBe("PENDING");
  });

  it("kapalı konuşma yeniden kapatılmaz ve bildirim üretmez", async () => {
    const { author, activity, conversation } = await withOpenConversation();
    await testDb.conversation.update({
      where: { id: conversation.id },
      data: { status: "CLOSED", closedAt: NOW, closedById: author.id },
    });

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.closedConversationCount).toBe(0);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });
});

// Denetim (18.08.2026, bulgu 6): arayüz onaylanmamış kayıtlarda da iptal
// bağlantısı gösteriyordu; veritabanı yalnız APPROVED → CANCELLED geçişine izin
// verdiği için istek yakalanmamış hatayla 500 veriyordu.
describe("iptal yalnızca onaylanmış faaliyet için tanımlıdır", () => {
  it("taslak kayıt iptal edilemez ve hata anlaşılır olur", async () => {
    const { author, department } = await setup();
    // Kayıt baştan taslak olarak oluşturulur: veritabanı APPROVED → DRAFT
    // geçişine zaten izin vermiyor.
    const draft = await testDb.activity.create({
      data: {
        authorId: author.id,
        authorOrgUnitId: department.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Taslak kayıt",
        description: "Açıklama",
        approvalStatus: "DRAFT",
      },
    });

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      draft.id,
      REASON,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_cancellable");
  });

  it("kısa gerekçe kabul edilir; tasarım asgari uzunluk istemiyor", async () => {
    const { author, activity } = await setup();

    const result = await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      "Mükerrer",
      NOW,
    );

    expect(result.ok).toBe(true);
  });
});

// Denetim (18.08.2026, bulgu 5): yetki, durum ve yan etkiler tek atomik
// karara bağlı değildi.
describe("eşzamanlı iptal", () => {
  it("iki eşzamanlı iptalden yalnız biri yazar", async () => {
    const { author, activity } = await setup();
    const actor = { id: author.id, isSystemAdmin: false };

    const [birinci, ikinci] = await Promise.all([
      cancelActivity(testDb, actor, activity.id, "Birinci gerekçe.", NOW),
      cancelActivity(testDb, actor, activity.id, "İkinci gerekçe.", NOW),
    ]);

    expect([birinci.ok, ikinci.ok].filter(Boolean)).toHaveLength(1);

    // Tek bir iptal kaydı olmalı; çift kayıt birincil anahtarla da engellenir.
    expect(await testDb.cancellationRecord.count()).toBe(1);
  });
});
