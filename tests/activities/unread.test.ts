import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countUnreadInScope } from "@/server/activities/unread";
import { subordinateUserIds } from "@/server/authz/visibility";
import { markActivityAsRead } from "@/server/reads/service";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Okunmamış sayacı (ister belgesi §2.3.4).
//
// En kritik iddia: sayı **görünürlük modülünden geçer**. Göremediği bir kaydı
// sayan rozet, kaydın varlığını ele verirdi — sayı da bir bilgidir (§18.4).

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

  const genelMudur = await createUser(root.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const calisan = await createUser(kaliphane.id, { fullName: "Kalıpçı" });
  const akran = await createUser(planlama.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });

  return { genelMudur, mudur, calisan, akran };
}

async function faaliyet(
  kisi: { id: string; orgUnitId: string },
  baslik: string,
  durum: "APPROVED" | "CANCELLED" = "APPROVED",
) {
  return testDb.activity.create({
    data: {
      authorId: kisi.id,
      authorOrgUnitId: kisi.orgUnitId,
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
      title: baslik,
      description: "içerik",
      approvalStatus: durum,
    },
  });
}

async function say(kisi: { id: string }) {
  const subordinates = await subordinateUserIds(testDb, kisi.id);
  return countUnreadInScope(
    testDb,
    { id: kisi.id, isSystemAdmin: false },
    subordinates,
  );
}

describe("okunmamış sayacı", () => {
  it("kapsamdaki okunmamış kayıtları sayar", async () => {
    const { mudur, calisan } = await sirket();
    await faaliyet(calisan, "Bir");
    await faaliyet(calisan, "İki");

    expect(await say(mudur)).toBe(2);
  });

  it("okundukça azalır", async () => {
    const { mudur, calisan } = await sirket();
    const kayit = await faaliyet(calisan, "Bir");
    await faaliyet(calisan, "İki");

    await markActivityAsRead(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      kayit.id,
      3_000,
      NOW,
    );

    expect(await say(mudur)).toBe(1);
  });

  it("kendi yazdığı sayılmaz", async () => {
    const { mudur } = await sirket();
    await faaliyet(mudur, "Kendi kaydım");

    // İnsan kendi yazdığını "okumamış" olmaz.
    expect(await say(mudur)).toBe(0);
  });

  it("iptal edilmiş kayıt sayılmaz", async () => {
    const { mudur, calisan } = await sirket();
    await faaliyet(calisan, "İptal", "CANCELLED");

    expect(await say(mudur)).toBe(0);
  });

  it("göremediği kayıt sayıya girmez", async () => {
    const { mudur, akran } = await sirket();
    await faaliyet(akran, "Akranın kaydı");

    // Akranın kaydı müdürün kapsamında değil; sayısı da sızmamalı.
    expect(await say(mudur)).toBe(0);
  });

  it("astı olmayan kişide sıfırdır", async () => {
    const { calisan, akran } = await sirket();
    await faaliyet(akran, "Başkasının kaydı");

    expect(await say(calisan)).toBe(0);
  });

  it("üst kademe alt kademenin kayıtlarını da sayar", async () => {
    const { genelMudur, calisan, mudur } = await sirket();
    await faaliyet(calisan, "Çalışanın kaydı");
    await faaliyet(mudur, "Müdürün kaydı");

    expect(await say(genelMudur)).toBe(2);
  });
});
