import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cancelNoActivityPeriod, markNoActivityPeriod } from "@/server/absence/service";
import { approveActivity } from "@/server/activities/approval";
import { cancelActivity } from "@/server/activities/cancel";
import { createActivity } from "@/server/activities/write";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

// YETKİ YARIŞLARI (denetim 21.08.2026, bulgu 4 ve 5).
//
// Mevcut `write-races` testleri **durum** yarışlarını sınıyordu: iki iptal,
// iptal–düzeltme, iptal–soru. Hepsi kapalıydı.
//
// Kaçırılan sınıf başkaydı: **yetkinin kendisi** kilitten önce hesaplanıyor,
// yazma kilitten sonra yapılıyordu. Aradaki boşlukta yetki değişirse, artık
// yetkisi olmayan kişi işi tamamlıyordu:
//
//   · Vekil onaya basar, kilitte bekler; yönetici vekâlet dönemini iptal
//     eder; kilit açılır → vekâleti olmayan kişi kararı verir.
//   · Yönetici iptale basar, kilitte bekler; yazar başka bir dala taşınır;
//     kilit açılır → artık kaydı göremeyen kişi kaydı iptal eder.
//
// İkisi de "ön kontrolün sonucu, yazmanın yapıldığı anın kanıtıdır" hatası.
// Değil: yetkinin dayandığı okuma, yazmanın yapıldığı işlemin içinde olmalı.
//
// Yarışı kurmak için iki ayrı bağlantı ve buluşma noktası gerekir; tek
// istemciden art arda gönderilen çağrılar sıraya girer ve hiçbir şey
// kanıtlamaz.

const IZIN_ICI = new Date("2026-08-22T09:00:00.000Z");

const clientA = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
  log: [],
});
const clientB = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
  log: [],
});
const clientC = new PrismaClient({
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
    clientC.$disconnect(),
  ]);
});

/**
 * Faaliyeti kilitler ve bırakma anını çağırana verir.
 *
 * Yarışın kurulması buna bağlı: sınanan çağrı ön kontrollerini yapıp
 * **kilitte beklemeye** başlamalı, yetki tam o sırada değişmeli, sonra kilit
 * bırakılmalı. Kilit önceden bırakılırsa çağrı ön kontrolü zaten yeni durumla
 * yapar ve test hiçbir şey kanıtlamaz.
 */
async function kilitTut(
  client: PrismaClient,
  activityId: string,
): Promise<{ birak: () => void; bitti: Promise<void> }> {
  let birak!: () => void;
  let kilitAlindi!: () => void;

  const kilitHazir = new Promise<void>((resolve) => {
    kilitAlindi = resolve;
  });
  const kapi = new Promise<void>((resolve) => {
    birak = resolve;
  });

  const bitti = client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "Activity" WHERE "id" = ${activityId} FOR UPDATE`;
      kilitAlindi();
      await kapi;
    },
    { timeout: 15_000 },
  );

  await kilitHazir;
  return { birak, bitti };
}

/**
 * Bir bağlantının kilitte beklemeye başlamasını gözler.
 *
 * Sabit `sleep` yerine gerçek durumu okuruz: `pg_locks` içinde verilmemiş bir
 * kilit belirene kadar. Sabit bekleme, yavaş makinede erken devam eder ve
 * testi sessizce anlamsızlaştırırdı.
 *
 * Dosyalar sırayla koştuğu için (`fileParallelism: false`) verilmemiş kilit
 * yalnız bu testin kurduğu yarıştan gelir.
 */
async function kilitteBeklemeyiGozle(
  client: PrismaClient,
  timeoutMs = 10_000,
): Promise<void> {
  const bitis = Date.now() + timeoutMs;

  for (;;) {
    const [satir] = await client.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted
    `;
    if ((satir?.n ?? 0) > 0) return;
    if (Date.now() > bitis) {
      throw new Error("kilitte bekleyen bağlantı gözlenmedi: yarış kurulamadı");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function sirket() {
  const kok = await createOrgUnit({ name: "Acta HQ" });
  const kaliphane = await createOrgUnit({
    name: "Kalıphane",
    parentId: kok.id,
    requiresApproval: true,
  });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });
  const disBirim = await createOrgUnit({ name: "Boyahane", parentId: kok.id });

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

  return { kok, kaliphane, planlama, disBirim, genelMudur, kalipMudur, kalipci, planMudur };
}

