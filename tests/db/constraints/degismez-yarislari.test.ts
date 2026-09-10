import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { setReasonActive } from "@/server/approval-reasons/service";
import { attachFiles } from "@/server/attachments/service";
import { closeFollowUp, openFollowUp } from "@/server/follow-ups/service";
import { updateUser } from "@/server/users/update";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../../helpers/test-db";

// "SON / AZAMİ / TEK" DEĞİŞMEZLERİ (denetim 21.08.2026; bulgu 6, 8, 10, 11).
//
// Dördü de aynı kalıbın kurbanıydı: **önce say, sonra yaz.** Sayım işlem
// dışında ve kilitsiz yapılıyordu; iki eşzamanlı işlem birbirinin yazmasını
// göremediği için ikisi de "kural bozulmuyor" diyor ve ikisi de geçiyordu.
//
// Düzeltme iki katmanlı:
//
//   · Uygulama tarafında kilit ve işlem içinde yeniden okuma.
//   · Veritabanı tarafında tetikleyici + danışma kilidi. `AGENTS.md`:
//     "kısıtın değeri, uygulama katmanı devre dışıyken de geçerli
//     olmasındadır." Bu dosya ikisini de sınıyor: servisten geçen yarışı ve
//     servisi atlayıp doğrudan veritabanına yazan yarışı.
//
// Yalnız tetikleyici koymak yetmezdi: READ COMMITTED altında iki işlem
// birbirinin yazmasını görmez. Yarışı kapatan şey danışma kilidi.

const NOW = new Date("2026-08-21T09:00:00.000Z");

const clientA = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
  log: [],
});
const clientB = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
  log: [],
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await Promise.all([
    testDb.$disconnect(),
    clientA.$disconnect(),
    clientB.$disconnect(),
  ]);
});

/**
 * İki yazmayı **gerçekten** çakıştırır.
 *
 * `Promise.all` ile iki tek cümlelik güncellemeyi başlatmak yeterli değil:
 * her biri kendi işlemidir ve ilki commit edip bitene kadar ikincisi genelde
 * hiç başlamaz. Yarış hiç kurulmaz, test de yeşil kalır ve hiçbir şey
 * kanıtlamaz — bu dosyanın ilk hâlinde tam olarak bu oldu.
 *
 * Doğru kurgu: birinci yazma **açık bir işlemin içinde** yapılır ve commit
 * edilmeden bekletilir. İkinci yazma o sırada başlar; koruma varsa kilitte
 * bekler, yoksa hemen geçer. Sonra birinci commit edilir.
 *
 *   · Koruma **varsa**: ikinci, birincinin commit'ini bekler, gerçeği görür
 *     ve reddedilir.
 *   · Koruma **yoksa**: ikinci hemen geçer, ikisi de yazar ve değişmez
 *     bozulur.
 */
async function cakisanYazma(
  birinci: (tx: PrismaClient) => Promise<unknown>,
  ikinci: () => Promise<unknown>,
): Promise<void> {
  let yazdi!: () => void;
  let birak!: () => void;

  const yazildi = new Promise<void>((resolve) => {
    yazdi = resolve;
  });
  const kapi = new Promise<void>((resolve) => {
    birak = resolve;
  });

  const ilkIslem = clientA
    .$transaction(
      async (tx) => {
        await birinci(tx as unknown as PrismaClient);
        yazdi();
        await kapi;
      },
      { timeout: 15_000 },
    )
    .catch(() => undefined);

  await yazildi;

  // İkinci yazma başlar; sonucu şimdilik beklenmez.
  const ikinciIslem = ikinci().catch(() => undefined);

  // İkinci ya kilitte bekliyordur (koruma çalışıyor) ya da çoktan bitmiştir
  // (koruma yok). İkisini de gözleriz; sabit bekleme kullanmayız.
  await ikinciDurulana(ikinciIslem);

  birak();
  await Promise.allSettled([ilkIslem, ikinciIslem]);
}

