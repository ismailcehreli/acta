import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  askQuestion,
  closeConversation,
  replyToConversation,
} from "@/server/conversations/service";
import {
  closeFollowUp,
  openFollowUp,
  transferFollowUp,
} from "@/server/follow-ups/service";
import { collectScoreInput, expectedWorkDays } from "@/server/scoring/collect";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Skorun **paydası** (Görev 11.10).
//
// Payda üç şeye bağlı ve üçü de bu görevden önce kuruldu:
//
//   · `writesActivities: false` olan kişi hiç sayılmaz (§7.4).
//   · "Faaliyet beklenmiyor" dönemleri paydadan düşer (Görev 11.8).
//   · Hangi günlerin iş günü olduğunu birimin çalışma takvimi söyler
//     (Görev 11.9).
//
// Skorun en sona bırakılmasının sebebi buydu.

const DONEM_BAS = new Date("2026-08-01T00:00:00.000Z");
const DONEM_SON = new Date("2026-08-31T00:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kisi() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
  return { birim, kadir };
}

describe("beklenen iş günü", () => {
  it("hafta sonlarını saymaz", async () => {
    const { birim } = await kisi();

    const gunler = await expectedWorkDays(testDb, birim.id, DONEM_BAS, DONEM_SON);

    // Ağustos 2026: 21 iş günü (Pzt–Cum), hafta sonları hariç.
    expect(gunler.length).toBe(21);
  });

  it("resmî tatili düşer", async () => {
    const { birim } = await kisi();
    await testDb.holiday.create({
      data: { date: new Date("2026-08-19T00:00:00.000Z"), description: "Deneme" },
    });

    const gunler = await expectedWorkDays(testDb, birim.id, DONEM_BAS, DONEM_SON);

    expect(gunler.length).toBe(20);
    expect(gunler).not.toContain("2026-08-19");
  });

  // Birimin takvimi tatilde çalışıyorsa o gün paydada kalır (Görev 11.9).
  it("tatilde çalışan birimde tatil düşülmez", async () => {
    const { birim } = await kisi();
    await testDb.holiday.create({
      data: { date: new Date("2026-08-19T00:00:00.000Z"), description: "Deneme" },
    });
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: birim.id,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 8 * 60,
        workEndMinute: 18 * 60,
        worksOnHolidays: true,
      },
    });

    const gunler = await expectedWorkDays(testDb, birim.id, DONEM_BAS, DONEM_SON);

    expect(gunler).toContain("2026-08-19");
  });

  it("cumartesi çalışan birimde cumartesiler sayılır", async () => {
    const { birim } = await kisi();
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: birim.id,
        workingDays: [1, 2, 3, 4, 5, 6],
        workStartMinute: 8 * 60,
        workEndMinute: 18 * 60,
        worksOnHolidays: false,
      },
    });

    const gunler = await expectedWorkDays(testDb, birim.id, DONEM_BAS, DONEM_SON);

    expect(gunler.length).toBeGreaterThan(21);
  });
});

describe("izin dönemi paydadan düşer", () => {
  it("işaretli günler beklenen günlerden çıkar", async () => {
    const { kadir } = await kisi();
    await testDb.noActivityPeriod.create({
      data: {
        userId: kadir.id,
        markedById: kadir.id,
        startDate: new Date("2026-08-10T00:00:00.000Z"),
        endDate: new Date("2026-08-14T00:00:00.000Z"),
      },
    });

    const girdi = await collectScoreInput(testDb, { id: kadir.id, isSystemAdmin: false }, kadir.id, DONEM_BAS, DONEM_SON);

    // 21 iş günü − 5 iş günü izin = 16.
    expect(girdi.expectedDays).toBe(16);
  });

  // İptal edilmiş dönem **hiç yaşanmamış** sayılır (bulgu 7).
  it("iptal edilmiş dönem paydayı düşürmez", async () => {
    const { kadir } = await kisi();
    await testDb.noActivityPeriod.create({
      data: {
        userId: kadir.id,
        markedById: kadir.id,
        startDate: new Date("2026-08-10T00:00:00.000Z"),
        endDate: new Date("2026-08-14T00:00:00.000Z"),
        cancelledAt: new Date("2026-08-15T00:00:00.000Z"),
        cancelledById: kadir.id,
        cancellationReason: "Yanlış girildi",
      },
    });

    const girdi = await collectScoreInput(testDb, { id: kadir.id, isSystemAdmin: false }, kadir.id, DONEM_BAS, DONEM_SON);

    expect(girdi.expectedDays).toBe(21);
  });
});

