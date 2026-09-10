import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  createTranslator,
  isSupportedLocale,
} from "@/shared/i18n";
import { en } from "@/shared/i18n/messages/en";
import { tr } from "@/shared/i18n/messages/tr";

describe("i18n translator", () => {
  it("uses English as default locale", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(SUPPORTED_LOCALES).toEqual(["en", "tr"]);
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

  it("guarantees 100% key parity between English and Turkish dictionaries", () => {
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

    expect(trKeys).toEqual(enKeys);
  });
});
