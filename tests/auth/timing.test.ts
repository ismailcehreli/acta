import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Parola işini sahte fonksiyonla ölçüyoruz: amaç doğruluk değil, farklı hesap
// durumlarının **aynı** maliyeti ödediğini kanıtlamak.
vi.mock("@/server/auth/password", () => ({
  hashPassword: vi.fn(async () => "sahte-ozet"),
  verifyPassword: vi.fn(async () => false),
}));

import { LOCKOUT_MINUTES } from "@/server/auth/config";
import { login } from "@/server/auth/login";
import { verifyPassword } from "@/server/auth/password";
import { resetRateLimits } from "@/server/auth/rate-limit";

import { createOrgUnit, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Denetim FAZ 2, bulgu 2: kilitli hesap hiç gecikme ve parola doğrulama
// maliyeti ödemeden dönüyordu. Dışarıdaki metnin aynı olması yetmez — cevap
// süresi de "bu e-posta kayıtlı ve aktif" bilgisini sızdırır.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  vi.mocked(verifyPassword).mockClear();
});

afterAll(async () => {
  await testDb.$disconnect();
});

interface Cost {
  sleepCalls: number[];
  verifyCalls: number;
}

async function measure(email: string, key: string): Promise<Cost> {
  const sleepCalls: number[] = [];
  vi.mocked(verifyPassword).mockClear();

  await login(
    {
      db: testDb,
      now: NOW,
      rateLimitKey: key,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    },
    { email, password: "denenen-parola" },
  );

  return { sleepCalls, verifyCalls: vi.mocked(verifyPassword).mock.calls.length };
}

describe("hesap durumları aynı maliyeti öder", () => {
  it("kilitli hesap ile kayıtsız e-posta aynı gecikmeyi ve hash işini görür", async () => {
    const unit = await createOrgUnit();
    const user = await createUserWithPassword(unit.id, "parola", {
      email: "kilitli@ornek.test",
    });
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: {
        failedLoginCount: 10,
        lockedUntil: new Date(NOW.getTime() + LOCKOUT_MINUTES * 60_000),
      },
    });

    const kilitli = await measure("kilitli@ornek.test", "10.0.0.1");
    const kayitsiz = await measure("yok@ornek.test", "10.0.0.2");

    expect(kilitli.sleepCalls).toEqual(kayitsiz.sleepCalls);
    expect(kilitli.verifyCalls).toBe(kayitsiz.verifyCalls);
    // Her iki yol da gerçekten bir parola doğrulaması çalıştırmalı.
    expect(kilitli.verifyCalls).toBeGreaterThan(0);
  });

  it("yanlış parola yolu da aynı sayıda hash işi çalıştırır", async () => {
    const unit = await createOrgUnit();
    await createUserWithPassword(unit.id, "parola", {
      email: "aktif@ornek.test",
    });

    const yanlisParola = await measure("aktif@ornek.test", "10.0.0.3");
    const kayitsiz = await measure("yok2@ornek.test", "10.0.0.4");

    expect(yanlisParola.verifyCalls).toBe(kayitsiz.verifyCalls);
    expect(yanlisParola.sleepCalls).toEqual(kayitsiz.sleepCalls);
  });
});
