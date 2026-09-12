import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  findSetting,
  SETTING_DEFINITIONS,
  SETTING_GROUPS,
  SETTING_KEYS,
  validateSettingValue,
} from "@/server/settings/registry";
import { createTranslator } from "@/shared/i18n";
import {
  readAllSettings,
  readBooleanSetting,
  readNumericSetting,
  saveSettings,
} from "@/server/settings/system-settings";

import { resetDatabase, testDb } from "../helpers/test-db";

// System settings (§16.5).

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("settings registry", () => {
  it("every setting belongs to a defined group", () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(SETTING_GROUPS).toContain(definition.group);
    }
  });

  it("setting keys are unique", () => {
    const keys = SETTING_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("default value of each setting complies with its validation rules", () => {
    for (const definition of SETTING_DEFINITIONS) {
      const result = validateSettingValue(definition, definition.defaultValue);
      expect(result.ok, `default value for ${definition.key} is invalid`).toBe(true);
    }
  });

  it("every setting has a label and description", () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(20);
    }
  });

  it("every setting presentation key resolves in the English dictionary", () => {
    const t = createTranslator("en");

    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.labelKey).toBeDefined();
      expect(definition.descriptionKey).toBeDefined();
      expect(t(definition.labelKey!)).not.toBe(definition.labelKey);
      expect(t(definition.descriptionKey!)).not.toBe(definition.descriptionKey);

      for (const option of definition.options ?? []) {
        expect(option.labelKey).toBeDefined();
        expect(t(option.labelKey!)).not.toBe(option.labelKey);
      }
    }
  });
});

describe("validation", () => {
  const numericSetting = findSetting(SETTING_KEYS.overdueAnswerBusinessDays)!;

  it("value outside bounds is rejected", () => {
    expect(validateSettingValue(numericSetting, "0").ok).toBe(false);
    expect(validateSettingValue(numericSetting, "31").ok).toBe(false);
    expect(validateSettingValue(numericSetting, "1").ok).toBe(true);
    expect(validateSettingValue(numericSetting, "30").ok).toBe(true);
  });

  it("non-numeric value is rejected", () => {
    for (const invalid of ["", "  ", "three", "3.5", "3a"]) {
      expect(validateSettingValue(numericSetting, invalid).ok).toBe(false);
    }
  });

  it("boolean setting only accepts true or false", () => {
    const booleanSetting = findSetting(SETTING_KEYS.managerParticipationSummary)!;
    expect(validateSettingValue(booleanSetting, "true").ok).toBe(true);
    expect(validateSettingValue(booleanSetting, "false").ok).toBe(true);
    expect(validateSettingValue(booleanSetting, "yes").ok).toBe(false);
  });
});

describe("read and write", () => {
  it("reads default when not persisted", async () => {
    expect(
      await readNumericSetting(testDb, SETTING_KEYS.overdueAnswerBusinessDays),
    ).toBe(3);
    expect(
      await readBooleanSetting(testDb, SETTING_KEYS.managerParticipationSummary),
    ).toBe(false);
  });

  it("reads saved value", async () => {
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.overdueAnswerBusinessDays]: "1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toEqual([SETTING_KEYS.overdueAnswerBusinessDays]);
    expect(
      await readNumericSetting(testDb, SETTING_KEYS.overdueAnswerBusinessDays),
    ).toBe(1);
  });

  it("nothing is saved if any value is invalid", async () => {
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.overdueAnswerBusinessDays]: "2",
      [SETTING_KEYS.editWindowMinutes]: "-5",
    });

    expect(result.ok).toBe(false);
    expect(await testDb.systemSetting.count()).toBe(0);
    expect(
      await readNumericSetting(testDb, SETTING_KEYS.overdueAnswerBusinessDays),
    ).toBe(3);
  });

  it("undefined key cannot be written", async () => {
    const result = await saveSettings(testDb, { non_existent_setting: "5" });

    expect(result.ok).toBe(false);
    expect(await testDb.systemSetting.count()).toBe(0);
  });

  it("corrupted persisted value falls back to default without crashing", async () => {
    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.editWindowMinutes,
        value: "corrupt",
        description: "manually corrupted",
      },
    });

    expect(await readNumericSetting(testDb, SETTING_KEYS.editWindowMinutes)).toBe(
      15,
    );
  });

  it("throws error when trying to read undefined key", async () => {
    await expect(readNumericSetting(testDb, "non_existent_key")).rejects.toThrow(
      /Undefined setting key/i,
    );
  });

  it("all settings returned in single read", async () => {
    const all = await readAllSettings(testDb);

    for (const definition of SETTING_DEFINITIONS) {
      expect(all[definition.key]).toBe(definition.defaultValue);
    }
  });
});