describe("yazılan gün sayısı", () => {
  it("aynı gün iki kayıt bir gün sayılır", async () => {
    const { kadir } = await kisi();
    await createActivity(kadir, {
      title: "Sabah",
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
    });
    await createActivity(kadir, {
      title: "Öğleden sonra",
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
    });

    const girdi = await collectScoreInput(testDb, { id: kadir.id, isSystemAdmin: false }, kadir.id, DONEM_BAS, DONEM_SON);

    expect(girdi.writtenDays).toBe(1);
    expect(girdi.writtenCount).toBe(2);
  });

  it("iptal edilmiş kayıt sayılmaz", async () => {
    const { kadir } = await kisi();
    await createActivity(kadir, {
      title: "İptal",
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
      approvalStatus: "CANCELLED",
    });

    const girdi = await collectScoreInput(testDb, { id: kadir.id, isSystemAdmin: false }, kadir.id, DONEM_BAS, DONEM_SON);

    expect(girdi.writtenDays).toBe(0);
  });

  it("dönem dışındaki kayıt sayılmaz", async () => {
    const { kadir } = await kisi();
    await createActivity(kadir, {
      title: "Temmuz",
      activityDate: new Date("2026-07-20T00:00:00.000Z"),
    });

    const girdi = await collectScoreInput(testDb, { id: kadir.id, isSystemAdmin: false }, kadir.id, DONEM_BAS, DONEM_SON);

    expect(girdi.writtenDays).toBe(0);
  });
});

// Onay süresi boyutunun testleri **`onay-turu.test.ts`** dosyasında ve orada
// yalnız üretim servisleri çağrılıyor. Buradaki eski testler kararı elle
// kuruyordu: `approvalSubmittedAt` ile `approvalDecidedAt` birlikte dolu bir
// `APPROVED` satır üretimde hiç oluşmaz — karar servisi gönderim anını
// boşaltır. Yeşil kalan o testler yalnız imkânsız bir durumun
// hesaplanabildiğini kanıtlıyordu (denetim 23.08.2026, P3-R2-1).

// ——— Takip disiplini (denetim 23.08.2026, bulgu 6 ve P3-1/P3-2) ———
//
// Tasarımda boyut "gelen soruları cevaplama, **açtığı** maddeleri kapatma"
// (satır 559). Üç şey yanlıştı:
//
//   · `conversation` tablosu hiç sorgulanmıyordu.
//   · Maddeler devredilebilir `ownerId` ile ilişkilendiriliyordu; kişinin
//     açıp devrettiği madde ölçümden düşüyor, başkasının ona devrettiği
//     madde onun karnesine yazılıyordu.
//   · Konuşmada yalnız **güncel** `responsibleId` okunuyordu. Sorumluluk
//     cevapla el değiştirdiği için (§9.2) zamanında cevaplanan soru pay ve
//     paydadan birlikte kayboluyordu: **doğru cevap vermek hiçbir şey
//     getirmiyordu.**
//
// Bu bölüm gerçek servisleri çağırıyor (`askQuestion`, `replyToConversation`,
// `openFollowUp`, `transferFollowUp`, `closeFollowUp`). Konuşmayı son
// durumunda elle kurmak, tam da ölçülmesi gereken akışı atlamak olurdu.

