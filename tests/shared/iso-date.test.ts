import { describe, expect, it } from "vitest";

import { absenceDateSchema } from "@/shared/schemas/absence";
import { activityDateSchema } from "@/shared/schemas/activity";
import { isCalendarDay } from "@/shared/schemas/iso-date";

// TAKVİMDE OLMAYAN GÜN KABUL EDİLMEZ (denetim 21.08.2026, bulgu 17).
//
// Şemalar yalnız biçime bakıyordu. `2026-02-31` regexten geçiyor ve `new Date`
// onu sessizce 3 Mart'a yuvarlıyordu; `2026-99-99` ise geçersiz bir tarih
// olarak veri katmanına kadar taşınıyordu.
//
// Sunucu istemci kontrolüne güvenemez: elle hazırlanmış bir istek bu
// değerleri doğrudan gönderir.

describe("isCalendarDay", () => {
  it("gerçek günleri kabul eder", () => {
    for (const gun of ["2026-01-01", "2026-08-21", "2026-12-31", "2024-02-29"]) {
      expect(isCalendarDay(gun)).toBe(true);
    }
  });

  it("takvimde olmayan günleri reddeder", () => {
    // 31 Şubat: `new Date` bunu 3 Mart'a yuvarlardı.
    expect(isCalendarDay("2026-02-31")).toBe(false);
    // Artık olmayan yılda 29 Şubat.
    expect(isCalendarDay("2026-02-29")).toBe(false);
    // 31 gün çekmeyen ay.
    expect(isCalendarDay("2026-04-31")).toBe(false);
  });

  it("olmayan ay ve gün numaralarını reddeder", () => {
    for (const gun of ["2026-00-10", "2026-13-01", "2026-08-00", "2026-08-32"]) {
      expect(isCalendarDay(gun)).toBe(false);
    }
  });

  it("biçimi bozuk değerleri reddeder", () => {
    for (const gun of ["2026-8-21", "21.08.2026", "2026-99-99", "", "bugün"]) {
      expect(isCalendarDay(gun)).toBe(false);
    }
  });
});

describe("tarih alanı olan şemalar aynı kuralı kullanır", () => {
  it("faaliyet tarihi", () => {
    expect(activityDateSchema.safeParse("2026-02-31").success).toBe(false);
    expect(activityDateSchema.safeParse("2026-08-21").success).toBe(true);
  });

  it("izin tarihi", () => {
    expect(absenceDateSchema.safeParse("2026-04-31").success).toBe(false);
    expect(absenceDateSchema.safeParse("2026-04-30").success).toBe(true);
  });
});

// Belgede olmayan alt sınır (bulgu 16).
describe("başlık ve açıklamada alt sınır yok", () => {
  it("iki karakterlik başlık kabul edilir", async () => {
    const { activityTitleSchema, activityDescriptionSchema, DEFAULT_TEXT_LIMITS } =
      await import("@/shared/schemas/activity");

    // Sınırlar Görev 11.6'da ayara taşındı; **varsayılan** alt sınır hâlâ 1,
    // yani bu denetim bulgusunun kanıtı yerinde duruyor.
    expect(activityTitleSchema(DEFAULT_TEXT_LIMITS).safeParse("İK").success).toBe(true);
    expect(
      activityDescriptionSchema(DEFAULT_TEXT_LIMITS).safeParse("OK").success,
    ).toBe(true);
  });

  it("boş değer yine reddedilir", async () => {
    const { activityTitleSchema, DEFAULT_TEXT_LIMITS } = await import(
      "@/shared/schemas/activity"
    );

    expect(activityTitleSchema(DEFAULT_TEXT_LIMITS).safeParse("   ").success).toBe(
      false,
    );
  });
});
