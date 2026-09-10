import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  confirmActivityDeletion,
  describeActivityForDeletion,
  requestActivityDeletion,
  DELETION_CODE_TTL_MS,
  MAX_DELETION_ATTEMPTS,
} from "@/server/activities/delete";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Root'un faaliyet silmesi (ürün sahibi kararı, 03.09.2026).
//
// Silme dört katmandan geçer ve her katman ayrı ayrı sınanır: yetki (yalnız
// root), dönem (kapanmış dönem silinemez), onay kodu, veritabanı kapısı.
//
// En kritik test **ikinci dönem kontrolü**: kod on dakika geçerli ve o sürede
// kapanış işi koşabilir. Kontrol yalnız talep açılırken yapılsaydı kural kâğıt
// üstünde kalırdı — kapanmış bir dönemin kaydı, talebi önce açılmış olduğu
// için silinebilirdi.

const NOW = new Date("2026-08-20T09:00:00.000Z");
const GUN = new Date("2026-08-18T00:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sahne() {
  const birim = await createOrgUnit({ name: "Kalıphane" });
  const root = await createUser(birim.id, {
    fullName: "Ana Yönetici",
    email: "root@ornek.test",
    isSystemAdmin: true,
    isRoot: true,
  });
  const yonetici = await createUser(birim.id, {
    fullName: "Sistem Yöneticisi",
    email: "admin@ornek.test",
    isSystemAdmin: true,
  });
  const yazar = await createUser(birim.id, { fullName: "Kalıpçı" });
  const activity = await createActivity(yazar, {
    title: "Pres hattı kontrolü",
    activityDate: GUN,
  });

  return { birim, root, yonetici, yazar, activity };
}

/** Kod yalnız e-postada durur; testte kuyruktan okunur. */
async function kuyruktakiKod(): Promise<string> {
  const satir = await testDb.notificationQueue.findFirstOrThrow({
    where: { eventType: "activity_deletion_code" },
    orderBy: { createdAt: "desc" },
  });

  const payload = satir.payload as { code?: unknown };
  return typeof payload.code === "string" ? payload.code : "";
}

async function donemiKapat(now: Date) {
  await testDb.scorePeriodLedger.create({
    data: {
      periodStart: new Date(Date.UTC(2026, 7, 1)),
      closedAt: now,
      retroactiveDays: 1,
      formulaVersion: 1,
    },
  });
}

describe("silme yetkisi (§15.1, karar 03.09.2026)", () => {
  it("root faaliyetin yalnız üst verisini görür, açıklamasını görmez", async () => {
    const { root, activity } = await sahne();

    const sonuc = await describeActivityForDeletion(testDb, root, activity.id);

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.value.title).toBe("Pres hattı kontrolü");
    expect(sonuc.value.authorName).toBe("Kalıpçı");
    expect(sonuc.value.periodClosed).toBe(false);
    // Açıklama metni hiçbir alanda taşınmıyor: sistem yöneticisi içeriğe
    // erişmiyor, yalnız hangi kaydı sildiğini biliyor.
    expect(JSON.stringify(sonuc.value)).not.toContain("Açıklama");
  });

  it("root olmayan sistem yöneticisi ne görebilir ne silme talebi açabilir", async () => {
    const { yonetici, activity } = await sahne();

    const goruntule = await describeActivityForDeletion(
      testDb,
      yonetici,
      activity.id,
    );
    const talep = await requestActivityDeletion(testDb, yonetici, activity.id, NOW);

    expect(goruntule.ok).toBe(false);
    expect(talep.ok).toBe(false);
    if (talep.ok) return;
    expect(talep.error).toBe("not_root");
  });

  it("olmayan kayıt için ayrım yapılmaz", async () => {
    const { root } = await sahne();

    const sonuc = await describeActivityForDeletion(
      testDb,
      root,
      "00000000-0000-0000-0000-000000000000",
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("not_found");
  });
});