describe("takip disiplini", () => {
  async function ekipVeKayit() {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const mudur = await createUser(birim.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
    });
    const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
    const kayit = await createActivity(kadir, {
      activityDate: new Date("2026-07-01T00:00:00.000Z"),
    });
    return { mudur, kadir, kayit };
  }

  const bakan = (id: string) => ({ id, isSystemAdmin: false });

  const girdiAl = (kisiId: string, until?: Date) =>
    collectScoreInput(testDb, bakan(kisiId), kisiId, DONEM_BAS, DONEM_SON, until);

  async function soruSor(kayitId: string, soranId: string, an: string) {
    const sonuc = await askQuestion(
      testDb,
      bakan(soranId),
      { activityId: kayitId, text: "Bu kalıp neden bekledi?" },
      new Date(an),
    );
    if (!sonuc.ok) throw new Error(`soru açılamadı: ${sonuc.message}`);
    return sonuc.value;
  }

  async function cevapla(konusmaId: string, kisiId: string, an: string) {
    const sonuc = await replyToConversation(
      testDb,
      bakan(kisiId),
      { conversationId: konusmaId, text: "Kalıp bakımdaydı." },
      new Date(an),
    );
    if (!sonuc.ok) throw new Error(`cevap yazılamadı: ${sonuc.message}`);
  }

  async function maddeAc(kayitId: string, acanId: string, an: string) {
    const sonuc = await openFollowUp(
      testDb,
      bakan(acanId),
      { activityId: kayitId, nextStep: "Tedarikçiyle görüş" },
      new Date(an),
    );
    if (!sonuc.ok) throw new Error(`madde açılamadı: ${sonuc.message}`);
    return sonuc.item;
  }

  it("zamanında cevaplanan soru başarı sayılır", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    const konusma = await soruSor(kayit.id, mudur.id, "2026-08-03T09:00:00.000Z");
    await cevapla(konusma.id, kadir.id, "2026-08-04T09:00:00.000Z");

    const girdi = await girdiAl(kadir.id);

    // Cevap verildiği için sorumluluk karşı tarafa geçti; ölçüm bunu
    // **başarı** olarak görmeli, yok saymamalı.
    expect(girdi.followUpTotal).toBe(1);
    expect(girdi.followUpHandled).toBe(1);
  });

  it("cevaplanmayan soru başarısızlık sayılır", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    await soruSor(kayit.id, mudur.id, "2026-08-03T09:00:00.000Z");

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(1);
    expect(girdi.followUpHandled).toBe(0);
  });

  it("eşiği aşarak verilen cevap başarı sayılmaz", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    const konusma = await soruSor(kayit.id, mudur.id, "2026-08-03T09:00:00.000Z");
    // 3 Ağustos pazartesi → 10 Ağustos pazartesi: 5 iş günü, eşik 3.
    await cevapla(konusma.id, kadir.id, "2026-08-10T09:00:00.000Z");

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(1);
    expect(girdi.followUpHandled).toBe(0);
  });

  it("soru soran taraf da cevabı beklerken sayılır", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    const konusma = await soruSor(kayit.id, mudur.id, "2026-08-03T09:00:00.000Z");
    await cevapla(konusma.id, kadir.id, "2026-08-04T09:00:00.000Z");

    // Cevaptan sonra sıra sorana geçti ve soran hiçbir şey yapmadı.
    const girdi = await girdiAl(mudur.id);

    expect(girdi.followUpTotal).toBe(1);
    expect(girdi.followUpHandled).toBe(0);
  });

  it("yeni gelen soru henüz gecikmiş sayılmaz", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    await soruSor(kayit.id, mudur.id, "2026-08-28T09:00:00.000Z");

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(1);
    expect(girdi.followUpHandled).toBe(1);
  });

  it("önceki dönemde açılıp cevaplanmış soru bu döneme taşınmaz", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    const konusma = await soruSor(kayit.id, mudur.id, "2026-07-02T09:00:00.000Z");
    await cevapla(konusma.id, kadir.id, "2026-07-03T09:00:00.000Z");

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(0);
  });

  it("kişinin açtığı madde devredilse de onun karnesinde kalır", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    const madde = await maddeAc(kayit.id, kadir.id, "2026-08-03T09:00:00.000Z");

    await transferFollowUp(
      testDb,
      bakan(kadir.id),
      madde.id,
      mudur.id,
      new Date("2026-08-04T09:00:00.000Z"),
    );
    await closeFollowUp(
      testDb,
      bakan(mudur.id),
      madde.id,
      "Tedarikçi teyit etti",
      new Date("2026-08-05T09:00:00.000Z"),
    );

    // Tasarım "**açtığı** maddeleri kapatma" diyor: madde açanın karnesinde.
    const acan = await girdiAl(kadir.id);
    expect(acan.followUpTotal).toBe(1);
    expect(acan.followUpHandled).toBe(1);

    // Devralan kişinin karnesine yazılmaz; devir geçmiş performansın sahibini
    // değiştirmez.
    const devralan = await girdiAl(mudur.id);
    expect(devralan.followUpTotal).toBe(0);
  });

  it("kapatılmayan madde açanın payını düşürür", async () => {
    const { kadir, kayit } = await ekipVeKayit();
    await maddeAc(kayit.id, kadir.id, "2026-08-03T09:00:00.000Z");

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(1);
    expect(girdi.followUpHandled).toBe(0);
  });

  it("yeni açılmış madde henüz gecikmiş sayılmaz", async () => {
    const { kadir, kayit } = await ekipVeKayit();
    await maddeAc(kayit.id, kadir.id, "2026-08-28T09:00:00.000Z");

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(1);
    expect(girdi.followUpHandled).toBe(1);
  });

  it("önceki dönemde açılıp kapanmış madde bu dönemin paydasına girmez", async () => {
    const { kadir, kayit } = await ekipVeKayit();
    const madde = await maddeAc(kayit.id, kadir.id, "2026-07-01T09:00:00.000Z");
    await closeFollowUp(
      testDb,
      bakan(kadir.id),
      madde.id,
      "Bitti",
      new Date("2026-07-20T09:00:00.000Z"),
    );

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(0);
  });

  it("soru ve madde birlikte sayılır", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    const madde = await maddeAc(kayit.id, kadir.id, "2026-08-03T09:00:00.000Z");
    await closeFollowUp(
      testDb,
      bakan(kadir.id),
      madde.id,
      "Bitti",
      new Date("2026-08-05T09:00:00.000Z"),
    );
    await soruSor(kayit.id, mudur.id, "2026-08-03T09:00:00.000Z");

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(2);
    expect(girdi.followUpHandled).toBe(1);
  });

  // **Hareket gören madde hareketsiz sayılmaz** (denetim 23.08.2026,
  // P3-R2-3). Ana tasarım (§11.1) "hareketsiz kaç gün" hesabını **son
  // hareketten** yapıyor ve üretim `touchFollowUps` tam bu yüzden faaliyete
  // yorum/cevap geldiğinde maddeyi tazeliyor. Skor açılış anından ölçünce
  // takip ekranı "yakın zamanda hareket gördü" derken skor "uzun süredir ele
  // alınmadı" diyordu.
  it("dönem içinde hareket gören açık madde ele alınmış sayılır", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    await maddeAc(kayit.id, kadir.id, "2026-08-03T09:00:00.000Z");

    // 28 Ağustos'ta faaliyete soru geldi: madde hareket gördü.
    await soruSor(kayit.id, mudur.id, "2026-08-28T09:00:00.000Z");

    const girdi = await girdiAl(kadir.id);
    const maddeSayisi = girdi.followUpTotal - 1; // konuşma da paydada

    expect(maddeSayisi).toBe(1);
    // Madde ele alınmış, soru da henüz gecikmemiş: ikisi de payda.
    expect(girdi.followUpHandled).toBe(2);
  });

  it("eylüldeki hareket ağustosun madde puanını iyileştirmez", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    await maddeAc(kayit.id, kadir.id, "2026-08-03T09:00:00.000Z");

    // Hareket eylülde: ağustos karnesi bunu bilmemeli.
    await soruSor(kayit.id, mudur.id, "2026-09-10T09:00:00.000Z");

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(1);
    expect(girdi.followUpHandled).toBe(0);
  });

  // **Kapatma cevap değildir** (P3-R2-2). Soran konuşmayı her zaman
  // kapatabilir; sistem yöneticisi de gerekçeyle idari kapatabilir. Hiç cevap
  // yazmayan kişiye bunu başarı yazmak, puanı **başkasının** eylemine
  // bağlardı. Ürün sahibi kararı (23.08.2026): cevapsız kapanış paydadan
  // düşer — ne başarı ne başarısızlık.
  it("cevapsız kapatılan soru paydadan düşer", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    const konusma = await soruSor(kayit.id, mudur.id, "2026-08-03T09:00:00.000Z");

    // Soran ertesi gün kapatıyor; yazar hiç cevap yazmadı.
    const kapanis = await closeConversation(
      testDb,
      bakan(mudur.id),
      konusma.id,
      new Date("2026-08-04T09:00:00.000Z"),
    );
    if (!kapanis.ok) throw new Error(`kapatılamadı: ${kapanis.message}`);

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(0);
    expect(girdi.followUpHandled).toBe(0);
  });

  it("cevap yazıldıktan sonra kapanan soru başarı sayılır", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    const konusma = await soruSor(kayit.id, mudur.id, "2026-08-03T09:00:00.000Z");
    await cevapla(konusma.id, kadir.id, "2026-08-04T09:00:00.000Z");
    await closeConversation(
      testDb,
      bakan(mudur.id),
      konusma.id,
      new Date("2026-08-05T09:00:00.000Z"),
    );

    const girdi = await girdiAl(kadir.id);

    expect(girdi.followUpTotal).toBe(1);
    expect(girdi.followUpHandled).toBe(1);
  });
});

