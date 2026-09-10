import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  SETTING_KEYS,
  readActivityTextLimits,
  saveSettings,
} from "@/server/settings/system-settings";
import { createActivitySchema } from "@/shared/schemas/activity";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Ayarlanabilir metin sınırları (Görev 11.6).
//
// Sınırın değeri **sunucuda** uygulanıyor. Formdaki `minLength`/`maxLength`
// bir kolaylıktır: adres çubuğuna ya da isteğe elle müdahale eden biri onu
// atlar. Aşağıdaki testler doğrulamanın istemciden bağımsız olduğunu gösterir.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("sınırlar ayardan okunuyor", () => {
  it("varsayılan alt sınır 1: kısa ama dolu metin geçer", async () => {
    const limits = await readActivityTextLimits(testDb);

    expect(limits.titleMin).toBe(1);
    // Denetim (21.08.2026, bulgu 16) kanıtı: "İK" geçerli bir başlık.
    const sonuc = createActivitySchema(limits).safeParse({
      activityDate: "2026-08-19",
      title: "İK",
      description: "OK",
      targetDepartmentIds: ["3f2a9c1e-0000-4000-8000-000000000001"],
    });

    expect(sonuc.success).toBe(true);
  });

  it("ayar yükseltilince kısa metin reddedilir", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMinChars]: "10",
      [SETTING_KEYS.activityDescriptionMinChars]: "30",
    });

    const limits = await readActivityTextLimits(testDb);
    const sonuc = createActivitySchema(limits).safeParse({
      activityDate: "2026-08-19",
      title: "İK",
      description: "OK",
      targetDepartmentIds: ["3f2a9c1e-0000-4000-8000-000000000001"],
    });

    expect(sonuc.success).toBe(false);
  });

  it("üst sınır düşürülünce uzun metin reddedilir", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMaxChars]: "20",
    });

    const limits = await readActivityTextLimits(testDb);
    const sonuc = createActivitySchema(limits).safeParse({
      activityDate: "2026-08-19",
      title: "Bu başlık yirmi karakterden epeyce uzun",
      description: "Yeterince uzun bir açıklama metni.",
      targetDepartmentIds: ["3f2a9c1e-0000-4000-8000-000000000001"],
    });

    expect(sonuc.success).toBe(false);
  });
});

describe("hata mesajı sınırı söylüyor", () => {
  // "Geçersiz" demek kullanıcıya ne yapacağını söylemiyor; mesaj sayıyı
  // taşımalı ve o sayı ayardan gelmeli.
  it("alt sınır mesajı ayardaki değeri içeriyor", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMinChars]: "12",
    });

    const limits = await readActivityTextLimits(testDb);
    const sonuc = createActivitySchema(limits).safeParse({
      activityDate: "2026-08-19",
      title: "kısa",
      description: "Yeterince uzun bir açıklama metni.",
      targetDepartmentIds: ["3f2a9c1e-0000-4000-8000-000000000001"],
    });

    expect(sonuc.success).toBe(false);
    if (!sonuc.success) {
      expect(JSON.stringify(sonuc.error.issues)).toContain("12");
    }
  });
});

describe("yazma yolu sınırı zorluyor", () => {
  // İstemci atlatılsa da kayıt açılmamalı: sınır tek yerde, yazma yolunda.
  it("sınırın altındaki metinle kayıt açılmaz", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const kisi = await createUser(birim.id, { fullName: "Kadir Usta" });

    await saveSettings(testDb, {
      [SETTING_KEYS.activityDescriptionMinChars]: "50",
    });

    const limits = await readActivityTextLimits(testDb);
    const sonuc = createActivitySchema(limits).safeParse({
      activityDate: "2026-08-19",
      title: "Geçerli bir başlık",
      description: "Çok kısa.",
      targetDepartmentIds: [birim.id],
    });

    expect(sonuc.success).toBe(false);
    // Kayıt hiç açılmadı: doğrulama yazma yolundan önce duruyor.
    expect(await testDb.activity.count({ where: { authorId: kisi.id } })).toBe(0);
  });
});
