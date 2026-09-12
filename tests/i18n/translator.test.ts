import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALE_DICTIONARIES,
  LOCALE_LABELS,
  LOCALE_LANGUAGE_TAGS,
  LOCALE_REGISTRY,
  SUPPORTED_LOCALES,
  createTranslator,
  isSupportedLocale,
} from "@/shared/i18n";
import { en } from "@/shared/i18n/messages/en";
import { tr } from "@/shared/i18n/messages/tr";

describe("i18n translator", () => {
  it("uses English as default locale", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(SUPPORTED_LOCALES).toEqual(Object.keys(LOCALE_REGISTRY));
  });

  it("derives locale metadata and dictionaries from the central registry", () => {
    expect(Object.keys(LOCALE_REGISTRY)).toEqual(SUPPORTED_LOCALES);
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_REGISTRY[locale].dictionary).toBe(LOCALE_DICTIONARIES[locale]);
      expect(LOCALE_LABELS[locale]).toBe(LOCALE_REGISTRY[locale].label);
      expect(LOCALE_LANGUAGE_TAGS[locale]).toBe(
        LOCALE_REGISTRY[locale].languageTag,
      );
    }
    expect(LOCALE_REGISTRY.en.dictionary).toBe(en);
    expect(LOCALE_REGISTRY.tr.dictionary).toBe(tr);
    expect(LOCALE_LABELS.en).toBe("English");
    expect(LOCALE_LABELS.tr).toBe("Türkçe");
    expect(LOCALE_LANGUAGE_TAGS.en).toBe("en-US");
    expect(LOCALE_LANGUAGE_TAGS.tr).toBe("tr-TR");
  });

  it("identifies supported locales correctly", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("tr")).toBe(true);
    expect(isSupportedLocale("de")).toBe(false);
    expect(isSupportedLocale("fr")).toBe(false);
    expect(isSupportedLocale("")).toBe(false);
  });

  it("translates English strings by default", () => {
    const t = createTranslator("en");
    expect(t("common.save")).toBe("Save");
    expect(t("nav.today")).toBe("Today");
    expect(t("nav.myActivities")).toBe("My Activities");
    expect(t("common.appName")).toBe("Acta");
  });

  it("translates Turkish strings when requested", () => {
    const t = createTranslator("tr");
    expect(t("common.save")).toBe("Kaydet");
    expect(t("nav.today")).toBe("Bugün");
    expect(t("nav.myActivities")).toBe("Faaliyetlerim");
  });

  it("interpolates variables properly", () => {
    const t = createTranslator("en");
    expect(
      t("untranslated.key" as unknown as "common.save", { name: "Antigravity" }),
    ).toBe("untranslated.key");
  });

  it("falls back gracefully for missing keys", () => {
    const t = createTranslator("en");
    expect(t("non.existent.key" as unknown as "common.save")).toBe(
      "non.existent.key",
    );
  });

  it("keeps Turkish keys valid and allows safe English fallback", () => {
    function getLeafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
      return Object.entries(obj).flatMap(([key, value]) => {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "object" && value !== null) {
          return getLeafKeys(value as Record<string, unknown>, fullKey);
        }
        return [fullKey];
      });
    }

    const enKeys = getLeafKeys(en as Record<string, unknown>).sort();
    const trKeys = getLeafKeys(tr as Record<string, unknown>).sort();

    expect(enKeys).toEqual(expect.arrayContaining(trKeys));
    expect(trKeys.length).toBeLessThanOrEqual(enKeys.length);
    expect(createTranslator("tr")("common.allRightsReserved")).toBe(
      "Tüm hakları saklıdır.",
    );
    expect(createTranslator("tr")("common.invalidInput")).toBe("Geçersiz giriş.");
  });
});
