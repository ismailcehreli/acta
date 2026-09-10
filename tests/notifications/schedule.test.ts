import { describe, expect, it } from "vitest";

import {
  DIGEST_HOUR,
  isDigestDue,
  isExhausted,
  isRetryDue,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
} from "@/server/notifications/schedule";

// Gönderim kararı saf fonksiyonlarda; sahte saatle sınanır (§12.3).

const NOW = new Date("2026-08-17T09:00:00.000Z");

describe("artan aralıklı yeniden deneme", () => {
  it("hiç denenmemiş bildirim beklemez", () => {
    expect(isRetryDue({ attemptCount: 0, lastAttemptAt: null }, NOW)).toBe(true);
  });

  it("her denemeden sonra bekleme süresi artar", () => {
    for (let deneme = 1; deneme < MAX_ATTEMPTS; deneme += 1) {
      const gecikme = RETRY_DELAYS_MS[deneme - 1];
      const kayit = { attemptCount: deneme, lastAttemptAt: NOW };

      expect(
        isRetryDue(kayit, new Date(NOW.getTime() + gecikme - 1)),
        `${deneme}. denemeden sonra erken gönderim`,
      ).toBe(false);
      expect(isRetryDue(kayit, new Date(NOW.getTime() + gecikme))).toBe(true);
    }
  });

  it("süreler gerçekten artıyor", () => {
    for (let i = 1; i < RETRY_DELAYS_MS.length; i += 1) {
      expect(RETRY_DELAYS_MS[i]).toBeGreaterThan(RETRY_DELAYS_MS[i - 1]);
    }
  });

  it("beş denemeden sonra vazgeçilir", () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect(isExhausted(4)).toBe(false);
    expect(isExhausted(5)).toBe(true);
    expect(
      isRetryDue(
        { attemptCount: MAX_ATTEMPTS, lastAttemptAt: NOW },
        new Date(NOW.getTime() + 10 * 24 * 3_600_000),
      ),
    ).toBe(false);
  });
});

describe("günlük özet zamanı", () => {
  // Şirket saati Europe/Istanbul (UTC+3): 15:00 UTC = 18:00 İstanbul.
  const ozetSaati = new Date("2026-08-17T15:00:00.000Z");

  it("özet saatinden önce gönderilmez", () => {
    expect(isDigestDue(new Date("2026-08-17T14:59:00.000Z"), null)).toBe(false);
  });

  it("özet saati gelince ve bugün gitmediyse gönderilir", () => {
    expect(isDigestDue(ozetSaati, null)).toBe(true);
  });

  it("aynı gün ikinci kez gönderilmez", () => {
    const bugunGonderildi = new Date("2026-08-17T15:01:00.000Z");

    expect(isDigestDue(new Date("2026-08-17T20:00:00.000Z"), bugunGonderildi)).toBe(
      false,
    );
  });

  it("ertesi gün yeniden gönderilir", () => {
    const dunGonderildi = new Date("2026-08-17T15:01:00.000Z");

    expect(isDigestDue(new Date("2026-08-18T15:00:00.000Z"), dunGonderildi)).toBe(
      true,
    );
  });

  it("gün sınırı şirket saatinden hesaplanır", () => {
    // 17 Ağustos 21:30 UTC = 18 Ağustos 00:30 İstanbul: yeni gün başladı ama
    // özet saati (18:00) henüz gelmedi.
    expect(isDigestDue(new Date("2026-08-17T21:30:00.000Z"), null)).toBe(false);
    expect(DIGEST_HOUR).toBe(18);
  });
});
