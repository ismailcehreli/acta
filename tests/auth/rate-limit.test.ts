import { beforeEach, describe, expect, it } from "vitest";

import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "@/server/auth/config";
import {
  clearFailures,
  peekFailures,
  pruneRateLimits,
  recordFailure,
  resetRateLimits,
  trackedKeyCount,
} from "@/server/auth/rate-limit";

// Sayılan şey **başarısız denemelerdir**, istek sayısı değil: şirket tek bir
// dış adresin arkasındadır (§15.5) ve her isteği saymak, aynı anda giriş yapan
// meslektaşların birbirini kilitlemesi demekti.

const START = 1_000_000;
const KEY = "hesap:mudur@ornek.test";

beforeEach(() => {
  resetRateLimits();
});

describe("başarısız deneme sayacı", () => {
  it("hiç deneme yokken engel yoktur", () => {
    expect(peekFailures(KEY, START)).toEqual({
      blocked: false,
      count: 0,
      retryAfterMs: 0,
    });
  });

  it("okuma sayacı artırmaz", () => {
    recordFailure(KEY, START);

    peekFailures(KEY, START);
    peekFailures(KEY, START);

    expect(peekFailures(KEY, START).count).toBe(1);
  });

  it("sınıra kadar izin verir, sınırda engeller", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS - 1; i += 1) {
      recordFailure(KEY, START);
    }
    expect(peekFailures(KEY, START).blocked).toBe(false);

    recordFailure(KEY, START);
    expect(peekFailures(KEY, START).blocked).toBe(true);
    expect(peekFailures(KEY, START).retryAfterMs).toBe(RATE_LIMIT_WINDOW_MS);
  });

  it("pencere dolunca sayaç sıfırlanır", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      recordFailure(KEY, START);
    }

    const afterWindow = START + RATE_LIMIT_WINDOW_MS + 1;
    expect(peekFailures(KEY, afterWindow).blocked).toBe(false);
  });

  it("başarılı giriş sayacı temizler", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      recordFailure(KEY, START);
    }
    expect(peekFailures(KEY, START).blocked).toBe(true);

    clearFailures(KEY);

    expect(peekFailures(KEY, START).blocked).toBe(false);
  });

  it("bir anahtarın sayacı diğerini etkilemez", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      recordFailure(KEY, START);
    }

    expect(peekFailures("hesap:baska@ornek.test", START).blocked).toBe(false);
  });
});

describe("bellek yönetimi", () => {
  it("süresi dolmuş kayıtlar yeni pencere açılırken temizlenir", () => {
    for (let i = 0; i < 50; i += 1) {
      recordFailure(`istemci-${i}`, START);
    }
    expect(trackedKeyCount()).toBe(50);

    recordFailure("yeni-istemci", START + RATE_LIMIT_WINDOW_MS + 1);

    expect(trackedKeyCount()).toBe(1);
  });

  it("anahtar sayısı üst sınırı aşamaz", () => {
    for (let i = 0; i < 10_200; i += 1) {
      recordFailure(`istemci-${i}`, START);
    }

    expect(trackedKeyCount()).toBeLessThanOrEqual(10_000);
  });

  it("süresi dolmuş kayıtlar elle de temizlenebilir", () => {
    recordFailure(KEY, START);
    pruneRateLimits(START + RATE_LIMIT_WINDOW_MS + 1);

    expect(trackedKeyCount()).toBe(0);
  });
});