async function kayitYaz(
  yazar: { id: string; orgUnitId: string },
  now: Date,
  requiresApproval: boolean,
) {
  const sonuc = await createActivity(
    testDb,
    { id: yazar.id, orgUnitId: yazar.orgUnitId, requiresApproval },
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

describe("vekâlet, karar anında yeniden doğrulanır", () => {
  it("kilitte beklerken vekâlet iptal edilirse karar tamamlanmaz", async () => {
    const kisiler = await sirket();
    const donem = await markNoActivityPeriod(
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
    if (!donem.ok) throw new Error("vekâlet kurulamadı");

    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI, true);

    // 1) Başkası faaliyeti kilitler ve tutar.
    const kilit = await kilitTut(clientA, kayit.id);

    // 2) Vekil onaya basar. Ön kontrolünü **vekâlet hâlâ geçerliyken** yapar,
    //    sonra kilitte beklemeye başlar.
    const kararSozu = approveActivity(clientB, kisiler.planMudur.id, kayit.id, IZIN_ICI);
    await kilitteBeklemeyiGozle(testDb);

    // 3) Tam o sırada yönetici vekâleti iptal eder.
    const iptal = await cancelNoActivityPeriod(
      clientC,
      kisiler.genelMudur.id,
      donem.id,
      "izin iptal oldu",
      IZIN_ICI,
    );
    expect(iptal.ok).toBe(true);

    // 4) Kilit bırakılır; vekilin çağrısı devam eder.
    kilit.birak();
    await kilit.bitti;

    const karar = await kararSozu;

    expect(karar.ok).toBe(false);

    const taze = await testDb.activity.findUniqueOrThrow({ where: { id: kayit.id } });
    expect(taze.approvalStatus).toBe("PENDING_APPROVAL");
    // `approverId` yazım anında çözülen onaylayıcıyı taşır; karar verilseydi
    // karar veren kişiye dönerdi. Vekile dönmemiş olmalı.
    expect(taze.approverId).not.toBe(kisiler.planMudur.id);
    expect(taze.approvalDecidedAt).toBeNull();
  });

  it("vekâlet dururken karar normal biçimde tamamlanır", async () => {
    const kisiler = await sirket();
    const donem = await markNoActivityPeriod(
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
    if (!donem.ok) throw new Error("vekâlet kurulamadı");

    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI, true);

    const karar = await approveActivity(
      testDb,
      kisiler.planMudur.id,
      kayit.id,
      IZIN_ICI,
    );

    // Kontrol testi: yukarıdaki reddin sebebi vekâletin iptali olmalı,
    // "vekil zaten karar veremiyor" değil.
    expect(karar.ok).toBe(true);
  });
});

describe("iptal yetkisi, iptal anında yeniden doğrulanır", () => {
  it("kilitte beklerken yazar başka dala taşınırsa iptal tamamlanmaz", async () => {
    const kisiler = await sirket();
    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI, false);

    // 1) Başkası faaliyeti kilitler ve tutar.
    const kilit = await kilitTut(clientA, kayit.id);

    // 2) Kalıphane müdürü iptale basar. Ön kontrolünü **yazar hâlâ kendi
    //    ekibindeyken** yapar, sonra kilitte beklemeye başlar.
    const iptalSozu = cancelActivity(
      clientB,
      { id: kisiler.kalipMudur.id, isSystemAdmin: false },
      kayit.id,
      "artık geçersiz",
      IZIN_ICI,
    );
    await kilitteBeklemeyiGozle(testDb);

    // 3) Tam o sırada yazar Boyahane'ye taşınır: artık Kalıphane müdürünün
    //    astı değil, kaydı da göremez (§4.6 — görünürlük güncel ağaçtan).
    await clientC.user.update({
      where: { id: kisiler.kalipci.id },
      data: { orgUnitId: kisiler.disBirim.id },
    });

    // 4) Kilit bırakılır; iptal çağrısı devam eder.
    kilit.birak();
    await kilit.bitti;

    const sonuc = await iptalSozu;

    expect(sonuc.ok).toBe(false);

    const taze = await testDb.activity.findUniqueOrThrow({ where: { id: kayit.id } });
    expect(taze.approvalStatus).toBe("APPROVED");
    expect(await testDb.cancellationRecord.count()).toBe(0);
  });

  it("yazar yerinde dururken iptal normal biçimde tamamlanır", async () => {
    const kisiler = await sirket();
    const kayit = await kayitYaz(kisiler.kalipci, IZIN_ICI, false);

    const sonuc = await cancelActivity(
      testDb,
      { id: kisiler.kalipMudur.id, isSystemAdmin: false },
      kayit.id,
      "yanlış kayıt",
      IZIN_ICI,
    );

    // Kontrol testi: yukarıdaki reddin sebebi taşıma olmalı.
    expect(sonuc.ok).toBe(true);
  });
});
