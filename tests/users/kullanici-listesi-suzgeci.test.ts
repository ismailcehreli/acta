import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countUsers, listUsers } from "@/server/users/list";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Yönetim kullanıcı listesinin süzgeçleri ve sayfalaması (Görev 11.3/11.4).
//
// Liste süzgeçsizdi ve tamamı tek sayfada çiziliyordu. 50 kişilik bir şirkette
// bile "Kalıphane'deki pasif hesaplar" sorusu ancak gözle taranarak
// cevaplanabiliyordu.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(kaliphane.id, { fullName: "Kadir Usta" });
  const pasif = await createUser(kaliphane.id, {
    fullName: "Ayrılan Kişi",
    isActive: false,
  });
  const planlamaci = await createUser(planlama.id, { fullName: "Planlamacı" });

  return { kaliphane, planlama, mudur, kadir, pasif, planlamaci };
}

describe("birim süzgeci", () => {
  it("yalnız o birimin kullanıcılarını getirir", async () => {
    const { planlama } = await sirket();

    const sonuc = await listUsers(testDb, { orgUnitId: planlama.id });

    expect(sonuc.map((k) => k.fullName)).toEqual(["Planlamacı"]);
  });
});

describe("durum süzgeci", () => {
  it("yalnız pasif hesapları getirir", async () => {
    await sirket();

    const sonuc = await listUsers(testDb, { isActive: false });

    expect(sonuc.map((k) => k.fullName)).toEqual(["Ayrılan Kişi"]);
  });

  it("yalnız aktif hesapları getirir", async () => {
    await sirket();

    const sonuc = await listUsers(testDb, { isActive: true });

    expect(sonuc.map((k) => k.fullName)).not.toContain("Ayrılan Kişi");
  });
});

describe("rol süzgeci", () => {
  it("yalnız birim yöneticilerini getirir", async () => {
    await sirket();

    const sonuc = await listUsers(testDb, { role: "unitManager" });

    expect(sonuc.map((k) => k.fullName)).toEqual(["Kalıphane Müdürü"]);
  });
});

describe("arama", () => {
  it("ad içinde arar, büyük-küçük harf ayırmaz", async () => {
    await sirket();

    const sonuc = await listUsers(testDb, { query: "kadir" });

    expect(sonuc.map((k) => k.fullName)).toEqual(["Kadir Usta"]);
  });

  it("e-posta içinde de arar", async () => {
    const { kadir } = await sirket();

    const sonuc = await listUsers(testDb, { query: kadir.email.slice(0, 8) });

    expect(sonuc.map((k) => k.id)).toContain(kadir.id);
  });
});

describe("sayfalama", () => {
  it("istenen kadar kayıt döndürür", async () => {
    await sirket();

    const sonuc = await listUsers(testDb, {}, { limit: 2 });

    expect(sonuc).toHaveLength(2);
  });

  it("sayaç süzgeçli toplamı verir", async () => {
    const { kaliphane } = await sirket();

    expect(await countUsers(testDb, { orgUnitId: kaliphane.id })).toBe(3);
    expect(await countUsers(testDb, {})).toBe(4);
  });
});

describe("süzgeçler birleşir", () => {
  it("birim ve durum birlikte daraltır", async () => {
    const { kaliphane } = await sirket();

    const sonuc = await listUsers(testDb, {
      orgUnitId: kaliphane.id,
      isActive: false,
    });

    expect(sonuc.map((k) => k.fullName)).toEqual(["Ayrılan Kişi"]);
  });
});
