import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  appreciateActivity,
  countAppreciations,
  countAppreciationsForUser,
} from "@/server/scoring/appreciation";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Takdir (Görev 11.11).
//
// Takdir kayda verilir; onaylanmış faaliyetlere verilen geçerli takdirler,
// ayardaki puan kadar faaliyeti yazan kişinin genel puanına eklenir.

const NOW = new Date("2026-08-22T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.appreciationEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const gm = await createUser(kok.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
    canAppreciate: true,
  });
  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(kaliphane.id, { fullName: "Kadir Usta" });
  const yabanci = await createUser(planlama.id, {
    fullName: "Planlamacı",
    canAppreciate: true,
  });

  const kayit = await createActivity(kadir, { title: "Kalıp bakımı" });

  return { gm, mudur, kadir, yabanci, kayit };
}

describe("kim takdir verebilir", () => {
  it("yetkili kullanıcı takdir verir", async () => {
    const { gm, kayit } = await sirket();

    const sonuc = await appreciateActivity(testDb, gm.id, kayit.id, NOW);

    expect(sonuc.ok).toBe(true);
    expect(await countAppreciations(testDb, kayit.id)).toBe(1);
  });

  it("yetkisiz kullanıcı veremez", async () => {
    const { mudur, kayit } = await sirket();

    const sonuc = await appreciateActivity(testDb, mudur.id, kayit.id, NOW);

    expect(sonuc.ok).toBe(false);
    expect(await countAppreciations(testDb, kayit.id)).toBe(0);
  });

  it("kişi kendi faaliyetine takdir veremez", async () => {
    const { kadir, kayit } = await sirket();
    await testDb.user.update({
      where: { id: kadir.id },
      data: { canAppreciate: true },
    });

    const sonuc = await appreciateActivity(testDb, kadir.id, kayit.id, NOW);

    expect(sonuc).toEqual({
      ok: false,
      message: "Kendi faaliyetinize takdir veremezsiniz.",
    });
    expect(await countAppreciations(testDb, kayit.id)).toBe(0);
  });

  it("ayar kapalıyken kimse veremez", async () => {
    const { gm, kayit } = await sirket();
    await saveSettings(testDb, { [SETTING_KEYS.appreciationEnabled]: "false" });

    const sonuc = await appreciateActivity(testDb, gm.id, kayit.id, NOW);

    expect(sonuc.ok).toBe(false);
  });
});

describe("görünürlük", () => {
  // Takdir bir okuma yoludur: göremediğin kaydı takdir edemezsin. Aksi hâlde
  // adres çubuğuna kimlik yazarak kaydın varlığı öğrenilebilirdi.
  it("kapsam dışı kaydı takdir edemez", async () => {
    const { yabanci, kayit } = await sirket();

    const sonuc = await appreciateActivity(testDb, yabanci.id, kayit.id, NOW);

    expect(sonuc.ok).toBe(false);
    expect(await countAppreciations(testDb, kayit.id)).toBe(0);
  });
});

describe("tekillik", () => {
  it("aynı kişi aynı kaydı iki kez takdir etmez", async () => {
    const { gm, kayit } = await sirket();
    await appreciateActivity(testDb, gm.id, kayit.id, NOW);

    const ikinci = await appreciateActivity(testDb, gm.id, kayit.id, NOW);

    expect(ikinci.ok).toBe(true);
    expect(await countAppreciations(testDb, kayit.id)).toBe(1);
  });
});

