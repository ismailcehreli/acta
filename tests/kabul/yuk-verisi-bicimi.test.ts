import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity } from "@/server/activities/approval";
import { createActivity } from "@/server/activities/write";

import {
  eksikYukKisiSayisi,
  onayliGecmisSatiri,
  onayliGecmisTuru,
} from "../helpers/kabul-yuk-verisi";
import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Kabul yük verisinin **toplu geçmişi** üretimde mümkün mü?
// (denetim 23.08.2026, bulgu 10.)
//
// Yük üreticisi on iki ayın her iş günü için `createActivity` +
// `approveActivity` çağıramıyor: binlerce ayrı işlem, dakikalarca süren bir
// yük hazırlığı demek. Geçmiş bu yüzden `createMany` ile toplu yazılıyor.
//
// Toplu yazmanın tehlikesi belli ve bu projede bir kez yaşandı (P3-R2-1):
// elle kurulan satır üretimde **imkânsız** olabilir ve ölçüm başka bir
// dünyayı ölçer. O yüzden burada iddia edilmiyor, kanıtlanıyor: aynı girdiyle
// gerçek servislerin bıraktığı satır ile üreticinin yazdığı satır alan alan
// karşılaştırılıyor.
//
// Karşılaştırma **dışlama listesiyle** yapılıyor: yeni bir sütun eklendiğinde
// test kendiliğinden onu da karşılaştırır ve toplu yol geride kalırsa kırılır.
// Beyaz liste kullansaydı, unutulan sütun sessizce geçerdi.

const NOW = new Date("2026-08-18T09:00:00.000Z");
const KARAR = new Date("2026-08-19T11:00:00.000Z");

/** İçeriği ve kimliği taşıyan, doğası gereği farklı olacak alanlar. */
const FARKI_BEKLENEN_ALANLAR = new Set([
  "id",
  "activityNo",
  "title",
  "description",
  // Prisma `@updatedAt` sütununu yazma anında kendisi tazeliyor; ikisi ayrı
  // anda yazıldığı için eşit olamaz.
  "updatedAt",
]);

describe("kabul yük verisi — şirket büyüklüğü", () => {
  it("global kurulumdaki kişiler toplam 40 hedefinin içinde sayılır", () => {
    expect(eksikYukKisiSayisi(8)).toBe(32);
  });

  it("hedef zaten doluysa yeni kişi eklemez", () => {
    expect(eksikYukKisiSayisi(40)).toBe(0);
  });

  it("hedefi aşan başlangıcı sessizce farklı bir hacim diye kabul etmez", () => {
    expect(() => eksikYukKisiSayisi(41)).toThrow(/40.*aşıyor/);
  });

  it("geçersiz kişi sayısını reddeder", () => {
    expect(() => eksikYukKisiSayisi(-1)).toThrow(/geçersiz/);
    expect(() => eksikYukKisiSayisi(1.5)).toThrow(/geçersiz/);
  });
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sahne() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({
    name: "Boyahane",
    parentId: kok.id,
    requiresApproval: true,
  });
  const mudur = await createUser(birim.id, { isUnitManager: true });
  const calisan = await createUser(birim.id);

  return { birim, mudur, calisan };
}

describe("kabul yük verisi — toplu geçmişin biçimi", () => {
  it("toplu yazılan onaylı kayıt, servislerin bıraktığı satırla aynı", async () => {
    const { birim, mudur, calisan } = await sahne();

    // 1) Gerçek yol: yaz, sonra onayla.
    const yazildi = await createActivity(
      testDb,
      { id: calisan.id, orgUnitId: birim.id, requiresApproval: true },
      {
        activityDate: "2026-08-18",
        title: "Servisten geçen kayıt",
        description: "Gerçek yazma ve onaylama yolundan geçen kayıt.",
        targetDepartmentIds: [birim.id],
      },
      NOW,
    );
    expect(yazildi.ok).toBe(true);
    if (!yazildi.ok) return;

    const onaylandi = await approveActivity(
      testDb,
      mudur.id,
      yazildi.activity.id,
      KARAR,
    );
    expect(onaylandi.ok).toBe(true);

    const servisSatiri = await testDb.activity.findUniqueOrThrow({
      where: { id: yazildi.activity.id },
    });

    // 2) Toplu yol: aynı girdiden üreticinin satırı.
    const topluId = (
      await testDb.activity.create({
        data: onayliGecmisSatiri({
          authorId: calisan.id,
          authorOrgUnitId: birim.id,
          approverId: mudur.id,
          activityDate: new Date("2026-08-18T00:00:00.000Z"),
          gonderim: servisSatiri.createdAt,
          karar: servisSatiri.approvalDecidedAt ?? KARAR,
        }),
      })
    ).id;

    const topluSatir = await testDb.activity.findUniqueOrThrow({
      where: { id: topluId },
    });

    // 3) Alan alan karşılaştırma.
    const farklar: string[] = [];
    for (const alan of Object.keys(servisSatiri)) {
      if (FARKI_BEKLENEN_ALANLAR.has(alan)) continue;

      const beklenen = servisSatiri[alan as keyof typeof servisSatiri];
      const gercek = topluSatir[alan as keyof typeof topluSatir];
      if (JSON.stringify(beklenen) !== JSON.stringify(gercek)) {
        farklar.push(`${alan}: servis=${String(beklenen)} · toplu=${String(gercek)}`);
      }
    }

    expect(farklar).toEqual([]);
  });

  it("toplu yazılan onay turu, servisin bıraktığı turla aynı", async () => {
    const { birim, mudur, calisan } = await sahne();

    const yazildi = await createActivity(
      testDb,
      { id: calisan.id, orgUnitId: birim.id, requiresApproval: true },
      {
        activityDate: "2026-08-18",
        title: "Servisten geçen kayıt",
        description: "Gerçek yazma ve onaylama yolundan geçen kayıt.",
        targetDepartmentIds: [birim.id],
      },
      NOW,
    );
    if (!yazildi.ok) throw new Error("kurulum başarısız");
    await approveActivity(testDb, mudur.id, yazildi.activity.id, KARAR);

    const servisTuru = await testDb.approvalRound.findFirstOrThrow({
      where: { activityId: yazildi.activity.id },
    });

    // Aynı girdiden üreticinin turu; ikinci bir kayda bağlanıyor çünkü
    // (activityId, roundNo) tekil.
    const ikinci = await testDb.activity.create({
      data: onayliGecmisSatiri({
        authorId: calisan.id,
        authorOrgUnitId: birim.id,
        approverId: mudur.id,
        activityDate: new Date("2026-08-18T00:00:00.000Z"),
        gonderim: NOW,
        karar: KARAR,
      }),
    });
    const topluTur = await testDb.approvalRound.create({
      data: onayliGecmisTuru({
        activityId: ikinci.id,
        decidedById: mudur.id,
        gonderim: servisTuru.submittedAt,
        karar: servisTuru.decidedAt ?? KARAR,
      }),
    });

    const farklar: string[] = [];
    for (const alan of Object.keys(servisTuru)) {
      if (alan === "id" || alan === "activityId") continue;

      const beklenen = servisTuru[alan as keyof typeof servisTuru];
      const gercek = topluTur[alan as keyof typeof topluTur];
      if (JSON.stringify(beklenen) !== JSON.stringify(gercek)) {
        farklar.push(`${alan}: servis=${String(beklenen)} · toplu=${String(gercek)}`);
      }
    }

    expect(farklar).toEqual([]);
  });
});
