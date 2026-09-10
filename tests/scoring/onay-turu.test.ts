import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  approveActivity,
  rejectActivity,
  requestChanges,
} from "@/server/activities/approval";
import { createActivity, updateActivity } from "@/server/activities/write";
import { collectScoreInput } from "@/server/scoring/collect";

import { createApprovalReason, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Onay süresi **gerçek onay akışından** ölçülür (denetim 23.08.2026,
// P3-R2-1).
//
// Ölçüm `Activity.approvalSubmittedAt` ve `approvalDecidedAt` sütunlarına
// bakıyordu. Üretimdeki `approveActivity`, `requestChanges` ve
// `rejectActivity` karar anını yazarken `approvalSubmittedAt` alanını
// **boşaltıyor**: o sütun "şu an ne zamandır bekliyor" demek. Sonuç, üretimden
// geçen her kararın ölçümden düşmesi ve yöneticinin onay süresi ağırlığının
// tamamını almasıydı.
//
// Testim bunu görmedi çünkü satırı **elle** kuruyordu: iki zamanı birden dolu
// bir `APPROVED` kayıt üretimde hiç oluşmaz. Bu dosya yalnız üretim
// servislerini çağırıyor.

const DONEM_BAS = new Date("2026-08-01T00:00:00.000Z");
const DONEM_SON = new Date("2026-08-31T00:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

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

  return {
    mudur,
    kadir,
    birim,
    yaz: async (gun: string, an: string) => {
      const sonuc = await createActivity(
        testDb,
        { id: kadir.id, orgUnitId: birim.id, requiresApproval: true },
        {
          activityDate: gun,
          title: "Kalıp bakımı yapıldı",
          description: "Kalıp söküldü, temizlendi ve yeniden kuruldu.",
          targetDepartmentIds: [birim.id],
        },
        new Date(an),
      );
      if (!sonuc.ok) throw new Error(`faaliyet yazılamadı: ${sonuc.error}`);
      return sonuc.activity;
    },
  };
}

const bakan = (id: string) => ({ id, isSystemAdmin: false });

const girdiAl = (kisiId: string) =>
  collectScoreInput(testDb, bakan(kisiId), kisiId, DONEM_BAS, DONEM_SON);

describe("onay süresi gerçek akıştan ölçülür", () => {
  it("zamanında verilen karar ölçülebiliyor", async () => {
    const { mudur, yaz } = await ekip();
    const kayit = await yaz("2026-08-03", "2026-08-03T08:00:00.000Z");

    const karar = await approveActivity(
      testDb,
      mudur.id,
      kayit.id,
      new Date("2026-08-04T09:00:00.000Z"),
    );
    expect(karar.ok).toBe(true);

    const girdi = await girdiAl(mudur.id);

    expect(girdi.decidedCount).toBe(1);
    expect(girdi.decidedOnTimeCount).toBe(1);
  });

  it("geç verilen karar ölçülüyor ve zamanında sayılmıyor", async () => {
    const { mudur, yaz } = await ekip();
    const kayit = await yaz("2026-08-03", "2026-08-03T08:00:00.000Z");

    // Pazartesi gönderildi, ertesi pazartesi onaylandı: 5 iş günü, eşik 2.
    await approveActivity(
      testDb,
      mudur.id,
      kayit.id,
      new Date("2026-08-10T09:00:00.000Z"),
    );

    const girdi = await girdiAl(mudur.id);

    expect(girdi.decidedCount).toBe(1);
    expect(girdi.decidedOnTimeCount).toBe(0);
  });

  it("düzeltme ve yeniden gönderim iki ayrı tur sayılır", async () => {
    const { mudur, kadir, birim, yaz } = await ekip();
    const kayit = await yaz("2026-08-05", "2026-08-05T08:00:00.000Z");
    const gerekce = await createApprovalReason("CHANGES_REQUESTED");

    // 1. tur: hızlı düzeltme talebi.
    const talep = await requestChanges(
      testDb,
      mudur.id,
      kayit.id,
      { reasonId: gerekce.id },
      new Date("2026-08-05T10:00:00.000Z"),
    );
    expect(talep.ok).toBe(true);

    // Yazar düzeltip yeniden gönderiyor: iş yeniden müdürün önünde.
    const duzeltme = await updateActivity(
      testDb,
      kadir.id,
      {
        id: kayit.id,
        activityDate: "2026-08-05",
        title: "Kalıp bakımı yapıldı ve ölçüldü",
        description: "Kalıp söküldü, temizlendi, ölçüldü ve yeniden kuruldu.",
        targetDepartmentIds: [birim.id],
      },
      new Date("2026-08-05T11:00:00.000Z"),
    );
    if (!duzeltme.ok) throw new Error(`düzeltme reddedildi: ${duzeltme.error}`);

    // 2. tur: bu kez geç karar (5 iş günü).
    await approveActivity(
      testDb,
      mudur.id,
      kayit.id,
      new Date("2026-08-12T09:00:00.000Z"),
    );

    const girdi = await girdiAl(mudur.id);

    // Tek sütun iki turu taşıyamazdı; iki karar da ölçülüyor.
    expect(girdi.decidedCount).toBe(2);
    expect(girdi.decidedOnTimeCount).toBe(1);
  });

  it("karar verilmemiş tur ölçüme girmez", async () => {
    const { mudur, yaz } = await ekip();
    await yaz("2026-08-03", "2026-08-03T08:00:00.000Z");

    const girdi = await girdiAl(mudur.id);

    expect(girdi.decidedCount).toBe(0);
  });
});

// Açık tur yokluğu **bekleyen** kayıtta yutulamaz (denetim
// 23.08.2026, P3-R3-2).
//
// `rejectActivity` hem bekleyen hem düzeltme istenmiş kaydı kabul ediyor ama
// "açık tur yoksa atla" seçeneğini ikisine birden veriyordu. Bekleyen kayıtta
// tur zorunludur: yokluğunu yutmak, kararın geçmişe hiç yazılmaması ve
// yöneticinin ölçülmediği bir boyuttan tam puan alması demek.
describe("ret yolunda tur zorunluluğu", () => {
  it("düzeltme istenmiş kayıt tur aranmadan reddedilir", async () => {
    const { mudur, yaz } = await ekip();
    const kayit = await yaz("2026-08-05", "2026-08-05T08:00:00.000Z");
    const duzeltme = await createApprovalReason("CHANGES_REQUESTED");

    await requestChanges(
      testDb,
      mudur.id,
      kayit.id,
      { reasonId: duzeltme.id },
      new Date("2026-08-05T10:00:00.000Z"),
    );

    // İş yazarın önünde: açık tur yok, ama ret geçmeli (19.08.2026 kararı).
    const ret = await createApprovalReason("REJECTED");
    const sonuc = await rejectActivity(
      testDb,
      mudur.id,
      kayit.id,
      { reasonId: ret.id },
      new Date("2026-08-06T09:00:00.000Z"),
    );

    expect(sonuc.ok).toBe(true);
  });

  it("bekleyen kayıtta açık tur yoksa ret işlemi düşer", async () => {
    const { mudur, yaz } = await ekip();
    const kayit = await yaz("2026-08-05", "2026-08-05T08:00:00.000Z");

    // Uygulama katmanı atlanarak tur siliniyor: bozuk veri taklit ediliyor.
    // (Silme yasağı örnek veri kapısıyla açılıyor; testin konusu o değil.)
    await testDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'evet'");
      await tx.approvalRound.deleteMany({ where: { activityId: kayit.id } });
    });

    const ret = await createApprovalReason("REJECTED");
    await expect(
      rejectActivity(
        testDb,
        mudur.id,
        kayit.id,
        { reasonId: ret.id },
        new Date("2026-08-06T09:00:00.000Z"),
      ),
    ).rejects.toThrow(/Onay turu bulunamadı/);

    // İşlem geri alındı: faaliyet hâlâ bekliyor.
    const taze = await testDb.activity.findUniqueOrThrow({ where: { id: kayit.id } });
    expect(taze.approvalStatus).toBe("PENDING_APPROVAL");
  });
});
