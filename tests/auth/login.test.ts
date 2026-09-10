import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  RATE_LIMIT_MAX_REQUESTS,
} from "@/server/auth/config";
import { login } from "@/server/auth/login";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { findActiveSession } from "@/server/auth/session";

import { createOrgUnit, createUser, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-17T09:00:00.000Z");
const PASSWORD = "dogru-parola-123";

// Gecikme kuralı ayrıca test edilir (lockout.test.ts); burada beklemeden
// geçilir ki giriş akışının kendisi hızlı sınanabilsin.
const noWait = async () => {};

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function newUserWithPassword() {
  const unit = await createOrgUnit();
  return createUserWithPassword(unit.id, PASSWORD, {
    email: "mudur@ornek.test",
  });
}

function attempt(password: string, now: Date = NOW, key = "10.0.0.1") {
  return login(
    { db: testDb, now, rateLimitKey: key, sleep: noWait },
    { email: "mudur@ornek.test", password },
  );
}

describe("başarılı giriş", () => {
  it("doğru parola oturum açar", async () => {
    const user = await newUserWithPassword();

    const result = await attempt(PASSWORD);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.userId).toBe(user.id);
    expect(await findActiveSession(testDb, result.session.token, NOW)).not.toBeNull();
    expect(
      (await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt,
    ).toEqual(NOW);
  });

  it("başarılı girişte hata sayacı sıfırlanır", async () => {
    const user = await newUserWithPassword();

    await attempt("yanlis-parola");
    await attempt(PASSWORD);

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.failedLoginCount).toBe(0);
  });
});

describe("başarısız giriş", () => {
  it("yanlış parola reddedilir ve sayaç artar", async () => {
    const user = await newUserWithPassword();

    const result = await attempt("yanlis-parola");

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(
      (await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt,
    ).toBeNull();
    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.failedLoginCount).toBe(1);
  });

  it("kayıtsız e-posta, yanlış parolayla aynı cevabı alır", async () => {
    await newUserWithPassword();

    const result = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: noWait },
      { email: "yok@ornek.test", password: PASSWORD },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("pasifleştirilmiş kullanıcı giriş yapamaz", async () => {
    const user = await newUserWithPassword();
    await testDb.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    expect(await attempt(PASSWORD)).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it("parolası kurulmamış kullanıcı giriş yapamaz", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id, { email: "parolasiz@ornek.test" });

    const result = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: noWait },
      { email: "parolasiz@ornek.test", password: PASSWORD },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("her hatada gecikme uygulanır ve süre büyür", async () => {
    await newUserWithPassword();
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    for (let i = 0; i < 3; i += 1) {
      await login(
        { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep },
        { email: "mudur@ornek.test", password: "yanlis-parola" },
      );
    }

    expect(sleep.mock.calls.map((call) => call[0])).toEqual([0, 200, 400]);
  });
});

describe("hesap kilitleme", () => {
  it(`${MAX_FAILED_ATTEMPTS}. hatalı denemede hesap kilitlenir`, async () => {
    const user = await newUserWithPassword();

    let result = await attempt("yanlis-parola");
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i += 1) {
      result = await attempt("yanlis-parola");
    }

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("locked");

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.lockedUntil).not.toBeNull();
  });

  it("kilitliyken doğru parola da kabul edilmez", async () => {
    await newUserWithPassword();

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      await attempt("yanlis-parola");
    }

    const result = await attempt(PASSWORD);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("locked");
  });

  it("kilit süresi dolunca doğru parola çalışır", async () => {
    await newUserWithPassword();

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      await attempt("yanlis-parola");
    }

    const afterLock = new Date(NOW.getTime() + (LOCKOUT_MINUTES + 1) * 60_000);
    const result = await attempt(PASSWORD, afterLock);

    expect(result.ok).toBe(true);
  });
});

describe("hız sınırı", () => {
  // Deneme kayıtsız bir e-postayla yapılır: burada ölçülen hesap kilidi değil,
  // istemci bazlı hız sınırıdır.
  async function floodFrom(key: string) {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      await login(
        { db: testDb, now: NOW, rateLimitKey: key, sleep: noWait },
        { email: "yok@ornek.test", password: "yanlis-parola" },
      );
    }
  }

  it("aynı istemciden gelen aşırı deneme reddedilir", async () => {
    await newUserWithPassword();
    await floodFrom("10.0.0.9");

    const result = await attempt(PASSWORD, NOW, "10.0.0.9");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("rate_limited");
  });

  it("bir istemcinin sınırı diğerinin girişini engellemez", async () => {
    await newUserWithPassword();
    await floodFrom("10.0.0.9");

    const result = await attempt(PASSWORD, NOW, "10.0.0.10");
    expect(result.ok).toBe(true);
  });
});

