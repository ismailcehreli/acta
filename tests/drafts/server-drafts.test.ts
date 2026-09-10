import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_DRAFTS_PER_USER,
  countDrafts,
  deleteDraft,
  findDraft,
  hasDraftContent,
  listDrafts,
  saveDraft,
} from "@/server/activities/drafts";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Sunucu tarafındaki faaliyet taslakları (21.08.2026).
//
// Sınanan asıl şey **taslağın kime ait olduğu**. Taslak yalnız yazarınındır;
// yöneticisi de sistem yöneticisi de göremez, değiştiremez, silemez. Bu
// dosyadaki her testin bir "başkası" tarafı var.

const NOW = new Date("2026-08-21T09:00:00.000Z");

const TASLAK = {
  activityDate: "2026-08-21",
  title: "Kalıp bakımı",
  description: "Üç preste bakım yapıldı.",
  targetDepartmentIds: [] as string[],
  openFollowUp: false,
  savedManually: false,
};

async function ikiKisi() {
  const kok = await createOrgUnit({ name: "Şirket" });
  const yazar = await createUser(kok.id, { email: "yazar@ornek.test" });
  const baskasi = await createUser(kok.id, {
    email: "baskasi@ornek.test",
    isUnitManager: true,
  });

  return { yazar, baskasi };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("içerik kuralı", () => {
  it("bomboş taslak anlamlı sayılmaz", () => {
    expect(hasDraftContent({ title: "", description: "" })).toBe(false);
    expect(hasDraftContent({ title: "   ", description: "\n\t" })).toBe(false);
  });

  it("başlık ya da açıklamadan biri yeter", () => {
    expect(hasDraftContent({ title: "Bir şey", description: "" })).toBe(true);
    expect(hasDraftContent({ title: "", description: "Bir şey" })).toBe(true);
  });
});

describe("taslak kaydetme", () => {
  it("yeni taslak açılır ve okunur", async () => {
    const { yazar } = await ikiKisi();

    const sonuc = await saveDraft(testDb, yazar.id, TASLAK, NOW);
    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    const okunan = await findDraft(testDb, yazar.id, sonuc.draft.id);
    expect(okunan?.title).toBe("Kalıp bakımı");
    expect(okunan?.savedManually).toBe(false);
  });

  it("aynı taslak güncellenir, yenisi açılmaz", async () => {
    const { yazar } = await ikiKisi();

    const ilk = await saveDraft(testDb, yazar.id, TASLAK, NOW);
    expect(ilk.ok).toBe(true);
    if (!ilk.ok) return;

    await saveDraft(
      testDb,
      yazar.id,
      { ...TASLAK, id: ilk.draft.id, title: "Kalıp bakımı — düzeltildi" },
      NOW,
    );

    expect(await countDrafts(testDb, yazar.id)).toBe(1);
    const okunan = await findDraft(testDb, yazar.id, ilk.draft.id);
    expect(okunan?.title).toBe("Kalıp bakımı — düzeltildi");
  });

  it("bilerek kaydedilmiş taslak otomatik kaydetmeyle geri dönmez", async () => {
    const { yazar } = await ikiKisi();

    const ilk = await saveDraft(
      testDb,
      yazar.id,
      { ...TASLAK, savedManually: true },
      NOW,
    );
    expect(ilk.ok).toBe(true);
    if (!ilk.ok) return;
    expect(ilk.draft.savedManually).toBe(true);

    // Kullanıcı taslağa dönüp yazmaya devam etti; otomatik kaydetme çalıştı.
    const sonra = await saveDraft(
      testDb,
      yazar.id,
      { ...TASLAK, id: ilk.draft.id, savedManually: false, title: "Devam" },
      NOW,
    );

    expect(sonra.ok).toBe(true);
    if (!sonra.ok) return;
    // Kullanıcının kararı kalıcı: "bekletiliyor" rozeti düşmemeli.
    expect(sonra.draft.savedManually).toBe(true);
  });

  it("sınıra ulaşınca yeni taslak açılmaz", async () => {
    const { yazar } = await ikiKisi();

    for (let i = 0; i < MAX_DRAFTS_PER_USER; i += 1) {
      const sonuc = await saveDraft(
        testDb,
        yazar.id,
        { ...TASLAK, title: `Taslak ${i}` },
        NOW,
      );
      expect(sonuc.ok).toBe(true);
    }

    const fazlasi = await saveDraft(testDb, yazar.id, TASLAK, NOW);
    expect(fazlasi.ok).toBe(false);
    if (fazlasi.ok) return;
    expect(fazlasi.error).toBe("too_many");
  });
});

describe("taslak yalnız yazarınındır", () => {
  it("başkasının taslağı listelenmez", async () => {
    const { yazar, baskasi } = await ikiKisi();
    await saveDraft(testDb, yazar.id, TASLAK, NOW);

    expect(await listDrafts(testDb, baskasi.id)).toHaveLength(0);
    expect(await countDrafts(testDb, baskasi.id)).toBe(0);
  });

  it("başkasının taslağı kimliğiyle bile okunmaz", async () => {
    const { yazar, baskasi } = await ikiKisi();
    const sonuc = await saveDraft(testDb, yazar.id, TASLAK, NOW);
    if (!sonuc.ok) throw new Error("taslak kurulamadı");

    // Kimliği bilmek yetmez: sorgu yazar kimliğini de arıyor.
    expect(await findDraft(testDb, baskasi.id, sonuc.draft.id)).toBeNull();
  });

  it("başkasının taslağı güncellenemez", async () => {
    const { yazar, baskasi } = await ikiKisi();
    const sonuc = await saveDraft(testDb, yazar.id, TASLAK, NOW);
    if (!sonuc.ok) throw new Error("taslak kurulamadı");

    const deneme = await saveDraft(
      testDb,
      baskasi.id,
      { ...TASLAK, id: sonuc.draft.id, title: "ELE GEÇİRİLDİ" },
      NOW,
    );

    expect(deneme.ok).toBe(false);
    // Taslak dokunulmamış olmalı.
    const okunan = await findDraft(testDb, yazar.id, sonuc.draft.id);
    expect(okunan?.title).toBe("Kalıp bakımı");
  });

  it("başkasının taslağı silinemez", async () => {
    const { yazar, baskasi } = await ikiKisi();
    const sonuc = await saveDraft(testDb, yazar.id, TASLAK, NOW);
    if (!sonuc.ok) throw new Error("taslak kurulamadı");

    expect(await deleteDraft(testDb, baskasi.id, sonuc.draft.id)).toBe(false);
    expect(await countDrafts(testDb, yazar.id)).toBe(1);
  });
});

describe("taslak silme", () => {
  // Taslak **fiziksel olarak silinir**: olmuş bir şeyin kaydı değil, hiç
  // gönderilmemiş bir müsvedde. Faaliyet silme yasağı buraya uzanmaz.
  it("yazar kendi taslağını siler", async () => {
    const { yazar } = await ikiKisi();
    const sonuc = await saveDraft(testDb, yazar.id, TASLAK, NOW);
    if (!sonuc.ok) throw new Error("taslak kurulamadı");

    expect(await deleteDraft(testDb, yazar.id, sonuc.draft.id)).toBe(true);
    expect(await countDrafts(testDb, yazar.id)).toBe(0);
  });

  it("olmayan taslağı silmek hata değil, sonuçsuzdur", async () => {
    const { yazar } = await ikiKisi();
    expect(
      await deleteDraft(testDb, yazar.id, "11111111-1111-4111-8111-111111111111"),
    ).toBe(false);
  });
});