/** İkinci yazma ya kilitte bekliyor ya da bitmiş olana kadar bekler. */
async function ikinciDurulana(is: Promise<unknown>): Promise<void> {
  const bitis = Date.now() + 10_000;
  let bitti = false;
  void is.then(() => {
    bitti = true;
  });

  for (;;) {
    if (bitti) return;

    const [satir] = await testDb.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted
    `;
    if ((satir?.n ?? 0) > 0) return;

    if (Date.now() > bitis) throw new Error("ikinci yazma ne bitti ne kilitlendi");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("son aktif sistem yöneticisi (bulgu 6)", () => {
  async function ikiYonetici() {
    const birim = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const bir = await createUser(birim.id, {
      email: "bir@ornek.test",
      isSystemAdmin: true,
    });
    const iki = await createUser(birim.id, {
      email: "iki@ornek.test",
      isSystemAdmin: true,
    });
    return { birim, bir, iki };
  }

  function rolKaldir(client: PrismaClient, user: { id: string }, birimId: string) {
    return updateUser(
      client,
      {
        id: user.id,
        fullName: "Kişi",
        email: `${user.id}@ornek.test`,
        orgUnitId: birimId,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
      },
      null,
      NOW,
    );
  }

  it("iki eşzamanlı rol kaldırma şirketi yöneticisiz bırakamaz", async () => {
    const { birim, bir, iki } = await ikiYonetici();

    await cakisanYazma(
      (tx) => tx.user.update({ where: { id: bir.id }, data: { isSystemAdmin: false } }),
      () => rolKaldir(clientB, iki, birim.id),
    );

    const kalan = await testDb.user.count({
      where: { isSystemAdmin: true, isActive: true },
    });
    expect(kalan).toBeGreaterThanOrEqual(1);
  });

  it("uygulama atlansa da veritabanı son yöneticiyi korur", async () => {
    const { bir, iki } = await ikiYonetici();

    // Servis hiç çağrılmıyor: doğrudan tabloya yazılıyor.
    await cakisanYazma(
      (tx) => tx.user.update({ where: { id: bir.id }, data: { isSystemAdmin: false } }),
      () =>
        clientB.user.update({
          where: { id: iki.id },
          data: { isSystemAdmin: false },
        }),
    );

    expect(
      await testDb.user.count({ where: { isSystemAdmin: true, isActive: true } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("tek yöneticinin yetkisi doğrudan da kaldırılamaz", async () => {
    const birim = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const tek = await createUser(birim.id, {
      email: "tek@ornek.test",
      isSystemAdmin: true,
    });

    await expect(
      testDb.user.update({ where: { id: tek.id }, data: { isSystemAdmin: false } }),
    ).rejects.toThrow(/LAST_SYSTEM_ADMIN/);
  });

  it("başka yönetici varken kaldırılabilir", async () => {
    const { birim, bir } = await ikiYonetici();

    // Kontrol testi: yukarıdaki retlerin sebebi "son yönetici" olmalı,
    // "hiç kaldırılamıyor" değil.
    const sonuc = await rolKaldir(testDb, bir, birim.id);
    expect(sonuc.ok).toBe(true);
  });
});

describe("faaliyet başına ek sayısı (bulgu 8)", () => {
  async function dortEkliKayit() {
    const birim = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const yazar = await createUser(birim.id, { email: "yazar@ornek.test" });
    const kayit = await createActivity(yazar, { approvalStatus: "APPROVED" });

    for (let i = 0; i < 4; i += 1) {
      await testDb.attachment.create({
        data: {
          activityId: kayit.id,
          originalName: `dosya-${i}.png`,
          storedName: `stored-${i}`,
          storagePath: `/tmp/stored-${i}`,
          sizeBytes: 10,
          mimeType: "image/png",
          sha256: "a".repeat(64),
          uploadedById: yazar.id,
        },
      });
    }

    return { yazar, kayit };
  }

  /** Küçük ve geçerli bir PNG; tür içerikten doğrulanıyor (§15.4). */
  const PNG = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
      "1f15c4890000000a49444154789c6360000002000100ffff0300000600" +
      "05572bd2b40000000049454e44ae426082",
    "hex",
  );

  it("eşzamanlı iki yükleme sınırı aşamaz", async () => {
    const { yazar, kayit } = await dortEkliKayit();

    await cakisanYazma(
      (tx) =>
        tx.attachment.create({
          data: {
            activityId: kayit.id,
            originalName: "bes.png",
            storedName: "yarisan-5",
            storagePath: "/tmp/yarisan-5",
            sizeBytes: 10,
            mimeType: "image/png",
            sha256: "d".repeat(64),
            uploadedById: yazar.id,
          },
        }),
      // İkinci yazan da uygulamayı atlar: sınanan şey tetikleyicinin kendi
      // sıraya sokması. Servisten geçseydi onun kilidi yarışı kapatır ve
      // veritabanı korumasının çalışıp çalışmadığı görünmezdi.
      () =>
        clientB.attachment.create({
          data: {
            activityId: kayit.id,
            originalName: "alti.png",
            storedName: "yarisan-6",
            storagePath: "/tmp/yarisan-6",
            sizeBytes: 10,
            mimeType: "image/png",
            sha256: "e".repeat(64),
            uploadedById: yazar.id,
          },
        }),
    );

    const sayi = await testDb.attachment.count({ where: { activityId: kayit.id } });
    expect(sayi).toBeLessThanOrEqual(5);
  });

  it("servisten geçen eşzamanlı yükleme de sınırı aşamaz", async () => {
    const { yazar, kayit } = await dortEkliKayit();

    await cakisanYazma(
      (tx) =>
        tx.attachment.create({
          data: {
            activityId: kayit.id,
            originalName: "bes.png",
            storedName: "servis-5",
            storagePath: "/tmp/servis-5",
            sizeBytes: 10,
            mimeType: "image/png",
            sha256: "f".repeat(64),
            uploadedById: yazar.id,
          },
        }),
      () =>
        attachFiles(
          clientB,
          yazar.id,
          kayit.id,
          [{ originalName: "alti.png", content: PNG }],
          NOW,
        ),
    );

    expect(
      await testDb.attachment.count({ where: { activityId: kayit.id } }),
    ).toBeLessThanOrEqual(5);
  });

  it("uygulama atlansa da veritabanı sınırı korur", async () => {
    const { yazar, kayit } = await dortEkliKayit();

    // Beşinci geçer.
    await testDb.attachment.create({
      data: {
        activityId: kayit.id,
        originalName: "bes.png",
        storedName: "stored-5",
        storagePath: "/tmp/stored-5",
        sizeBytes: 10,
        mimeType: "image/png",
        sha256: "b".repeat(64),
        uploadedById: yazar.id,
      },
    });

    // Altıncı, servis hiç çağrılmadan da reddedilir.
    await expect(
      testDb.attachment.create({
        data: {
          activityId: kayit.id,
          originalName: "alti.png",
          storedName: "stored-6",
          storagePath: "/tmp/stored-6",
          sizeBytes: 10,
          mimeType: "image/png",
          sha256: "c".repeat(64),
          uploadedById: yazar.id,
        },
      }),
    ).rejects.toThrow(/ATTACHMENT_LIMIT_EXCEEDED/);
  });
});

describe("takip maddesi ikinci kez kapatılamaz (bulgu 10)", () => {
  async function acikMadde() {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const mudur = await createUser(kok.id, {
      email: "mudur@ornek.test",
      isUnitManager: true,
    });
    const yazar = await createUser(birim.id, { email: "yazar@ornek.test" });
    const kayit = await createActivity(yazar, { approvalStatus: "APPROVED" });

    const acilan = await openFollowUp(
      testDb,
      { id: yazar.id, isSystemAdmin: false },
      { activityId: kayit.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    return { mudur, yazar, madde: acilan.item };
  }

  it("iki eşzamanlı kapatma tek kapanış olayı üretir", async () => {
    const { mudur, yazar, madde } = await acikMadde();

    await cakisanYazma(
      async (tx) => {
        // İlk kapatan servisin yaptığını elle yapar: satırı kilitler ve
        // kapatır. Servisi çağıramayız — açık bir işlemin içinde ikinci bir
        // işlem açılamaz.
        await tx.$executeRaw`SELECT "id" FROM "FollowUpItem" WHERE "id" = ${madde.id} FOR UPDATE`;
        await tx.followUpItem.update({
          where: { id: madde.id },
          data: {
            status: "CLOSED",
            closedById: yazar.id,
            closedAt: NOW,
            closingNote: "yazarın notu",
            lastMovedAt: NOW,
          },
        });
        await tx.followUpItemEvent.create({
          data: {
            followUpId: madde.id,
            kind: "CLOSED",
            actorId: yazar.id,
            note: "yazarın notu",
            createdAt: NOW,
          },
        });
      },
      () =>
        closeFollowUp(
          clientB,
          { id: mudur.id, isSystemAdmin: false },
          madde.id,
          "müdürün notu",
          NOW,
        ),
    );

    const olaylar = await testDb.followUpItemEvent.count({
      where: { followUpId: madde.id, kind: "CLOSED" },
    });
    expect(olaylar).toBe(1);
  });

  it("uygulama atlansa da veritabanı ikinci kapanışı reddeder", async () => {
    const { yazar, madde } = await acikMadde();

    await closeFollowUp(
      testDb,
      { id: yazar.id, isSystemAdmin: false },
      madde.id,
      "kapandı",
      NOW,
    );

    await expect(
      testDb.followUpItem.update({
        where: { id: madde.id },
        data: { closedAt: new Date("2026-08-22T09:00:00.000Z") },
      }),
    ).rejects.toThrow(/FOLLOW_UP_ALREADY_CLOSED/);
  });
});

describe("son aktif onay gerekçesi (bulgu 11)", () => {
  async function ikiGerekce() {
    const birim = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const yonetici = await createUser(birim.id, {
      email: "yonetici@ornek.test",
      isSystemAdmin: true,
    });

    const bir = await testDb.approvalReason.create({
      data: { kind: "REJECTED", label: "Kapsam dışı" },
    });
    const iki = await testDb.approvalReason.create({
      data: { kind: "REJECTED", label: "Mükerrer" },
    });

    return { yonetici, bir, iki };
  }

  it("iki eşzamanlı pasifleştirme katalogu boşaltamaz", async () => {
    const { yonetici, bir, iki } = await ikiGerekce();

    await cakisanYazma(
      (tx) =>
        tx.approvalReason.update({ where: { id: bir.id }, data: { isActive: false } }),
      () => setReasonActive(clientB, iki.id, false, yonetici.id, NOW),
    );

    const kalan = await testDb.approvalReason.count({
      where: { kind: "REJECTED", isActive: true },
    });
    expect(kalan).toBeGreaterThanOrEqual(1);
  });

  it("uygulama atlansa da veritabanı son gerekçeyi korur", async () => {
    const { bir, iki } = await ikiGerekce();

    await cakisanYazma(
      (tx) =>
        tx.approvalReason.update({ where: { id: bir.id }, data: { isActive: false } }),
      () =>
        clientB.approvalReason.update({
          where: { id: iki.id },
          data: { isActive: false },
        }),
    );

    expect(
      await testDb.approvalReason.count({
        where: { kind: "REJECTED", isActive: true },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("başka aktif gerekçe varken pasifleştirilebilir", async () => {
    const { yonetici, bir } = await ikiGerekce();

    // Kontrol testi.
    const sonuc = await setReasonActive(testDb, bir.id, false, yonetici.id, NOW);
    expect(sonuc.ok).toBe(true);
  });
});
