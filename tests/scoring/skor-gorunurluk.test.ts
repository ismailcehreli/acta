import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { readUserScore, readTeamScores } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Skorun görünürlüğü (Görev 11.10).
//
// **Skor bir toplamdır ve toplam, görülmeyen kaydı ele verir.** Tasarım
// belgesi satır 1748: "aynı kişinin profilinde müdür 2 kayıt, genel müdür
// 1 kayıt sayar — sayaç, listede gizlenen kaydı sayıyla ele vermez."
//
// Bu yüzden skor **bakan kişinin kapsamına göre** hesaplanıyor ve genel
// sıralama yok.

const NOW = new Date("2026-08-22T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const gm = await createUser(kok.id, { fullName: "Genel Müdür", isUnitManager: true });
  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(kaliphane.id, { fullName: "Kadir Usta" });
  const yabanci = await createUser(planlama.id, { fullName: "Planlamacı" });

  return { gm, mudur, kadir, yabanci };
}

describe("kapsam", () => {
  it("kişi kendi skorunu görür", async () => {
    const { kadir } = await sirket();

    const skor = await readUserScore(testDb, { id: kadir.id, isSystemAdmin: false }, kadir.id, NOW);

    expect(skor).not.toBeNull();
  });

  it("yönetici astının skorunu görür", async () => {
    const { mudur, kadir } = await sirket();

    const skor = await readUserScore(testDb, { id: mudur.id, isSystemAdmin: false }, kadir.id, NOW);

    expect(skor).not.toBeNull();
  });

  // Kapsam dışı kişinin skoru **yok** sayılır; "var ama göremezsin" demek
  // kişinin varlığını ve çalışma düzenini ele verirdi.
  it("kapsam dışı kişinin skoru görünmez", async () => {
    const { mudur, yabanci } = await sirket();

    const skor = await readUserScore(testDb, { id: mudur.id, isSystemAdmin: false }, yabanci.id, NOW);

    expect(skor).toBeNull();
  });

  // §15.1: sistem yöneticisi yetkisi **işlevseldir**, içerik erişimi vermez.
  // Skor kişinin çalışma verisinden türüyor ve içeriktir.
  it("sistem yöneticisi başkasının skorunu göremez", async () => {
    const admin = await createUser(
      (await createOrgUnit({ name: "Şirket", type: "Kök" })).id,
      { fullName: "Sistem Yöneticisi", isSystemAdmin: true },
    );
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: admin.orgUnitId });
    const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });

    const skor = await readUserScore(testDb, { id: admin.id, isSystemAdmin: true }, kadir.id, NOW);

    expect(skor).toBeNull();
  });
});

describe("skor kapalıyken", () => {
  it("ayar kapalıysa skor hesaplanmaz", async () => {
    const { kadir } = await sirket();
    await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "false" });

    const skor = await readUserScore(testDb, { id: kadir.id, isSystemAdmin: false }, kadir.id, NOW);

    expect(skor).toBeNull();
  });
});

describe("isScored", () => {
  it("puanlanmayan kişi için skor üretilmez", async () => {
    const { kadir } = await sirket();
    await testDb.user.update({ where: { id: kadir.id }, data: { isScored: false } });

    const skor = await readUserScore(testDb, { id: kadir.id, isSystemAdmin: false }, kadir.id, NOW);

    expect(skor).toBeNull();
  });

  it("faaliyet yazması beklenmeyen kişi için skor üretilmez", async () => {
    const { kadir } = await sirket();
    await testDb.user.update({
      where: { id: kadir.id },
      data: { writesActivities: false },
    });

    const skor = await readUserScore(testDb, { id: kadir.id, isSystemAdmin: false }, kadir.id, NOW);

    expect(skor).toBeNull();
  });
});

describe("ekip listesi", () => {
  it("yalnız kapsamdaki kişileri içerir", async () => {
    const { mudur, kadir, yabanci } = await sirket();
    await createActivity(kadir, { activityDate: new Date("2026-08-19T00:00:00.000Z") });

    const liste = await readTeamScores(testDb, { id: mudur.id, isSystemAdmin: false }, NOW);

    const idler = liste.map((s) => s.userId);
    expect(idler).toContain(kadir.id);
    expect(idler).not.toContain(yabanci.id);
  });

  it("puanlanmayan kişi listede yok", async () => {
    const { mudur, kadir } = await sirket();
    await testDb.user.update({ where: { id: kadir.id }, data: { isScored: false } });

    const liste = await readTeamScores(testDb, { id: mudur.id, isSystemAdmin: false }, NOW);

    expect(liste.map((s) => s.userId)).not.toContain(kadir.id);
  });
});
