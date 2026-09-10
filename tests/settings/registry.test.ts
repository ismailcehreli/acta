import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  findSetting,
  SETTING_DEFINITIONS,
  SETTING_GROUPS,
  SETTING_KEYS,
  validateSettingValue,
} from "@/server/settings/registry";
import {
  readAllSettings,
  readBooleanSetting,
  readNumericSetting,
  saveSettings,
} from "@/server/settings/system-settings";

import { resetDatabase, testDb } from "../helpers/test-db";

// Sistem ayarları (§16.5). Amaç işletimsel: bir parametreyi değiştirmek için
// kod okumak, dosya bulmak ve sürüm çıkarmak gerekmemeli.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("kayıt defteri", () => {
  it("her ayarın grubu tanımlı gruplardan biridir", () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(SETTING_GROUPS).toContain(definition.group);
    }
  });

  it("anahtarlar tekildir", () => {
    const anahtarlar = SETTING_DEFINITIONS.map((d) => d.key);
    expect(new Set(anahtarlar).size).toBe(anahtarlar.length);
  });

  it("her ayarın varsayılanı kendi kurallarına uyar", () => {
    for (const definition of SETTING_DEFINITIONS) {
      const sonuc = validateSettingValue(definition, definition.defaultValue);
      expect(sonuc.ok, `${definition.key} varsayılanı geçersiz`).toBe(true);
    }
  });

  it("her ayarın Türkçe etiketi ve açıklaması vardır", () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.label.length).toBeGreaterThan(0);
      // Açıklama ekranda yol gösterir; tek kelimelik etiket yetmez.
      expect(definition.description.length).toBeGreaterThan(20);
    }
  });
});

describe("doğrulama", () => {
  const sayisal = findSetting(SETTING_KEYS.overdueAnswerBusinessDays)!;

  it("sınırların dışındaki değer reddedilir", () => {
    expect(validateSettingValue(sayisal, "0").ok).toBe(false);
    expect(validateSettingValue(sayisal, "31").ok).toBe(false);
    expect(validateSettingValue(sayisal, "1").ok).toBe(true);
    expect(validateSettingValue(sayisal, "30").ok).toBe(true);
  });

  it("sayı olmayan değer reddedilir", () => {
    for (const bozuk of ["", "  ", "üç", "3.5", "3a"]) {
      expect(validateSettingValue(sayisal, bozuk).ok).toBe(false);
    }
  });

  it("mantıksal ayar yalnız açık/kapalı alır", () => {
    const mantiksal = findSetting(SETTING_KEYS.managerParticipationSummary)!;
    expect(validateSettingValue(mantiksal, "true").ok).toBe(true);
    expect(validateSettingValue(mantiksal, "false").ok).toBe(true);
    expect(validateSettingValue(mantiksal, "evet").ok).toBe(false);
  });
});

describe("okuma ve yazma", () => {
  it("kayıt yokken varsayılan okunur", async () => {
    expect(
      await readNumericSetting(testDb, SETTING_KEYS.overdueAnswerBusinessDays),
    ).toBe(3);
    expect(
      await readBooleanSetting(testDb, SETTING_KEYS.managerParticipationSummary),
    ).toBe(false);
  });

  it("kaydedilen değer okunur", async () => {
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.overdueAnswerBusinessDays]: "1",
    });

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.changed).toEqual([SETTING_KEYS.overdueAnswerBusinessDays]);
    expect(
      await readNumericSetting(testDb, SETTING_KEYS.overdueAnswerBusinessDays),
    ).toBe(1);
  });

  it("geçersiz değerde hiçbiri yazılmaz", async () => {
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.overdueAnswerBusinessDays]: "2",
      [SETTING_KEYS.editWindowMinutes]: "-5",
    });

    expect(sonuc.ok).toBe(false);
    // Geçerli olan da yazılmamalı: yarısı yeni yarısı eski yapılandırma kalırdı.
    expect(await testDb.systemSetting.count()).toBe(0);
    expect(
      await readNumericSetting(testDb, SETTING_KEYS.overdueAnswerBusinessDays),
    ).toBe(3);
  });

  it("tanımsız anahtar yazılamaz", async () => {
    const sonuc = await saveSettings(testDb, { uydurma_ayar: "5" });

    expect(sonuc.ok).toBe(false);
    expect(await testDb.systemSetting.count()).toBe(0);
  });

  it("bozuk kayıt sistemi durdurmaz, varsayılana düşer", async () => {
    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.editWindowMinutes,
        value: "bozuk",
        description: "elle bozuldu",
      },
    });

    expect(await readNumericSetting(testDb, SETTING_KEYS.editWindowMinutes)).toBe(
      15,
    );
  });

  it("tanımsız anahtar okunmaya çalışılırsa hata verir", async () => {
    await expect(readNumericSetting(testDb, "yok_boyle_bir_ayar")).rejects.toThrow(
      /Tanımsız ayar anahtarı/,
    );
  });

  it("tüm ayarlar tek okumada döner", async () => {
    const hepsi = await readAllSettings(testDb);

    for (const definition of SETTING_DEFINITIONS) {
      expect(hepsi[definition.key]).toBe(definition.defaultValue);
    }
  });
});
