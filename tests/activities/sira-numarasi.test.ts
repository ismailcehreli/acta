import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity } from "@/server/activities/write";
import { listOwnActivities } from "@/server/activities/read";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Faaliyet sıra numarası (ister belgesi §3.1).
//
// Numara veritabanı dizisinden gelir. Uygulama katmanında "en büyüğü bul, bir
// ekle" demek, iki eşzamanlı kaydın aynı numarayı almasına açık kapı
// bırakırdı; bu testler numaranın tekil ve artan olduğunu doğruluyor.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: root.id });

  const kalipci = await createUser(kaliphane.id, { fullName: "Kalıpçı" });
  const planci = await createUser(planlama.id, { fullName: "Plancı" });

  return { kalipci, planci };
}

async function yaz(kisi: { id: string; orgUnitId: string }, baslik: string) {
  const sonuc = await createActivity(
    testDb,
    { id: kisi.id, orgUnitId: kisi.orgUnitId, requiresApproval: false },
    {
      activityDate: "2026-08-19",
      title: baslik,
      description: "Açıklama.",
      targetDepartmentIds: [],
    },
    NOW,
  );
  if (!sonuc.ok) throw new Error(`kurulum: ${sonuc.message}`);
  return sonuc.activity;
}

describe("faaliyet sıra numarası", () => {
  it("her kayıt numara alır ve numara artar", async () => {
    const { kalipci } = await sirket();

    const birinci = await yaz(kalipci, "Birinci");
    const ikinci = await yaz(kalipci, "İkinci");

    expect(birinci.activityNo).toBeGreaterThan(0);
    expect(ikinci.activityNo).toBe(birinci.activityNo + 1);
  });

  it("numara departmandan bağımsızdır", async () => {
    const { kalipci, planci } = await sirket();

    const birinci = await yaz(kalipci, "Kalıphane işi");
    const ikinci = await yaz(planci, "Planlama işi");
    const ucuncu = await yaz(kalipci, "Kalıphane işi 2");

    // Tek bir sayaç: departmana göre ayrı seriler yok.
    expect([birinci.activityNo, ikinci.activityNo, ucuncu.activityNo]).toEqual([
      birinci.activityNo,
      birinci.activityNo + 1,
      birinci.activityNo + 2,
    ]);
  });

  it("aynı numara ikinci kez verilemez", async () => {
    const { kalipci } = await sirket();
    const kayit = await yaz(kalipci, "Tek");
    const baska = await yaz(kalipci, "Başka");

    // Tekil indeks: numara kimliğe eşdeğer bir atıf olduğu için çakışamaz.
    await expect(
      testDb.activity.update({
        where: { id: baska.id },
        data: { activityNo: kayit.activityNo },
      }),
    ).rejects.toThrow();
  });

  it("eşzamanlı yazımlarda numaralar çakışmaz", async () => {
    const { kalipci, planci } = await sirket();

    const sonuclar = await Promise.all([
      yaz(kalipci, "Eşzamanlı 1"),
      yaz(planci, "Eşzamanlı 2"),
      yaz(kalipci, "Eşzamanlı 3"),
    ]);

    const numaralar = sonuclar.map((k) => k.activityNo);
    expect(new Set(numaralar).size).toBe(3);
  });

  it("liste ekranı numarayı taşır", async () => {
    const { kalipci } = await sirket();
    const kayit = await yaz(kalipci, "Listede");

    const liste = await listOwnActivities(
      testDb,
      { id: kalipci.id, isSystemAdmin: false },
      { period: "all", now: new Date() },
    );

    expect(liste[0].activityNo).toBe(kayit.activityNo);
  });

  it("iptal edilen kayıt numarasını korur", async () => {
    const { kalipci } = await sirket();
    const kayit = await yaz(kalipci, "İptal edilecek");

    await testDb.activity.update({
      where: { id: kayit.id },
      data: { approvalStatus: "CANCELLED" },
    });

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: kayit.id },
    });
    // Numara silinmez: iptal edilmiş kayda da atıf verilebilmeli.
    expect(stored.activityNo).toBe(kayit.activityNo);
  });
});
