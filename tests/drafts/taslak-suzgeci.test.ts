import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countDrafts, listDrafts } from "@/server/activities/drafts";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Taslak listesinin süzgeci ve sayfalaması (Görev 11.3).
//
// İki tür taslak aynı listede durur ve ayırt edilmeleri gerekir (§ tasarım,
// `ActivityDraft.savedManually`): bilerek bekletilen metin ile pencere
// kapandığı için kazara kalan metin aynı şey değildir.
//
// Liste **yalnız kişinin kendisine** aittir; süzgeç bunu değiştiremez.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kisi() {
  const unit = await createOrgUnit({ name: "Kalıphane", type: "Kök" });
  const ben = await createUser(unit.id, { fullName: "Ben" });
  const baskasi = await createUser(unit.id, { fullName: "Başkası" });
  return { ben, baskasi };
}

async function taslak(
  authorId: string,
  title: string,
  savedManually: boolean,
) {
  return testDb.activityDraft.create({
    data: {
      authorId,
      title,
      description: `${title} için metin`,
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
      targetOrgUnitIds: [],
      savedManually,
    },
  });
}

describe("kayıt türü süzgeci", () => {
  it("yalnız elle kaydedilen taslakları getirir", async () => {
    const { ben } = await kisi();
    await taslak(ben.id, "Bilerek bıraktım", true);
    await taslak(ben.id, "Kazara kaldı", false);

    const sonuc = await listDrafts(testDb, ben.id, { savedManually: true });

    expect(sonuc.map((d) => d.title)).toEqual(["Bilerek bıraktım"]);
  });

  it("yalnız otomatik kaydedilen taslakları getirir", async () => {
    const { ben } = await kisi();
    await taslak(ben.id, "Bilerek bıraktım", true);
    await taslak(ben.id, "Kazara kaldı", false);

    const sonuc = await listDrafts(testDb, ben.id, { savedManually: false });

    expect(sonuc.map((d) => d.title)).toEqual(["Kazara kaldı"]);
  });

  it("süzgeç yokken ikisini de getirir", async () => {
    const { ben } = await kisi();
    await taslak(ben.id, "Bilerek bıraktım", true);
    await taslak(ben.id, "Kazara kaldı", false);

    expect(await listDrafts(testDb, ben.id, {})).toHaveLength(2);
  });
});

describe("sayfalama", () => {
  it("istenen kadar kayıt döndürür ve atlar", async () => {
    const { ben } = await kisi();
    for (const ad of ["Bir", "İki", "Üç"]) await taslak(ben.id, ad, true);

    const ilk = await listDrafts(testDb, ben.id, {}, { limit: 2 });
    const ikinci = await listDrafts(testDb, ben.id, {}, { limit: 2, skip: 2 });

    expect(ilk).toHaveLength(2);
    expect(ikinci).toHaveLength(1);
  });
});

describe("sayaç ile liste aynı süzgeci kullanır", () => {
  it("sayaç da daraltmayı uygular", async () => {
    const { ben } = await kisi();
    await taslak(ben.id, "Bilerek", true);
    await taslak(ben.id, "Kazara", false);

    expect(await countDrafts(testDb, ben.id, { savedManually: true })).toBe(1);
    expect(await countDrafts(testDb, ben.id)).toBe(2);
  });
});

describe("liste başkasına açılmaz", () => {
  it("hiçbir süzgeç başkasının taslağını getirmez", async () => {
    const { ben, baskasi } = await kisi();
    await taslak(baskasi.id, "Başkasının taslağı", true);
    await taslak(ben.id, "Benim taslağım", true);

    const sonuc = await listDrafts(testDb, ben.id, { savedManually: true });

    expect(sonuc.map((d) => d.title)).toEqual(["Benim taslağım"]);
  });
});
