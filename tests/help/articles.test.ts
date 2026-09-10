import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  archiveHelpArticle,
  createHelpArticle,
  listHelpArticles,
  updateHelpArticle,
} from "@/server/help/articles";
import { canManageHelp } from "@/server/authz/help";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-28T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kullanicilar() {
  const birim = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const sistemYoneticisi = await createUser(birim.id, {
    fullName: "Sistem Yöneticisi",
    isSystemAdmin: true,
  });
  const birimYoneticisi = await createUser(birim.id, {
    fullName: "Birim Yöneticisi",
    isUnitManager: true,
  });
  const calisan = await createUser(birim.id, { fullName: "Çalışan" });

  return { sistemYoneticisi, birimYoneticisi, calisan };
}

const yazi = {
  category: "Başlangıç",
  title: "Nasıl giriş yaparım?",
  answer: "E-posta adresinizi ve parolanızı yazıp Giriş yap düğmesine basın.",
  sortOrder: 1,
  isPublished: true,
};

describe("yardım kütüphanesi", () => {
  it("yönetici yazı ekleyebilir, düzenleyebilir ve arşivleyebilir", async () => {
    const { birimYoneticisi } = await kullanicilar();

    const ekleme = await createHelpArticle(testDb, birimYoneticisi.id, yazi, NOW);
    expect(ekleme.ok).toBe(true);
    if (!ekleme.ok) return;

    const duzenleme = await updateHelpArticle(
      testDb,
      birimYoneticisi.id,
      ekleme.article.id,
      { ...yazi, title: "Parolamı nasıl belirlerim?", isPublished: false },
      NOW,
    );
    expect(duzenleme.ok).toBe(true);

    expect(await listHelpArticles(testDb)).toEqual([]);
    expect(await listHelpArticles(testDb, { includeUnpublished: true })).toHaveLength(1);

    expect(
      await archiveHelpArticle(testDb, birimYoneticisi.id, ekleme.article.id, NOW),
    ).toEqual({ ok: true });
    expect(await listHelpArticles(testDb, { includeUnpublished: true })).toEqual([]);
  });

  it("içerik düz metin olmalı ve HTML kabul edilmez", async () => {
    const { sistemYoneticisi } = await kullanicilar();

    const sonuc = await createHelpArticle(
      testDb,
      sistemYoneticisi.id,
      { ...yazi, answer: "<script>alert('x')</script>" },
      NOW,
    );

    expect(sonuc).toEqual({
      ok: false,
      error: "invalid_text",
      message: "Kategori, başlık ve açıklama sınırlar içinde olmalı; HTML kullanılamaz.",
    });
  });

  it("yayınlanmamış yazı yalnızca yöneticinin listesinde görünür", async () => {
    const { sistemYoneticisi } = await kullanicilar();
    await createHelpArticle(testDb, sistemYoneticisi.id, { ...yazi, isPublished: false }, NOW);

    expect(await listHelpArticles(testDb)).toHaveLength(0);
    expect(await listHelpArticles(testDb, { includeUnpublished: true })).toHaveLength(1);
  });

  it("sistem yöneticisi ve birim yöneticisi yazıları yönetebilir", async () => {
    const { sistemYoneticisi, birimYoneticisi, calisan } = await kullanicilar();

    expect(canManageHelp(sistemYoneticisi)).toBe(true);
    expect(canManageHelp(birimYoneticisi)).toBe(true);
    expect(canManageHelp(calisan)).toBe(false);
  });
});