describe("kişi bazlı takdir sayacı", () => {
  // **Sayaç bir okuma yoludur** (denetim 23.08.2026, bulgu 3).
  //
  // Takdir sayısı kaydın başlığını vermez, ama görünmeyen bir kaydın
  // **varlığını** ve takdir edildiğini bildirir. §18.4 türetilmiş değerleri de
  // kapsar: sayaç da bakanın kapsamından hesaplanır.

  const DONEM_BASI = new Date("2026-08-01T00:00:00.000Z");
  const DONEM_SONU = new Date("2026-08-31T23:59:59.999Z");

  async function kurulum() {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const kaliphane = await createOrgUnit({
      name: "Kalıphane",
      parentId: kok.id,
      requiresApproval: true,
    });

    const gm = await createUser(kok.id, {
      fullName: "Genel Müdür",
      isUnitManager: true,
      canAppreciate: true,
    });
    const mudur = await createUser(kaliphane.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
      canAppreciate: true,
    });
    const kadir = await createUser(kaliphane.id, { fullName: "Kadir Usta" });

    // Onaylanmış kayıt: üst zincir de görür (§8.2).
    const onayli = await createActivity(kadir, {
      title: "Onaylanmış kayıt",
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: mudur.id,
      approvalSubmittedAt: new Date("2026-08-17T08:00:00.000Z"),
      approvalDecidedAt: new Date("2026-08-17T09:00:00.000Z"),
    });

    // Onay bekleyen kayıt: yalnız aktif onaylayıcı görür; genel müdüre
    // **hiç** akmaz.
    const bekleyen = await createActivity(kadir, {
      title: "Onay bekleyen kayıt",
      activityDate: new Date("2026-08-18T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: new Date("2026-08-18T08:00:00.000Z"),
    });

    return { gm, mudur, kadir, onayli, bekleyen };
  }

  it("aktif onaylayıcı, takdir ettiği bekleyen kaydı sayacında görür", async () => {
    const { mudur, kadir, onayli, bekleyen } = await kurulum();
    await appreciateActivity(testDb, mudur.id, onayli.id, NOW);
    await appreciateActivity(testDb, mudur.id, bekleyen.id, NOW);

    const sayi = await countAppreciationsForUser(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      kadir.id,
      DONEM_BASI,
      DONEM_SONU,
    );

    expect(sayi).toBe(2);
  });

  it("üst yönetici, göremediği kaydın takdirini saymaz", async () => {
    const { gm, mudur, kadir, onayli, bekleyen } = await kurulum();
    await appreciateActivity(testDb, mudur.id, onayli.id, NOW);
    await appreciateActivity(testDb, mudur.id, bekleyen.id, NOW);

    const sayi = await countAppreciationsForUser(
      testDb,
      { id: gm.id, isSystemAdmin: false },
      kadir.id,
      DONEM_BASI,
      DONEM_SONU,
    );

    // Bekleyen kaydın takdiri sayılsaydı 2 olurdu; kaydın varlığı sayıyla
    // ele verilmiş olurdu.
    expect(sayi).toBe(1);
  });

  it("sistem yöneticisi rolü sayaca erişim eklemez", async () => {
    const { kadir, mudur, onayli, bekleyen } = await kurulum();
    const kok = await testDb.orgUnit.findFirstOrThrow({ where: { parentId: null } });
    const yonetici = await createUser(kok.id, {
      fullName: "Sistem Yöneticisi",
      isSystemAdmin: true,
    });
    await appreciateActivity(testDb, mudur.id, onayli.id, NOW);
    await appreciateActivity(testDb, mudur.id, bekleyen.id, NOW);

    const sayi = await countAppreciationsForUser(
      testDb,
      { id: yonetici.id, isSystemAdmin: true },
      kadir.id,
      DONEM_BASI,
      DONEM_SONU,
    );

    // §15.1: rol işlevseldir, içerik erişimi vermez. Ağaçta kimsenin üstünde
    // olmadığı için hiçbir kaydı görmez.
    expect(sayi).toBe(0);
  });

  it("takdir ayarı kapalıyken gösterge hiç çizilmez", async () => {
    const { mudur, kadir, onayli } = await kurulum();
    await appreciateActivity(testDb, mudur.id, onayli.id, NOW);
    await saveSettings(testDb, { [SETTING_KEYS.appreciationEnabled]: "false" });

    const sayi = await countAppreciationsForUser(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      kadir.id,
      DONEM_BASI,
      DONEM_SONU,
    );

    // `null` "gösterge yok" demek; `0` "takdir almamış" demektir ve ikisi
    // aynı şey değil.
    expect(sayi).toBeNull();
  });
});
