import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/server/audit/log";
import { DEMO_EMAIL_DOMAIN } from "@/server/demo/data";
import {
  DEMO_ORIGIN_REUSED,
  rememberDemoOrgUnitOrigin,
} from "@/server/demo/origin";
import { purgeDemoData } from "@/server/demo/purge";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// ÖRNEK VERİ TEMİZLİĞİ (denetim 21.08.2026, bulgu 1).
//
// Temizlik, "fiziksel silme yok" kuralının bilinçli ve **dar** bir
// istisnasıdır (§22.3). Darlığın kanıtı bu dosyadır.
//
// Eski kod üç güvence vaat ediyor ve üçünü de tutmuyordu: yabancı anahtarların
// koruduğunu söylüyordu ama çocuk satırları önce sildiği için anahtarlar hiç
// devreye girmiyordu; denetim izini değişmez sayıyordu ama demo kullanıcının
// aktör olduğu bütün satırları siliyordu; işlemin ize yazıldığını söylüyordu
// ama yazmıyordu.
//
// Buradaki testlerin hepsi **gerçek veriye dokunulmadığını** sınıyor.

const NOW = new Date("2026-08-21T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/**
 * Küçük bir örnek şirket: bir demo kullanıcı, bir gerçek kullanıcı ve
 * demo kullanıcının yazdığı bir faaliyet.
 */
async function sahne() {
  const kok = await createOrgUnit({ name: "Acta HQ" });
  // Bu sahneyi örnek kurulum değil test kurdu; temizlik birimi korumalı ama
  // köken kapısında durmamalı ki aşağıdaki gerçek veri engelleri ölçülsün.
  await rememberDemoOrgUnitOrigin(testDb, kok.id, DEMO_ORIGIN_REUSED);

  const yonetici = await createUser(kok.id, {
    email: "yonetici@sirket.test",
    isSystemAdmin: true,
    isUnitManager: true,
  });
  const gercek = await createUser(kok.id, { email: "gercek@sirket.test" });
  const demo = await createUser(kok.id, { email: `demo@${DEMO_EMAIL_DOMAIN}` });

  const demoKayit = await createActivity(demo, { approvalStatus: "APPROVED" });

  return { kok, yonetici, gercek, demo, demoKayit };
}

describe("temizlik gerçek veriye dokunmaz", () => {
  it("gerçek kullanıcının mesajı varsa hiçbir şey silinmez", async () => {
    const { yonetici, gercek, demo, demoKayit } = await sahne();

    // Gerçek kullanıcı demo bir faaliyete soru sordu ve cevap yazıldı.
    const konusma = await testDb.conversation.create({
      data: {
        activityId: demoKayit.id,
        askerId: gercek.id,
        responsibleId: demo.id,
      },
    });
    await testDb.conversationMessage.create({
      data: {
        conversationId: konusma.id,
        authorId: gercek.id,
        text: "Bu kalıp sorunu neden sürüyor?",
      },
    });

    const sonuc = await purgeDemoData(testDb, yonetici.id, NOW);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    if (sonuc.error !== "blocked") throw new Error("engellenmeliydi");
    // Neyin engellediği söylenir: "bir şeyler ters gitti" sistem yöneticisini
    // kör bırakırdı.
    expect(sonuc.detail).toContain("mesaj");

    // **Hiçbir şey silinmedi.**
    expect(await testDb.conversationMessage.count()).toBe(1);
    expect(await testDb.activity.count({ where: { id: demoKayit.id } })).toBe(1);
    expect(await testDb.user.count({ where: { id: demo.id } })).toBe(1);
  });

  it("gerçek bir nesneye işaret eden denetim kaydı varsa hiçbir şey silinmez", async () => {
    const { yonetici, gercek, demo } = await sahne();

    // Demo kullanıcı **gerçek** bir kullanıcı üzerinde işlem yapmış.
    await testDb.auditLog.create({
      data: {
        userId: demo.id,
        objectType: "user",
        objectId: gercek.id,
        action: AUDIT_ACTIONS.userUpdated,
      },
    });

    const sonuc = await purgeDemoData(testDb, yonetici.id, NOW);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    if (sonuc.error !== "blocked") throw new Error("engellenmeliydi");
    expect(sonuc.detail).toContain("denetim");

    // Denetim izi değişmezdir (§15.2): tek satır bile gitmemeli.
    expect(await testDb.auditLog.count({ where: { objectId: gercek.id } })).toBe(1);
  });

  it("gerçek kullanıcının izin kaydına demo vekil atanmışsa silinmez", async () => {
    const { yonetici, gercek, demo } = await sahne();

    await testDb.noActivityPeriod.create({
      data: {
        userId: gercek.id,
        startDate: new Date("2026-08-20T00:00:00.000Z"),
        endDate: new Date("2026-08-25T00:00:00.000Z"),
        markedById: demo.id,
      },
    });

    const sonuc = await purgeDemoData(testDb, yonetici.id, NOW);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    if (sonuc.error !== "blocked") throw new Error("engellenmeliydi");
    expect(sonuc.detail).toContain("izin kaydı");
    expect(await testDb.noActivityPeriod.count()).toBe(1);
  });

  it("gerçek kullanıcının yüklediği ek varsa silinmez", async () => {
    const { yonetici, gercek, demoKayit } = await sahne();

    await testDb.attachment.create({
      data: {
        activityId: demoKayit.id,
        originalName: "rapor.pdf",
        storedName: "stored-gercek",
        storagePath: "gs/stored-gercek",
        sizeBytes: 10,
        mimeType: "application/pdf",
        sha256: "a".repeat(64),
        uploadedById: gercek.id,
      },
    });

    const sonuc = await purgeDemoData(testDb, yonetici.id, NOW);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    if (sonuc.error !== "blocked") throw new Error("engellenmeliydi");
    expect(sonuc.detail).toContain("ek");
    expect(await testDb.attachment.count()).toBe(1);
  });
});

describe("temiz durumda temizlik tamamlanır", () => {
  it("yalnız demo veri varsa silinir ve iz bırakır", async () => {
    const { yonetici, demo, demoKayit } = await sahne();

    // Demo kullanıcının kendi kaydına ait, kendi bıraktığı iz.
    await testDb.auditLog.create({
      data: {
        userId: demo.id,
        objectType: "activity",
        objectId: demoKayit.id,
        action: AUDIT_ACTIONS.activityCreated,
      },
    });

    const sonuc = await purgeDemoData(testDb, yonetici.id, NOW);

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.summary.users).toBe(1);
    expect(sonuc.summary.activities).toBe(1);

    expect(await testDb.user.count({ where: { id: demo.id } })).toBe(0);
    expect(await testDb.activity.count({ where: { id: demoKayit.id } })).toBe(0);

    // Gerçek kullanıcılar yerinde.
    expect(await testDb.user.count()).toBe(2);

    // **Temizliğin kendisi iz bıraktı.**
    const iz = await testDb.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.demoDataPurged },
    });
    expect(iz.userId).toBe(yonetici.id);
    expect(iz.objectId).toBe("demo_data");
  });

  it("silinecek örnek veri yoksa açıkça söylenir", async () => {
    const kok = await createOrgUnit({ name: "Acta HQ" });
    const yonetici = await createUser(kok.id, {
      email: "yonetici@sirket.test",
      isSystemAdmin: true,
    });

    const sonuc = await purgeDemoData(testDb, yonetici.id, NOW);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("nothing_to_purge");
  });
});

