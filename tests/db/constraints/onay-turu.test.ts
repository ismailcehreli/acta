import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Onay turunun veritabanı kısıtları (denetim 23.08.2026, P3-R2-1).
//
// İş kuralı uygulama katmanında da duruyor; buradaki testler kısıtın
// **uygulama devre dışıyken de** geçerli olduğunu kanıtlıyor. Kısıtın değeri
// tam olarak budur: elle yazılmış bir SQL, bozuk bir betik ya da ileride
// eklenen ikinci bir yazma yolu da bu satırlardan geçemez.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kayit() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({
    name: "Kalıphane",
    parentId: kok.id,
    requiresApproval: true,
  });
  const mudur = await createUser(birim.id, {
    fullName: "Müdür",
    isUnitManager: true,
  });
  const kadir = await createUser(birim.id, { fullName: "Kadir" });
  const faaliyet = await createActivity(kadir, {
    approvalStatus: "PENDING_APPROVAL",
    approverId: mudur.id,
    approvalSubmittedAt: new Date("2026-08-03T08:00:00.000Z"),
  });

  return { faaliyet, mudur };
}

describe("onay turu kısıtları", () => {
  it("aynı faaliyette iki açık tur olamaz", async () => {
    const { faaliyet } = await kayit();

    // Birinci tur kayıtla birlikte doğdu (fixture üretimi taklit ediyor).
    // İkinci açık tur: "iş şu an kimin önünde" sorusunun iki cevabı olamaz.
    // Uygulama katmanı atlanıyor; kısıt veritabanında duruyor.
    await expect(
      testDb.$executeRaw`
        INSERT INTO "ApprovalRound" ("id", "activityId", "roundNo", "submittedAt")
        VALUES (gen_random_uuid(), ${faaliyet.id}, 2, '2026-08-04T08:00:00Z')
      `,
      // Tekillik ihlali `23505` ile geliyor ve anahtar **yalnız
      // `activityId`**: bu sütun üzerinde tek başına tekil olan tek nesne,
      // açık turu koruyan kısmi indekstir.
    ).rejects.toThrow(/23505[\s\S]*Key \("activityId"\)/);
  });

  it("karara bağlanmış tur karar sahibini ister", async () => {
    const { faaliyet } = await kayit();

    await expect(
      testDb.$executeRaw`
        INSERT INTO "ApprovalRound" ("id", "activityId", "roundNo", "submittedAt", "decidedAt")
        VALUES (gen_random_uuid(), ${faaliyet.id}, 1, '2026-08-03T08:00:00Z', '2026-08-04T09:00:00Z')
      `,
    ).rejects.toThrow(/ApprovalRound_karar_butunlugu/);
  });

  it("karar gönderimden önce olamaz", async () => {
    const { faaliyet, mudur } = await kayit();

    await expect(
      testDb.$executeRaw`
        INSERT INTO "ApprovalRound"
          ("id", "activityId", "roundNo", "submittedAt", "decidedAt", "decidedById", "decision")
        VALUES (gen_random_uuid(), ${faaliyet.id}, 1,
                '2026-08-04T09:00:00Z', '2026-08-03T08:00:00Z', ${mudur.id}, 'APPROVED')
      `,
    ).rejects.toThrow(/ApprovalRound_karar_gonderimden_sonra/);
  });

  it("karar verilmiş tur ikinci kez açık sayılmaz", async () => {
    const { faaliyet, mudur } = await kayit();

    // Açık turu karara bağla: artık kısmi indeksin dışında.
    await testDb.approvalRound.updateMany({
      where: { activityId: faaliyet.id, decidedAt: null },
      data: {
        decidedAt: new Date("2026-08-04T09:00:00.000Z"),
        decidedById: mudur.id,
        decision: "CHANGES_REQUESTED",
      },
    });

    // Karara bağlanmış tur kısmi indeksin dışında: yeni tur açılabilir.
    const ikinci = await testDb.approvalRound.create({
      data: {
        activityId: faaliyet.id,
        roundNo: 2,
        submittedAt: new Date("2026-08-05T08:00:00.000Z"),
      },
    });

    expect(ikinci.roundNo).toBe(2);
  });

  // ——— Değişmezlik (denetim 23.08.2026, P3-R3-1) ———
  //
  // Tablo "değişmez geçmiş" diye tanımlanmıştı ama veritabanı bunu
  // zorlamıyordu: satır silinebiliyor, kapanmış tur yeniden yazılabiliyor ve
  // iptal bir "karar" olarak kabul ediliyordu. Onay süresi skorunun tek
  // kanıtı bu tablo; bir bakım betiği geçmişi sessizce yeniden yazabilirdi.

  it("onay turu silinemez", async () => {
    const { faaliyet } = await kayit();

    await expect(
      testDb.$executeRaw`DELETE FROM "ApprovalRound" WHERE "activityId" = ${faaliyet.id}`,
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("karara bağlanmış tur yeniden yazılamaz", async () => {
    const { faaliyet, mudur } = await kayit();

    await testDb.approvalRound.updateMany({
      where: { activityId: faaliyet.id, decidedAt: null },
      data: {
        decidedAt: new Date("2026-08-04T09:00:00.000Z"),
        decidedById: mudur.id,
        decision: "APPROVED",
      },
    });

    await expect(
      testDb.$executeRaw`
        UPDATE "ApprovalRound"
        SET "decidedAt" = '2026-08-05T09:00:00Z'
        WHERE "activityId" = ${faaliyet.id}
      `,
    ).rejects.toThrow(/APPROVAL_ROUND_IMMUTABLE/);
  });

  it("turun gönderim anı değiştirilemez", async () => {
    const { faaliyet } = await kayit();

    await expect(
      testDb.$executeRaw`
        UPDATE "ApprovalRound"
        SET "submittedAt" = '2026-07-01T09:00:00Z',
            "decidedAt" = '2026-08-04T09:00:00Z'
        WHERE "activityId" = ${faaliyet.id}
      `,
    ).rejects.toThrow(/APPROVAL_ROUND_IMMUTABLE/);
  });

  it("iptal bir onay kararı olarak yazılamaz", async () => {
    const { faaliyet, mudur } = await kayit();

    await expect(
      testDb.$executeRaw`
        UPDATE "ApprovalRound"
        SET "decidedAt" = '2026-08-04T09:00:00Z',
            "decidedById" = ${mudur.id},
            "decision" = 'CANCELLED'
        WHERE "activityId" = ${faaliyet.id}
      `,
    ).rejects.toThrow(/ApprovalRound_gecerli_karar/);
  });
});