// ——— Dönem kapandıktan sonra geçmiş değişmez (P3-2) ———
//
// Dönemsel skorun temel özelliği dönem kapandıktan sonra geçmişin sabit
// kalmasıdır. Hesap **güncel** durumdan (maddenin `status`/`lastMovedAt`
// alanları, konuşmanın `responsibleId`si, sınırsız "son mesaj") okunuyordu:
// eylülde gelen bir hareket ağustosun başarısızlığını başarıya çeviriyordu ve
// aynı kişinin kendi donmuş satırı ile yöneticisinin gördüğü yeniden hesap
// ayrışabiliyordu.

describe("kapanmış dönem sonradan değişmez", () => {
  async function ekipVeKayit() {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const mudur = await createUser(birim.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
    });
    const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
    const kayit = await createActivity(kadir, {
      activityDate: new Date("2026-07-01T00:00:00.000Z"),
    });
    return { mudur, kadir, kayit };
  }

  const bakan = (id: string) => ({ id, isSystemAdmin: false });
  const agustos = (kisiId: string) =>
    collectScoreInput(testDb, bakan(kisiId), kisiId, DONEM_BAS, DONEM_SON);

  it("eylülde gelen hareket ağustosun madde puanını değiştirmez", async () => {
    const { kadir, kayit } = await ekipVeKayit();
    const acildi = await openFollowUp(
      testDb,
      bakan(kadir.id),
      { activityId: kayit.id, nextStep: "Bekliyor" },
      new Date("2026-08-03T09:00:00.000Z"),
    );
    if (!acildi.ok) throw new Error("madde açılamadı");

    const once = await agustos(kadir.id);
    expect(once.followUpHandled).toBe(0);

    // Eylülde madde kapatılıyor: ağustosun karnesi değişmemeli.
    await closeFollowUp(
      testDb,
      bakan(kadir.id),
      acildi.item.id,
      "Eylülde bitti",
      new Date("2026-09-05T09:00:00.000Z"),
    );

    const sonra = await agustos(kadir.id);

    expect(sonra.followUpTotal).toBe(once.followUpTotal);
    expect(sonra.followUpHandled).toBe(0);
  });

  it("ay sonunda henüz gecikmemiş soru, eylüldeki geç cevapla geriye dönük gecikmez", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    // 28 Ağustos cuma soruldu: ay bittiğinde daha 1 iş günü geçmişti.
    const konusma = await askQuestion(
      testDb,
      bakan(mudur.id),
      { activityId: kayit.id, text: "Ay sonu sorusu" },
      new Date("2026-08-28T09:00:00.000Z"),
    );
    if (!konusma.ok) throw new Error("soru açılamadı");

    const once = await agustos(kadir.id);
    expect(once.followUpHandled).toBe(1);

    // Cevap eylülün 20'sinde geldi. Ağustos karnesi bunu **bilmemeli**:
    // dönem kapandığında borç henüz gecikmemişti.
    await replyToConversation(
      testDb,
      bakan(kadir.id),
      { conversationId: konusma.value.id, text: "Geç cevap" },
      new Date("2026-09-20T09:00:00.000Z"),
    );

    const sonra = await agustos(kadir.id);

    expect(sonra.followUpTotal).toBe(1);
    expect(sonra.followUpHandled).toBe(1);
  });

  it("eylülde verilen cevap ağustosun soru puanını değiştirmez", async () => {
    const { mudur, kadir, kayit } = await ekipVeKayit();
    const konusma = await askQuestion(
      testDb,
      bakan(mudur.id),
      { activityId: kayit.id, text: "Soru" },
      new Date("2026-08-03T09:00:00.000Z"),
    );
    if (!konusma.ok) throw new Error("soru açılamadı");

    const once = await agustos(kadir.id);
    expect(once.followUpHandled).toBe(0);

    await replyToConversation(
      testDb,
      bakan(kadir.id),
      { conversationId: konusma.value.id, text: "Geç cevap" },
      new Date("2026-09-05T09:00:00.000Z"),
    );

    const sonra = await agustos(kadir.id);

    expect(sonra.followUpTotal).toBe(1);
    expect(sonra.followUpHandled).toBe(0);
  });
});