// Skor kapanışından geçmiş örnek veri (denetim 25.08.2026, P8-6).
//
// Yeni katkı tablosu hem faaliyete hem döneme `RESTRICT` ile bağlı. Temizlik
// katkıları silmediği için faaliyet silme yabancı anahtar ihlaliyle düşüyor,
// ham Prisma metni kullanıcıya "engel" diye taşınıyordu: skor kapanışı bir kez
// çalıştıktan sonra sistem yöneticisinin belgelenmiş "örnek veriyi bütünüyle
// kaldır" işlemi kalıcı olarak bozuluyordu.
describe("örnek veri temizliği — skor kapanışından sonra", () => {
  /** Demo kişinin dönemi **gerçek kapanış servisiyle** kapatılır. */
  async function kapanisiKostur() {
    await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
    // Faaliyetler fixture varsayılanıyla 2026-08-17'de; Eylül'ün üçünde
    // koşan işçi Ağustos'u kapatır. Ayın 1'i değil: geriye giriş penceresi
    // kapanmadan dönem dondurulmuyor (P8-R2-2).
    return closeScorePeriod(testDb, new Date("2026-09-03T06:00:00.000Z"));
  }

  it("donmuş dönemi ve katkısı olan demo veri temizlenir", async () => {
    const { yonetici, demo } = await sahne();

    const kapanis = await kapanisiKostur();
    expect(kapanis.written).toBeGreaterThan(0);
    const demoOlgu = await testDb.userScorePeriodFact.count({
      where: { userId: demo.id },
    });
    expect(demoOlgu, "demo kişinin katkısı oluşmalı").toBeGreaterThan(0);
    await testDb.scoreRecalculationRequest.create({
      data: {
        userId: demo.id,
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        sourceType: "TEST_DEMO_LATE_CHANGE",
        sourceId: "demo-late-change",
        requestedAt: new Date("2026-09-03T07:00:00.000Z"),
      },
    });
    expect(
      await testDb.scoreUserStateEvent.count({ where: { userId: demo.id } }),
    ).toBeGreaterThan(0);

    const sonuc = await purgeDemoData(testDb, yonetici.id, NOW);

    expect(sonuc.ok, `temizlik durdu: ${JSON.stringify(sonuc)}`).toBe(true);
    // Demo kişinin dönem ve katkıları gitti; gerçek kişilerinki durdu.
    expect(
      await testDb.userScorePeriodFact.count({ where: { userId: demo.id } }),
    ).toBe(0);
    expect(
      await testDb.userScorePeriod.count({ where: { userId: demo.id } }),
    ).toBe(0);
    expect(
      await testDb.scoreRecalculationRequest.count({
        where: { userId: demo.id },
      }),
    ).toBe(0);
    expect(
      await testDb.scoreUserStateEvent.count({ where: { userId: demo.id } }),
    ).toBe(0);
  });

  it("gerçek kullanıcının katkısı demo faaliyete bağlıysa temizlik durur", async () => {
    const { yonetici, gercek, demoKayit } = await sahne();

    // Gerçek kişinin donmuş dönemi, katkısı **demo** bir faaliyete bağlı.
    // Bu olgu gerçek kişinin geçmişine aittir; silinemez.
    const donemBasi = new Date("2026-07-01T00:00:00.000Z");
    // Gerçek kapanışın sırası: taslak, katkı, mühür (P8-R2-1).
    await testDb.userScorePeriod.create({
      data: {
        userId: gercek.id,
        periodStart: donemBasi,
        regularity: 40,
        followUp: 30,
        total: 70,
        expectedDays: 22,
        writtenDays: 20,
        frozen: false,
      },
    });
    await testDb.userScorePeriodFact.create({
      data: {
        userId: gercek.id,
        periodStart: donemBasi,
        activityId: demoKayit.id,
        kind: "WRITTEN",
        happenedOn: donemBasi,
      },
    });
    await testDb.userScorePeriod.update({
      where: {
        userId_periodStart_revisionNo: {
          userId: gercek.id,
          periodStart: donemBasi,
          revisionNo: 1,
        },
      },
      data: {
        frozen: true,
        profile: "employee",
        weightRegularity: 40,
        weightAcceptance: 30,
        weightApproval: 0,
        weightFollowUp: 30,
        formulaVersion: 1,
      },
    });

    const sonuc = await purgeDemoData(testDb, yonetici.id, NOW);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok || sonuc.error !== "blocked") {
      throw new Error(`beklenen engel yerine: ${JSON.stringify(sonuc)}`);
    }
    expect(sonuc.detail).toMatch(/skor katkısı/);
    // Hiçbir şey silinmemiş olmalı.
    expect(
      await testDb.userScorePeriodFact.count({ where: { userId: gercek.id } }),
    ).toBe(1);
    expect(await testDb.activity.count()).toBeGreaterThan(0);
  });
});
