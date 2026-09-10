import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Kullanıcı formundaki alanların sunucu eylemine **doğru taşınması**
// (denetim 23.08.2026, bulgu 13'ün kalanı).
//
// Paket 1 müdür yolunu kapattı ve `title` ile `isScored` ifadelerini
// düzeltti; ama sistem yöneticisi yolu **gerçek `FormData` ile** hiç
// sınanmamıştı. Denetimin istediği kanıt buydu: unvan saklanıyor mu, boş
// unvan `null` mu oluyor, işaretsiz skor kutusu `false` kalıyor mu.
//
// Ekran değil eylem çağrılıyor: form başarı bildirimi verirken kalıcı verinin
// kullanıcının seçimiyle uyuşmaması tam da bu bulgunun biçimiydi.

const { oturum } = vi.hoisted(() => ({
  oturum: { kisi: null as { id: string; isSystemAdmin: boolean; isUnitManager: boolean } | null },
}));

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: async () => oturum.kisi,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/db", async () => {
  const { testDb } = await import("../helpers/test-db");
  return { prisma: testDb };
});

const { createUserAction, updateUserAction } = await import(
  "@/app/admin/users/actions"
);

import { createOrgUnit, createUser as seedUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

let birimId = "";

beforeEach(async () => {
  await resetDatabase();

  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  birimId = kok.id;

  const yonetici = await seedUser(kok.id, {
    fullName: "Sistem Yöneticisi",
    email: "yonetici@ornek.test",
    isSystemAdmin: true,
  });

  oturum.kisi = { id: yonetici.id, isSystemAdmin: true, isUnitManager: false };
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Formun gerçekten gönderdiği alanlar; işaretsiz kutu **hiçbir şey** göndermez. */
function ekleme(alanlar: Record<string, string>): FormData {
  const form = new FormData();
  form.set("fullName", "Yeni Personel");
  form.set("email", `personel-${Math.random().toString(36).slice(2, 8)}@ornek.test`);
  form.set("orgUnitId", birimId);
  form.set("initialPassword", "cok-uzun-bir-parola-2026");
  for (const [ad, deger] of Object.entries(alanlar)) form.set(ad, deger);
  return form;
}

describe("sistem yöneticisi kullanıcı ekler", () => {
  it("unvan gerçekten saklanır", async () => {
    const sonuc = await createUserAction(
      { error: null, success: null, blockers: null },
      ekleme({ title: "Kalıp Operatörü", writesActivities: "on", isScored: "on" }),
    );

    expect(sonuc.error).toBeNull();

    const kayit = await testDb.user.findFirstOrThrow({
      where: { fullName: "Yeni Personel" },
    });
    expect(kayit.title).toBe("Kalıp Operatörü");
  });

  it("boş unvan null olarak saklanır", async () => {
    await createUserAction(
      { error: null, success: null, blockers: null },
      ekleme({ title: "", writesActivities: "on" }),
    );

    const kayit = await testDb.user.findFirstOrThrow({
      where: { fullName: "Yeni Personel" },
    });
    expect(kayit.title).toBeNull();
  });

  it("işaretsiz skor kutusu false kalır", async () => {
    // İşaretsiz kutu hiçbir şey göndermiyor. Eski ifade (`!== "off"`) bu
    // yüzden her zaman doğruydu ve skoru kapalı kullanıcı hiç açılamıyordu.
    await createUserAction(
      { error: null, success: null, blockers: null },
      ekleme({ title: "Danışman", writesActivities: "on" }),
    );

    const kayit = await testDb.user.findFirstOrThrow({
      where: { fullName: "Yeni Personel" },
    });
    expect(kayit.isScored).toBe(false);
  });

  it("işaretli skor kutusu true olur", async () => {
    await createUserAction(
      { error: null, success: null, blockers: null },
      ekleme({ title: "Usta", writesActivities: "on", isScored: "on" }),
    );

    const kayit = await testDb.user.findFirstOrThrow({
      where: { fullName: "Yeni Personel" },
    });
    expect(kayit.isScored).toBe(true);
  });
});

describe("sistem yöneticisi kullanıcı düzenler", () => {
  async function hedef() {
    return seedUser(birimId, {
      fullName: "Mevcut Personel",
      email: "mevcut@ornek.test",
      title: "Eski Unvan",
      isScored: true,
    });
  }

  function guncelleme(id: string, alanlar: Record<string, string>): FormData {
    const form = new FormData();
    form.set("id", id);
    form.set("fullName", "Mevcut Personel");
    form.set("email", "mevcut@ornek.test");
    form.set("orgUnitId", birimId);
    for (const [ad, deger] of Object.entries(alanlar)) form.set(ad, deger);
    return form;
  }

  it("unvan güncellenir ve her kaydetmede silinmez", async () => {
    const kisi = await hedef();

    await updateUserAction(
      { error: null, success: null, blockers: null },
      guncelleme(kisi.id, { title: "Yeni Unvan", writesActivities: "on", isScored: "on" }),
    );

    const taze = await testDb.user.findUniqueOrThrow({ where: { id: kisi.id } });
    expect(taze.title).toBe("Yeni Unvan");
  });

  it("işaretsiz skor kutusu kaydetmede false olur", async () => {
    const kisi = await hedef();

    await updateUserAction(
      { error: null, success: null, blockers: null },
      guncelleme(kisi.id, { title: "Yeni Unvan", writesActivities: "on" }),
    );

    const taze = await testDb.user.findUniqueOrThrow({ where: { id: kisi.id } });
    expect(taze.isScored).toBe(false);
  });
});