// Denetim (17.08.2026) sonrası eklenen testler.
describe("denetim düzeltmeleri", () => {
  it("eşzamanlı hatalı denemeler sayacı kaybetmez ve kilit devreye girer", async () => {
    const user = await newUserWithPassword();

    // Aynı anda gelen denemeler: sayaç okunup geri yazılsaydı hepsi aynı eski
    // değeri görür, hesap hiç kilitlenmezdi (bulgu 6).
    await Promise.all(
      Array.from({ length: MAX_FAILED_ATTEMPTS }, (_, i) =>
        attempt("yanlis-parola", NOW, `10.0.1.${i}`),
      ),
    );

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });

    expect(credential.failedLoginCount).toBe(MAX_FAILED_ATTEMPTS);
    expect(credential.lockedUntil).not.toBeNull();

    const afterwards = await attempt(PASSWORD, NOW, "10.0.2.1");
    expect(afterwards.ok).toBe(false);
    if (afterwards.ok) return;
    expect(afterwards.reason).toBe("locked");
  });

  it("tek hesabı hedefleyen denemeler istemci değiştirilerek sürdürülemez", async () => {
    await newUserWithPassword();

    // Her denemede farklı istemci adresi: istemci sayacı sıfırlanır ama hesap
    // sayacı işlemeye devam eder (bulgu 7).
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      await attempt("yanlis-parola", NOW, `10.9.9.${i}`);
    }

    const result = await attempt("yanlis-parola", NOW, "10.9.8.1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("rate_limited");
  });

  it("kayıtsız e-postaya da artan gecikme uygulanır", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    for (let i = 0; i < 3; i += 1) {
      await login(
        { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep },
        { email: "yok@ornek.test", password: "yanlis-parola" },
      );
    }

    // Gecikmenin hiç uygulanmaması, e-postanın kayıtsız olduğunu ele verirdi
    // (bulgu 8).
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([0, 200, 400]);
  });
});

// "Beni hatırla" (ürün sahibi isteği, 21.08.2026).
//
// Sınanan asıl kural: bu seçenek **yalnız oturum süresini** uzatır. Kilit,
// hız sınırı ve parola değişiminde oturum iptali aynen işlemeli — yoksa
// "beni hatırla" sessizce bir güvenlik gevşetmesine dönüşür.
describe("beni hatırla", () => {
  async function ayarla(gun: number) {
    await testDb.systemSetting.upsert({
      where: { key: "remember_me_days" },
      create: { key: "remember_me_days", value: String(gun), description: "test" },
      update: { value: String(gun) },
    });
  }

  it("işaretlenmediğinde oturum normal ömrünü alır", async () => {
    const user = await newUserWithPassword();
    await ayarla(30);

    const sonuc = await login(
      { db: testDb, now: NOW, rateLimitKey: "beni-hatirla-1", sleep: noWait },
      { email: user.email, password: PASSWORD },
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    // Varsayılan 12 saat; bir günü aşmamalı.
    const saat = (sonuc.session.expiresAt.getTime() - NOW.getTime()) / 3_600_000;
    expect(saat).toBeLessThanOrEqual(24);
  });

  it("işaretlendiğinde oturum ayardaki gün kadar sürer", async () => {
    const user = await newUserWithPassword();
    await ayarla(30);

    const sonuc = await login(
      { db: testDb, now: NOW, rateLimitKey: "beni-hatirla-2", sleep: noWait },
      { email: user.email, password: PASSWORD, remember: true },
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    const gun = (sonuc.session.expiresAt.getTime() - NOW.getTime()) / 86_400_000;
    expect(Math.round(gun)).toBe(30);
  });

  it("ayar 0 ise işaret yok sayılır", async () => {
    const user = await newUserWithPassword();
    await ayarla(0);

    // İstemciden gelen değere güvenilmez: kutu çizilmese de form
    // elle gönderilebilir.
    const sonuc = await login(
      { db: testDb, now: NOW, rateLimitKey: "beni-hatirla-3", sleep: noWait },
      { email: user.email, password: PASSWORD, remember: true },
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    const saat = (sonuc.session.expiresAt.getTime() - NOW.getTime()) / 3_600_000;
    expect(saat).toBeLessThanOrEqual(24);
  });

  it("uzun oturum parola değişiminde yine iptal olur", async () => {
    const user = await newUserWithPassword();
    await ayarla(30);

    const sonuc = await login(
      { db: testDb, now: NOW, rateLimitKey: "beni-hatirla-4", sleep: noWait },
      { email: user.email, password: PASSWORD, remember: true },
    );
    if (!sonuc.ok) throw new Error("giriş başarısız");

    // Parola değişince kimlik kuşağı ilerler ve eski oturum ölür.
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { version: { increment: 1 } },
    });

    const oturum = await findActiveSession(testDb, sonuc.session.token, NOW);
    expect(oturum).toBeNull();
  });
});
