import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  decideNoActivityPeriod,
  isNoActivityDay,
  listTeamAbsences,
  markNoActivityPeriod,
  markOwnNoActivityPeriod,
  cancelNoActivityPeriod,
} from "@/server/absence/service";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// "Faaliyet beklenmiyor" işareti (§12.1). Kim işaretler: kişinin yöneticisi.
// Yetki ağaçtan gelir; kapsam dışı birine işaret konamaz (§18.4).

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const gm = await createOrgUnit({ name: "Genel Müdürlük", parentId: root.id });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: gm.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: gm.id });

  const genelMudur = await createUser(gm.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const kalipMudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kalipCalisan = await createUser(kaliphane.id, {
    fullName: "Kalıphane Çalışanı",
  });
  const planlamaMudur = await createUser(planlama.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });
  // Akran yöneticinin de bir astı olmalı: aksi hâlde "kaldıramaz" iddiası,
  // ekibi boş olduğu için de geçerdi ve yetki kontrolünü sınamazdı.
  const planlamaCalisan = await createUser(planlama.id, {
    fullName: "Planlama Çalışanı",
  });

  return { genelMudur, kalipMudur, kalipCalisan, planlamaMudur, planlamaCalisan };
}

describe("işaret koyma yetkisi", () => {
  it("yönetici kendi astı için işaret koyar", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();

    const sonuc = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    expect(await testDb.noActivityPeriod.count()).toBe(1);
  });

  it("akranın astına işaret konamaz", async () => {
    const { planlamaMudur, kalipCalisan } = await sirket();

    const sonuc = await markNoActivityPeriod(
      testDb,
      planlamaMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("not_subordinate");
    expect(await testDb.noActivityPeriod.count()).toBe(0);
  });

  it("astı olmayan kimse için işaret koyamaz", async () => {
    const { kalipCalisan, kalipMudur } = await sirket();

    const sonuc = await markNoActivityPeriod(
      testDb,
      kalipCalisan.id,
      { userId: kalipMudur.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("not_subordinate");
  });

  it("üst kademe alt departmandaki çalışan için koyamaz", async () => {
    const { genelMudur, kalipCalisan } = await sirket();

    const sonuc = await markNoActivityPeriod(
      testDb,
      genelMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("not_subordinate");
  });

  it("çalışan için vekil gösterilemez", async () => {
    const { kalipMudur, kalipCalisan, planlamaMudur } = await sirket();

    const sonuc = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      {
        userId: kalipCalisan.id,
        startDate: "2026-08-18",
        endDate: "2026-08-22",
        deputyId: planlamaMudur.id,
      },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("absent_not_manager");
  });
});

describe("tarih aralığı", () => {
  it("bitiş başlangıçtan önce olamaz", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();

    const sonuc = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-22", endDate: "2026-08-18" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("invalid_range");
  });

  it("çakışan aralık reddedilir", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();
    await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    const sonuc = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-20", endDate: "2026-08-25" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("overlaps");
    expect(await testDb.noActivityPeriod.count()).toBe(1);
  });

  it("bitişik ama çakışmayan aralıklar kabul edilir", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();
    await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    const sonuc = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-23", endDate: "2026-08-25" },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
  });
});

