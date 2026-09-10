import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { verifyPassword } from "@/server/auth/password";
import { requestPasswordReset, resetPassword } from "@/server/auth/reset";
import {
  issueResetToken,
  RESET_TOKEN_TTL_MS,
  verifyResetToken,
} from "@/server/auth/reset-token";
import { createSession } from "@/server/auth/session";
import { createUser } from "@/server/users/create";

import { createOrgUnit } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Parola sıfırlama (§15.3): tek kullanımlık ve süreli belirteç, başarıda tüm
// oturumlar iptal. Belirteç ayrı tabloda tutulmuyor; kimlik kuşağına bağlı —
// "tek kullanımlık" özelliği oradan geliyor.

const SECRET = "test-icin-en-az-otuz-iki-karakterlik-anahtar";
const NOW = new Date("2026-08-17T09:00:00.000Z");
const ESKI_PAROLA = "eski-parola-1234";
const YENI_PAROLA = "yeni-parola-5678";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kullanici(email = "kisi@ornek.test") {
  const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const sonuc = await createUser(testDb, {
    fullName: "Deneme Kişi",
    email,
    orgUnitId: unit.id,
    isUnitManager: false,
    isSystemAdmin: false,
    writesActivities: true,
    initialPassword: ESKI_PAROLA,
  });
  if (!sonuc.ok) throw new Error("kurulum");
  return sonuc.user;
}

async function belirtecAl(userId: string): Promise<string> {
  const kuyruk = await testDb.notificationQueue.findFirstOrThrow({
    where: { userId, eventType: "password_reset" },
  });
  const payload = kuyruk.payload as { token: string };
  return payload.token;
}