// ——— Dönem sınırındaki zaman damgaları (P3-3) ———
//
// `to` dönem sonunun **00:00** anıydı ve `activityDate` için (gün alanı)
// doğru çalışıyordu; ama karar, soru ve madde anları **zaman damgasıdır**.
// `lte: to` karşılaştırması ayın son gününün 00:00'dan sonraki bütün
// işlemlerini dışarıda bırakıyordu.

describe("dönem sınırındaki zaman damgaları", () => {
  async function ekip() {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({
      name: "Kalıphane",
      parentId: kok.id,
      requiresApproval: true,
    });
    const mudur = await createUser(birim.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
    });
    const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
    return { mudur, kadir };
  }

  const bakan = (id: string) => ({ id, isSystemAdmin: false });

  it("ayın son günü açılan madde döneme girer", async () => {
    const { kadir } = await ekip();
    const kayit = await createActivity(kadir, {
      activityDate: new Date("2026-08-03T00:00:00.000Z"),
    });

    const acildi = await openFollowUp(
      testDb,
      bakan(kadir.id),
      { activityId: kayit.id, nextStep: "Son gün" },
      new Date("2026-08-31T12:00:00.000Z"),
    );
    if (!acildi.ok) throw new Error("madde açılamadı");

    const girdi = await collectScoreInput(
      testDb,
      bakan(kadir.id),
      kadir.id,
      DONEM_BAS,
      DONEM_SON,
    );

    expect(girdi.followUpTotal).toBe(1);
  });
});