describe("listeleme ve iptal", () => {
  it("yönetici yalnızca kendi ekibinin işaretlerini görür", async () => {
    const { kalipMudur, kalipCalisan, planlamaMudur, genelMudur } = await sirket();
    await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(await listTeamAbsences(testDb, kalipMudur.id)).toHaveLength(1);
    // Akran ekibin işaretini görmez — kendi ekibi boş olmadığı hâlde.
    expect(await listTeamAbsences(testDb, planlamaMudur.id)).toHaveLength(0);
    // Üst kademe alt organizasyonun izin kayıtlarını görebilir; karar yetkisi
    // yine yalnızca kendisine yönlendirilen bekleyen taleplerde açılır.
    const ustListe = await listTeamAbsences(testDb, genelMudur.id);
    expect(ustListe).toHaveLength(1);
    expect(ustListe[0]?.canDecide).toBe(false);
    expect(ustListe[0]?.canCancel).toBe(false);
  });

  it("başka departmanın yöneticisi bekleyen talebi karara bağlayamaz", async () => {
    const { kalipMudur, kalipCalisan, planlamaMudur } = await sirket();
    const talep = await markOwnNoActivityPeriod(
      testDb,
      kalipCalisan.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!talep.ok) throw new Error("talep kurulamadı");

    const yabanciKarar = await decideNoActivityPeriod(
      testDb,
      planlamaMudur.id,
      talep.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(yabanciKarar.ok).toBe(false);
    if (!yabanciKarar.ok) expect(yabanciKarar.error).toBe("not_found");

    const kendiKarar = await decideNoActivityPeriod(
      testDb,
      kalipMudur.id,
      talep.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(kendiKarar.ok).toBe(true);
  });

  it("başkasının ekibindeki işaret iptal edilemez", async () => {
    const { kalipMudur, kalipCalisan, planlamaMudur } = await sirket();
    const konan = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!konan.ok) throw new Error("kurulum");

    const yabanci = await cancelNoActivityPeriod(
      testDb,
      planlamaMudur.id,
      konan.id,
      "yanlış giriş",
      NOW,
    );
    expect(yabanci.ok).toBe(false);
    if (!yabanci.ok) expect(yabanci.error).toBe("not_found");

    // Kendi ekibi için iptal edilebilir.
    const kendi = await cancelNoActivityPeriod(
      testDb,
      kalipMudur.id,
      konan.id,
      "yanlış giriş",
      NOW,
    );
    expect(kendi.ok).toBe(true);
  });

  it("iptal SİLMEZ: satır gerekçesiyle durur", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();
    const konan = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!konan.ok) throw new Error("kurulum");

    await cancelNoActivityPeriod(testDb, kalipMudur.id, konan.id, "sehven girildi", NOW);

    // Satır **duruyor**: vekilin geçmiş görünürlüğü buna bağlı (§4.5).
    const satir = await testDb.noActivityPeriod.findUniqueOrThrow({
      where: { id: konan.id },
    });
    expect(satir.cancelledAt).not.toBeNull();
    expect(satir.cancelledById).toBe(kalipMudur.id);
    expect(satir.cancellationReason).toBe("sehven girildi");
  });

  it("gerekçesiz iptal edilemez", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();
    const konan = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!konan.ok) throw new Error("kurulum");

    const sonuc = await cancelNoActivityPeriod(testDb, kalipMudur.id, konan.id, "   ", NOW);
    expect(sonuc.ok).toBe(false);
    if (!sonuc.ok) expect(sonuc.error).toBe("reason_required");
  });

  it("aynı kayıt iki kez iptal edilemez", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();
    const konan = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!konan.ok) throw new Error("kurulum");

    expect((await cancelNoActivityPeriod(testDb, kalipMudur.id, konan.id, "bir", NOW)).ok).toBe(true);
    const ikinci = await cancelNoActivityPeriod(testDb, kalipMudur.id, konan.id, "iki", NOW);
    expect(ikinci.ok).toBe(false);
    if (!ikinci.ok) expect(ikinci.error).toBe("not_found");
  });

  it("iptal edilen dönem hatırlatmayı durdurmaz", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();
    const konan = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!konan.ok) throw new Error("kurulum");

    expect(await isNoActivityDay(testDb, kalipCalisan.id, "2026-08-20")).toBe(true);
    await cancelNoActivityPeriod(testDb, kalipMudur.id, konan.id, "sehven", NOW);
    // İptal edilen dönem hiç yaşanmamış sayılır.
    expect(await isNoActivityDay(testDb, kalipCalisan.id, "2026-08-20")).toBe(false);
  });

  it("iptal edilen dönemin tarihlerine yenisi girilebilir", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();
    const konan = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!konan.ok) throw new Error("kurulum");
    await cancelNoActivityPeriod(testDb, kalipMudur.id, konan.id, "yanlış tarih", NOW);

    // Çakışma kısıtı yalnız geçerli dönemleri sayar.
    const yeni = await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    expect(yeni.ok).toBe(true);
  });
});

describe("gün sorgusu", () => {
  it("aralığın içindeki günler işaretli sayılır", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();
    await markNoActivityPeriod(
      testDb,
      kalipMudur.id,
      { userId: kalipCalisan.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    // Sınırlar dahildir.
    expect(await isNoActivityDay(testDb, kalipCalisan.id, "2026-08-18")).toBe(true);
    expect(await isNoActivityDay(testDb, kalipCalisan.id, "2026-08-20")).toBe(true);
    expect(await isNoActivityDay(testDb, kalipCalisan.id, "2026-08-22")).toBe(true);

    expect(await isNoActivityDay(testDb, kalipCalisan.id, "2026-08-17")).toBe(false);
    expect(await isNoActivityDay(testDb, kalipCalisan.id, "2026-08-23")).toBe(false);
    // Başkasının işareti bu kişiyi kapsamaz.
    expect(await isNoActivityDay(testDb, kalipMudur.id, "2026-08-20")).toBe(false);
  });
});