describe("kapanmış dönem sınırı", () => {
  it("kapanmış döneme ait kayıt için talep açılamaz", async () => {
    const { root, activity } = await sahne();
    await donemiKapat(NOW);

    const goruntule = await describeActivityForDeletion(
      testDb,
      root,
      activity.id,
    );
    const talep = await requestActivityDeletion(testDb, root, activity.id, NOW);

    expect(goruntule.ok).toBe(true);
    if (goruntule.ok) expect(goruntule.value.periodClosed).toBe(true);

    expect(talep.ok).toBe(false);
    if (talep.ok) return;
    expect(talep.error).toBe("period_closed");
  });

  it("talep açıldıktan SONRA dönem kapanırsa silme yine reddedilir", async () => {
    // Kod on dakika geçerli; kapanış işi bu sürede koşabilir. Kontrol yalnız
    // talep anında yapılsaydı kapanmış dönemin kaydı silinebilirdi.
    const { root, activity } = await sahne();

    const talep = await requestActivityDeletion(testDb, root, activity.id, NOW);
    expect(talep.ok).toBe(true);
    const kod = await kuyruktakiKod();

    await donemiKapat(new Date(NOW.getTime() + 60_000));

    const sonuc = await confirmActivityDeletion(
      testDb,
      root,
      activity.id,
      kod,
      new Date(NOW.getTime() + 120_000),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("period_closed");
    // Kayıt yerinde durmalı.
    expect(await testDb.activity.count({ where: { id: activity.id } })).toBe(1);
  });
});

describe("onay kodu", () => {
  it("doğru kod kaydı ve bağlı satırlarını siler, izini bırakır", async () => {
    const { root, yazar, activity } = await sahne();

    // Bağlı kayıtlar: silme bunları da götürmeli.
    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: root.id, firstReadAt: NOW },
    });
    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: yazar.orgUnitId },
    });

    const talep = await requestActivityDeletion(testDb, root, activity.id, NOW);
    expect(talep.ok).toBe(true);
    const kod = await kuyruktakiKod();

    const sonuc = await confirmActivityDeletion(testDb, root, activity.id, kod, NOW);

    expect(sonuc.ok).toBe(true);
    expect(await testDb.activity.count({ where: { id: activity.id } })).toBe(0);
    expect(
      await testDb.activityRevision.count({ where: { activityId: activity.id } }),
    ).toBe(0);
    expect(await testDb.readReceipt.count({ where: { activityId: activity.id } })).toBe(0);

    // Kanıt kalır: denetim kaydı ve talep kaydı silinen kaydın üst verisini
    // taşır.
    const iz = await testDb.auditLog.findFirstOrThrow({
      where: { action: "activity_deleted", objectId: activity.id },
    });
    expect(iz.userId).toBe(root.id);

    const kalanTalep = await testDb.activityDeletionRequest.findFirstOrThrow({
      where: { activityId: activity.id },
    });
    expect(kalanTalep.activityTitle).toBe("Pres hattı kontrolü");
    expect(kalanTalep.consumedAt).not.toBeNull();

    // Skor için ayrı bir kuyruk **yazılmaz** ve bu doğrudur: yeniden
    // hesaplama kuyruğu yalnız donmuş karneler içindir, kapanmış dönem ise
    // zaten silinemiyor. Açık dönemin skoru her sorguda canlı hesaplandığı
    // için silinen kayıt kendiliğinden düşer.
    expect(
      await testDb.scoreRecalculationRequest.count({
        where: { userId: yazar.id, sourceId: activity.id },
      }),
    ).toBe(0);
  });

  it("yanlış kod silmez ve deneme sayılır; eşikte talep kapanır", async () => {
    const { root, activity } = await sahne();
    await requestActivityDeletion(testDb, root, activity.id, NOW);

    for (let deneme = 0; deneme < MAX_DELETION_ATTEMPTS; deneme += 1) {
      const sonuc = await confirmActivityDeletion(
        testDb,
        root,
        activity.id,
        "000000",
        NOW,
      );
      expect(sonuc.ok).toBe(false);
    }

    // Eşiğe varınca talep iptal: doğru kod bile artık çalışmaz.
    const kod = await kuyruktakiKod();
    const sonSonuc = await confirmActivityDeletion(
      testDb,
      root,
      activity.id,
      kod,
      NOW,
    );

    expect(sonSonuc.ok).toBe(false);
    if (sonSonuc.ok) return;
    expect(sonSonuc.error).toBe("no_request");
    expect(await testDb.activity.count({ where: { id: activity.id } })).toBe(1);
  });

  it("süresi geçmiş kod çalışmaz", async () => {
    const { root, activity } = await sahne();
    await requestActivityDeletion(testDb, root, activity.id, NOW);
    const kod = await kuyruktakiKod();

    const sonuc = await confirmActivityDeletion(
      testDb,
      root,
      activity.id,
      kod,
      new Date(NOW.getTime() + DELETION_CODE_TTL_MS + 1000),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("expired");
    expect(await testDb.activity.count({ where: { id: activity.id } })).toBe(1);
  });

  it("aynı kod ikinci kez çalışmaz", async () => {
    const { root, activity } = await sahne();
    await requestActivityDeletion(testDb, root, activity.id, NOW);
    const kod = await kuyruktakiKod();

    expect((await confirmActivityDeletion(testDb, root, activity.id, kod, NOW)).ok).toBe(
      true,
    );

    const ikinci = await confirmActivityDeletion(testDb, root, activity.id, kod, NOW);
    expect(ikinci.ok).toBe(false);
  });

  it("kod e-postayla gider ve kuyrukta düz metin olarak saklanmaz", async () => {
    const { root, activity } = await sahne();
    await requestActivityDeletion(testDb, root, activity.id, NOW);

    const kuyruk = await testDb.notificationQueue.findFirstOrThrow({
      where: { eventType: "activity_deletion_code" },
    });
    expect(kuyruk.userId).toBe(root.id);

    // Veritabanındaki talep kaydı kodun kendisini değil özetini taşır.
    const talep = await testDb.activityDeletionRequest.findFirstOrThrow({
      where: { activityId: activity.id },
    });
    const kod = await kuyruktakiKod();
    expect(talep.codeHash).not.toBe(kod);
    expect(talep.codeHash).toHaveLength(64);
  });
});