// Pay paydayı aşamaz (denetim 23.08.2026, bulgu 10 çalışması sırasında
// bulundu; kabul ölçümünün skor dönemi üretimi bu yüzden çöktü).
//
// Payda **beklenen iş günleri**: hafta sonu, tatil ve "faaliyet beklenmiyor"
// dönemleri düşüyor. Pay ise kaydın olduğu **her günü** sayıyordu. Kişi
// izindeyken, hafta sonunda ya da tatilde bir kayıt yazdığında pay büyüyor,
// payda küçülüyor ve oran %100'ü aşıyordu.
//
// Sonuç yalnız yanlış bir sayı değil: `UserScorePeriod_valid_days` kısıtı
// `writtenDays > expectedDays` satırını reddediyor ve **dönem kapanış işçisi
// hata veriyor** — o ayın hiçbir kişisi için skor yazılamıyor.
describe("pay paydayı aşamaz", () => {
  async function yazdir(kadir: { id: string; orgUnitId: string }, gunler: string[]) {
    for (const gun of gunler) {
      await createActivity(kadir, { activityDate: new Date(`${gun}T00:00:00.000Z`) });
    }
  }

  const bakan = (id: string) => ({ id, isSystemAdmin: false });

  it("izinli günde yazılan kayıt payı büyütmez", async () => {
    const { kadir } = await kisi();

    // 3–7 Ağustos izinli; payda 21'den 16'ya iner.
    await testDb.noActivityPeriod.create({
      data: {
        userId: kadir.id,
        startDate: new Date("2026-08-03T00:00:00.000Z"),
        endDate: new Date("2026-08-07T00:00:00.000Z"),
        markedById: kadir.id,
      },
    });

    // Kişi izindeyken de yazmış: gerçek hayatta olur, hele izin geriye
    // dönük işaretlendiyse.
    await yazdir(kadir, [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-10",
      "2026-08-11",
    ]);

    const girdi = await collectScoreInput(
      testDb,
      bakan(kadir.id),
      kadir.id,
      DONEM_BAS,
      DONEM_SON,
    );

    expect(girdi.expectedDays).toBe(16);
    // İzinli beş gün paya girmemeli; kalan iki gün sayılır.
    expect(girdi.writtenDays).toBe(2);
    expect(girdi.writtenDays).toBeLessThanOrEqual(girdi.expectedDays);
  });

  it("hafta sonunda yazılan kayıt payı büyütmez", async () => {
    const { kadir } = await kisi();

    // 1 ve 2 Ağustos 2026 cumartesi ve pazar; birim Pzt–Cum çalışıyor.
    await yazdir(kadir, ["2026-08-01", "2026-08-02", "2026-08-03"]);

    const girdi = await collectScoreInput(
      testDb,
      bakan(kadir.id),
      kadir.id,
      DONEM_BAS,
      DONEM_SON,
    );

    expect(girdi.expectedDays).toBe(21);
    expect(girdi.writtenDays).toBe(1);
  });

  it("resmî tatilde yazılan kayıt payı büyütmez", async () => {
    const { birim, kadir } = await kisi();
    void birim;
    await testDb.holiday.create({
      data: { date: new Date("2026-08-19T00:00:00.000Z"), description: "Deneme" },
    });

    await yazdir(kadir, ["2026-08-19", "2026-08-20"]);

    const girdi = await collectScoreInput(
      testDb,
      bakan(kadir.id),
      kadir.id,
      DONEM_BAS,
      DONEM_SON,
    );

    expect(girdi.expectedDays).toBe(20);
    expect(girdi.writtenDays).toBe(1);
  });

  it("her iş gününde yazan kişide pay paydaya eşit", async () => {
    const { kadir } = await kisi();

    const isGunleri = await expectedWorkDays(testDb, kadir.orgUnitId, DONEM_BAS, DONEM_SON);
    await yazdir(kadir, isGunleri);

    const girdi = await collectScoreInput(
      testDb,
      bakan(kadir.id),
      kadir.id,
      DONEM_BAS,
      DONEM_SON,
    );

    expect(girdi.writtenDays).toBe(girdi.expectedDays);
  });
});
