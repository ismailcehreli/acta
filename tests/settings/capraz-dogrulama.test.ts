import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  SETTING_KEYS,
  readNumericSetting,
  saveSettings,
} from "@/server/settings/system-settings";

import { resetDatabase, testDb } from "../helpers/test-db";

// Ayarlar arası çapraz doğrulama (Görev 11.6).
//
// Her ayar bugüne dek tek başına doğrulanıyordu: türü, alt ve üst sınırı.
// Metin uzunluk sınırları **birbirine bağlı** ilk ayar çifti — "en az" değeri
// "en çok"tan büyük olursa hiçbir metin kabul edilmez ve kullanıcı formu
// dolduramaz. Kayıt defteri bu ilişkiyi bilmeli.
//
// Aynı mekanizma Görev 11.10'da skor ağırlıklarının toplamını zorlamak için
// kullanılacak.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

// Değerler **her ikisi de kendi sınırları içinde** seçiliyor; yalnız
// birbirlerine göre ters. İlk yazımda sınır dışı değerler kullanılmıştı ve
// testler tek tek doğrulamaya takılıp geçiyordu: çapraz kuralı hiç
// sınamıyorlardı.
describe("başlık uzunluk çifti", () => {
  it("en az, en çoktan büyük olamaz", async () => {
    // 80 ∈ [1,100] ve 50 ∈ [10,150]: ikisi de geçerli, ama 80 > 50.
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMinChars]: "80",
      [SETTING_KEYS.activityTitleMaxChars]: "50",
    });

    expect(sonuc.ok).toBe(false);
    if (!sonuc.ok) expect(sonuc.message).toMatch(/en az/i);
  });

  it("geçerli çift kaydedilir", async () => {
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMinChars]: "10",
      [SETTING_KEYS.activityTitleMaxChars]: "120",
    });

    expect(sonuc.ok).toBe(true);
    expect(await readNumericSetting(testDb, SETTING_KEYS.activityTitleMinChars)).toBe(10);
  });

  // Tek alan gönderildiğinde karşılaştırma **kayıtlı** değerle yapılmalı:
  // form yalnız değişen alanı gönderse de çift bozulmamalı.
  it("tek alan gönderilse de kayıtlı değerle karşılaştırılır", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMinChars]: "80",
      [SETTING_KEYS.activityTitleMaxChars]: "120",
    });

    // 50 ∈ [10,150] — kendi sınırında geçerli, ama kayıtlı "en az" 80.
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMaxChars]: "50",
    });

    expect(sonuc.ok).toBe(false);
  });
});

describe("açıklama uzunluk çifti", () => {
  it("en az, en çoktan büyük olamaz", async () => {
    // 900 ∈ [1,1000] ve 300 ∈ [100,10000]: ikisi de geçerli, ama 900 > 300.
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.activityDescriptionMinChars]: "900",
      [SETTING_KEYS.activityDescriptionMaxChars]: "300",
    });

    expect(sonuc.ok).toBe(false);
  });

  it("eşit değerler kabul edilir", async () => {
    // Alt ve üst sınırın eşit olması anlamsız değil: tam olarak N karakter
    // isteyen bir kural kurulabilir.
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.activityDescriptionMinChars]: "100",
      [SETTING_KEYS.activityDescriptionMaxChars]: "100",
    });

    expect(sonuc.ok).toBe(true);
  });
});

describe("veritabanı tavanı aşılamaz", () => {
  // Kolon genişliği (`VarChar(150)` / `VarChar(10000)`) yerinde kalıyor; ayar
  // o tavanın **içinde** hareket eder. Aksi hâlde her ayar değişikliği bir
  // veritabanı geçişine dönerdi.
  it("başlık üst sınırı kolon genişliğini aşamaz", async () => {
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMaxChars]: "500",
    });

    expect(sonuc.ok).toBe(false);
  });

  it("açıklama üst sınırı kolon genişliğini aşamaz", async () => {
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.activityDescriptionMaxChars]: "20000",
    });

    expect(sonuc.ok).toBe(false);
  });
});
