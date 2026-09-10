import { describe, expect, it } from "vitest";

import {
  checkActivityDate,
  companyDay,
  toDateValue,
} from "@/server/activities/date-rules";

// Gün hesabı şirketin yerel saatine göre yapılır (§16.6). Sunucu UTC'de
// çalıştığı için bu ayrım gerçek bir hata kaynağıdır: İstanbul'da 02:00,
// UTC'de hâlâ bir önceki gündür.

describe("şirket günü", () => {
  it("UTC gece yarısından sonraki saatlerde yerel gün ileri gider", () => {
    // 16 Ağustos 22:00 UTC = 17 Ağustos 01:00 İstanbul.
    expect(companyDay(new Date("2026-08-16T22:00:00.000Z"))).toBe("2026-08-17");
  });

  it("gün başı UTC olarak saklanır", () => {
    expect(toDateValue("2026-08-17").toISOString()).toBe(
      "2026-08-17T00:00:00.000Z",
    );
  });
});

describe("faaliyet tarihi sınırı", () => {
  const now = new Date("2026-08-17T09:00:00.000Z");

  it("bugün kabul edilir", () => {
    expect(checkActivityDate("2026-08-17", now, 1)).toBeNull();
  });

  it("izin verilen pencere içindeki geçmiş gün kabul edilir", () => {
    expect(checkActivityDate("2026-08-16", now, 1)).toBeNull();
  });

  it("pencere dışındaki geçmiş gün reddedilir", () => {
    expect(checkActivityDate("2026-08-15", now, 1)).toBe("too_old");
  });

  it("ileri tarih reddedilir", () => {
    expect(checkActivityDate("2026-08-18", now, 1)).toBe("future");
  });

  it("pencere genişletilince sınır o kadar geriye kayar", () => {
    // 7 günlük pencerede 10 Ağustos tam sınırdadır, 9 Ağustos dışarıda kalır.
    expect(checkActivityDate("2026-08-10", now, 7)).toBeNull();
    expect(checkActivityDate("2026-08-09", now, 7)).toBe("too_old");
  });

  it("gece yarısına yakın saatte de yerel güne göre karar verilir", () => {
    // 17 Ağustos 21:30 UTC = 18 Ağustos 00:30 İstanbul; o an "bugün" 18'dir.
    const geceYarisi = new Date("2026-08-17T21:30:00.000Z");
    expect(checkActivityDate("2026-08-18", geceYarisi, 1)).toBeNull();
    expect(checkActivityDate("2026-08-16", geceYarisi, 1)).toBe("too_old");
  });
});