describe("belirteç doğrulaması", () => {
  const USER = "11111111-1111-4111-8111-111111111111";

  it("üretilen belirteç doğrulanır", () => {
    const token = issueResetToken(USER, 3, NOW, SECRET);

    expect(verifyResetToken(token, NOW, SECRET)).toEqual({
      ok: true,
      userId: USER,
      credentialVersion: 3,
    });
  });

  it("süresi dolan belirteç reddedilir", () => {
    const token = issueResetToken(USER, 0, NOW, SECRET);
    const sonra = new Date(NOW.getTime() + RESET_TOKEN_TTL_MS + 1);

    expect(verifyResetToken(token, sonra, SECRET)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("son geçerli anında hâlâ kabul edilir", () => {
    const token = issueResetToken(USER, 0, NOW, SECRET);
    const tamZamaninda = new Date(NOW.getTime() + RESET_TOKEN_TTL_MS);

    expect(verifyResetToken(token, tamZamaninda, SECRET).ok).toBe(true);
  });

  it("başka anahtarla imzalanmış belirteç kabul edilmez", () => {
    const token = issueResetToken(USER, 0, NOW, "baska-anahtar-en-az-otuz-iki-karakter");

    expect(verifyResetToken(token, NOW, SECRET)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("kurcalanmış belirteç kabul edilmez", () => {
    const token = issueResetToken(USER, 0, NOW, SECRET);
    const imza = token.slice(token.lastIndexOf(".") + 1);
    // Gövde başkasının kimliğiyle değiştirilir, imza aynı bırakılır.
    const sahteGovde = Buffer.from(
      JSON.stringify({
        userId: "22222222-2222-4222-8222-222222222222",
        version: 0,
        expiresAtMs: NOW.getTime() + RESET_TOKEN_TTL_MS,
      }),
    ).toString("base64url");

    expect(verifyResetToken(`${sahteGovde}.${imza}`, NOW, SECRET).ok).toBe(false);
  });

  it("bozuk biçimler reddedilir", () => {
    for (const bozuk of ["", "abc", "abc.def", ".", "e30.beklenmedik"]) {
      expect(verifyResetToken(bozuk, NOW, SECRET).ok).toBe(false);
    }
  });
});

describe("sıfırlama isteği", () => {
  it("kayıtlı kullanıcı için belirteç kuyruğa yazılır", async () => {
    const user = await kullanici();

    const sonuc = await requestPasswordReset(testDb, user.email, NOW, SECRET);

    expect(sonuc.issued).toBe(true);
    const kuyruk = await testDb.notificationQueue.findMany();
    expect(kuyruk).toHaveLength(1);
    expect(kuyruk[0].eventType).toBe("password_reset");
    expect(kuyruk[0].userId).toBe(user.id);
  });

  it("kayıtsız e-posta hiçbir iz bırakmaz", async () => {
    await kullanici();

    const sonuc = await requestPasswordReset(
      testDb,
      "kayitsiz@ornek.test",
      NOW,
      SECRET,
    );

    expect(sonuc.issued).toBe(false);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("pasifleştirilmiş kullanıcıya belirteç gitmez", async () => {
    const user = await kullanici();
    await testDb.user.update({ where: { id: user.id }, data: { isActive: false } });

    const sonuc = await requestPasswordReset(testDb, user.email, NOW, SECRET);

    expect(sonuc.issued).toBe(false);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("büyük harfli e-posta da bulunur", async () => {
    const user = await kullanici("kisi@ornek.test");

    const sonuc = await requestPasswordReset(
      testDb,
      "  KISI@ORNEK.TEST  ",
      NOW,
      SECRET,
    );

    expect(sonuc.issued).toBe(true);
    expect(user.email).toBe("kisi@ornek.test");
  });

  it("art arda istek posta yağmuruna dönmez", async () => {
    const user = await kullanici();

    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    await requestPasswordReset(testDb, user.email, NOW, SECRET);

    // Aynı kuşak için tek kayıt: idempotency anahtarı kuşağı taşıyor.
    expect(await testDb.notificationQueue.count()).toBe(1);
  });
});

describe("sıfırlamanın uygulanması", () => {
  it("parola değişir ve yeni parolayla doğrulanır", async () => {
    const user = await kullanici();
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await belirtecAl(user.id);

    const sonuc = await resetPassword(testDb, token, YENI_PAROLA, NOW, SECRET);

    expect(sonuc.ok).toBe(true);
    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(await verifyPassword(credential.passwordHash, YENI_PAROLA)).toBe(true);
    expect(await verifyPassword(credential.passwordHash, ESKI_PAROLA)).toBe(false);
  });

  it("başarıda tüm oturumlar iptal edilir (§15.3)", async () => {
    const user = await kullanici();
    await createSession(testDb, user.id, NOW);
    await createSession(testDb, user.id, NOW);
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await belirtecAl(user.id);

    const sonuc = await resetPassword(testDb, token, YENI_PAROLA, NOW, SECRET);

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.revokedSessionCount).toBe(2);
    expect(
      await testDb.session.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(0);
  });

  it("aynı belirteç ikinci kez kullanılamaz", async () => {
    const user = await kullanici();
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await belirtecAl(user.id);

    expect((await resetPassword(testDb, token, YENI_PAROLA, NOW, SECRET)).ok).toBe(
      true,
    );

    const ikinci = await resetPassword(
      testDb,
      token,
      "baska-parola-9999",
      NOW,
      SECRET,
    );

    expect(ikinci.ok).toBe(false);
    if (ikinci.ok) return;
    expect(ikinci.reason).toBe("used_token");

    // İkinci deneme parolayı değiştirmemiş olmalı.
    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(await verifyPassword(credential.passwordHash, YENI_PAROLA)).toBe(true);
  });

  it("süresi geçmiş belirteç parolayı değiştirmez", async () => {
    const user = await kullanici();
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await belirtecAl(user.id);

    const sonuc = await resetPassword(
      testDb,
      token,
      YENI_PAROLA,
      new Date(NOW.getTime() + RESET_TOKEN_TTL_MS + 1),
      SECRET,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.reason).toBe("expired_token");

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(await verifyPassword(credential.passwordHash, ESKI_PAROLA)).toBe(true);
  });

  it("araya başka bir parola değişimi girerse belirteç geçersizleşir", async () => {
    const user = await kullanici();
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await belirtecAl(user.id);

    // Kullanıcı parolasını başka bir yoldan değiştirdi: kuşak ilerledi.
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { version: { increment: 1 } },
    });

    const sonuc = await resetPassword(testDb, token, YENI_PAROLA, NOW, SECRET);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.reason).toBe("used_token");
  });

  it("sıfırlama hesap kilidini de açar", async () => {
    const user = await kullanici();
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: {
        failedLoginCount: 10,
        lockedUntil: new Date(NOW.getTime() + 900_000),
      },
    });
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await belirtecAl(user.id);

    await resetPassword(testDb, token, YENI_PAROLA, NOW, SECRET);

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.lockedUntil).toBeNull();
    expect(credential.failedLoginCount).toBe(0);
  });

  it("uydurma belirteçle parola değiştirilemez", async () => {
    const user = await kullanici();

    const sonuc = await resetPassword(
      testDb,
      "uydurma.belirtec",
      YENI_PAROLA,
      NOW,
      SECRET,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.reason).toBe("invalid_token");

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(await verifyPassword(credential.passwordHash, ESKI_PAROLA)).toBe(true);
  });
});
