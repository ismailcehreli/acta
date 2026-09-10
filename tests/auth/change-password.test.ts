import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { changePassword } from "@/server/auth/change-password";
import { login } from "@/server/auth/login";
import { resetRateLimits } from "@/server/auth/rate-limit";
import {
  createSession,
  createSessionIfCredentialUnchanged,
  findActiveSession,
} from "@/server/auth/session";

import { createOrgUnit, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-17T09:00:00.000Z");
const OLD_PASSWORD = "eski-parola-123";
const NEW_PASSWORD = "yeni-parola-456";

const noWait = async () => {};

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function newUser() {
  const unit = await createOrgUnit();
  return createUserWithPassword(unit.id, OLD_PASSWORD, {
    email: "mudur@ornek.test",
  });
}

describe("parola değişimi", () => {
  it("mevcut parola yanlışsa değişim yapılmaz", async () => {
    const user = await newUser();

    const result = await changePassword(
      { db: testDb, now: NOW },
      {
        userId: user.id,
        currentPassword: "yanlis-parola",
        newPassword: NEW_PASSWORD,
      },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_current_password" });

    // Eski parola çalışmaya devam eder.
    const attempt = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: noWait },
      { email: "mudur@ornek.test", password: OLD_PASSWORD },
    );
    expect(attempt.ok).toBe(true);
  });

  it("değişimden sonra yeni parola geçerli, eski parola geçersizdir", async () => {
    const user = await newUser();

    await changePassword(
      { db: testDb, now: NOW },
      {
        userId: user.id,
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
      },
    );

    const withNew = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: noWait },
      { email: "mudur@ornek.test", password: NEW_PASSWORD },
    );
    const withOld = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.2", sleep: noWait },
      { email: "mudur@ornek.test", password: OLD_PASSWORD },
    );

    expect(withNew.ok).toBe(true);
    expect(withOld.ok).toBe(false);
  });

  it("parola değişiminde açık oturumların tamamı düşer (§15.3)", async () => {
    const user = await newUser();
    const first = await createSession(testDb, user.id, NOW);
    const second = await createSession(testDb, user.id, NOW);

    const result = await changePassword(
      { db: testDb, now: NOW },
      {
        userId: user.id,
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
      },
    );

    expect(result).toEqual({ ok: true, revokedSessionCount: 2 });
    expect(await findActiveSession(testDb, first.token, NOW)).toBeNull();
    expect(await findActiveSession(testDb, second.token, NOW)).toBeNull();
  });

  it("parola değişimi kilidi ve hata sayacını temizler", async () => {
    const user = await newUser();
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { failedLoginCount: 7, lockedUntil: new Date("2026-08-17T10:00:00.000Z") },
    });

    await changePassword(
      { db: testDb, now: NOW },
      {
        userId: user.id,
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
      },
    );

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.failedLoginCount).toBe(0);
    expect(credential.lockedUntil).toBeNull();
    expect(credential.passwordChangedAt).toEqual(NOW);
  });
});

// Denetim FAZ 2, bulgu 1: kuşak kontrolü duvar saatine dayanıyordu ve
// yalnızca bir yönü kapatıyordu. Parola değişimi önce başlayıp özet
// hesaplanırken giriş araya girdiğinde, girişin zaman damgası daha büyük olduğu
// için oturum geçerli sayılabiliyordu. Artık kuşak monoton bir sayaç.
describe("parola değişimiyle yarışan giriş", () => {
  it("giriş sırasında parola değişirse oturum açılmaz", async () => {
    const user = await newUser();
    const loginTime = new Date("2026-08-17T09:00:00.000Z");
    const changeTime = new Date("2026-08-17T09:00:00.500Z");

    // Giriş, kimlik bilgisini okuduktan sonra bekler; tam o sırada parola
    // değişir ve kuşak ilerler.
    const result = await login(
      {
        db: testDb,
        now: loginTime,
        rateLimitKey: "10.0.0.1",
        sleep: async () => {
          await changePassword(
            { db: testDb, now: changeTime },
            {
              userId: user.id,
              currentPassword: OLD_PASSWORD,
              newPassword: NEW_PASSWORD,
            },
          );
        },
      },
      { email: "mudur@ornek.test", password: OLD_PASSWORD },
    );

    // Eski parola doğrulanmış olsa bile oturum yazılmaz.
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("kuşak ilerlemişse oturum yazımı reddedilir", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");

    // Giriş kuşak 0'ı okudu; yazmadan önce parola değişti.
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { version: { increment: 1 } },
    });

    const session = await createSessionIfCredentialUnchanged(
      testDb,
      user.id,
      0,
      now,
    );

    expect(session).toBeNull();
    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("kuşak aynıysa oturum yazılır", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");

    const session = await createSessionIfCredentialUnchanged(
      testDb,
      user.id,
      0,
      now,
    );

    expect(session).not.toBeNull();
    if (!session) return;
    expect(await findActiveSession(testDb, session.token, now)).not.toBeNull();
  });

  it("eski kuşakta doğmuş oturum sonradan da kullanılamaz", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");
    const session = await createSession(testDb, user.id, now, 0);

    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { version: { increment: 1 } },
    });

    expect(await findActiveSession(testDb, session.token, now)).toBeNull();
  });

  it("parola değişimi ile giriş gerçekten çakışsa da güvenli sonuç verir", async () => {
    const user = await newUser();
    const changeTime = new Date("2026-08-17T09:00:00.000Z");
    const loginTime = new Date("2026-08-17T09:00:00.200Z");

    // İki işlem aynı anda: parola değişimi (özet hesaplaması sürerken) ve eski
    // parolayla giriş. Hangi sıra gerçekleşirse gerçekleşsin sonuç güvenli
    // olmalı — giriş ya reddedilir ya da açtığı oturum kullanılamaz.
    const [, loginResult] = await Promise.all([
      changePassword(
        { db: testDb, now: changeTime },
        {
          userId: user.id,
          currentPassword: OLD_PASSWORD,
          newPassword: NEW_PASSWORD,
        },
      ),
      login(
        { db: testDb, now: loginTime, rateLimitKey: "10.0.0.5", sleep: noWait },
        { email: "mudur@ornek.test", password: OLD_PASSWORD },
      ),
    ]);

    if (loginResult.ok) {
      expect(
        await findActiveSession(testDb, loginResult.session.token, loginTime),
      ).toBeNull();
    } else {
      expect(loginResult.reason).toBe("invalid_credentials");
    }

    // Her durumda: eski parola artık hiçbir yeni oturum açamaz.
    const sonraki = await login(
      { db: testDb, now: loginTime, rateLimitKey: "10.0.0.6", sleep: noWait },
      { email: "mudur@ornek.test", password: OLD_PASSWORD },
    );
    expect(sonraki.ok).toBe(false);
  });
});

// Denetim (18.08.2026, bulgu 7): önceki tur yalnızca giriş ile parola
// değişimi arasındaki yarışı kapatmıştı. İki **parola değişimi** aynı eski
// özeti işlem dışında doğrulayıp sırayla yazabiliyordu; eski parolayı bilen
// biri, gerçek kullanıcının yeni parolasını böyle ezebilirdi.
describe("iki eşzamanlı parola değişimi", () => {
  it("yalnızca biri yazar, diğeri çakışma döner", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");

    const [birinci, ikinci] = await Promise.all([
      changePassword(
        { db: testDb, now },
        {
          userId: user.id,
          currentPassword: OLD_PASSWORD,
          newPassword: "gercek-kullanicinin-parolasi",
        },
      ),
      changePassword(
        { db: testDb, now },
        {
          userId: user.id,
          currentPassword: OLD_PASSWORD,
          newPassword: "saldirganin-parolasi",
        },
      ),
    ]);

    const basarili = [birinci, ikinci].filter((r) => r.ok);
    const basarisiz = [birinci, ikinci].filter((r) => !r.ok);

    expect(basarili).toHaveLength(1);
    expect(basarisiz).toHaveLength(1);
    expect(basarisiz[0]).toEqual({ ok: false, reason: "conflict" });
  });

  it("kaybeden isteğin parolası hiç geçerli olmaz", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");
    const sonra = new Date("2026-08-17T09:05:00.000Z");

    await Promise.all([
      changePassword(
        { db: testDb, now },
        { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: "parola-bir-1234" },
      ),
      changePassword(
        { db: testDb, now },
        { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: "parola-iki-1234" },
      ),
    ]);

    const denemeler = await Promise.all(
      ["parola-bir-1234", "parola-iki-1234"].map((parola, index) =>
        login(
          {
            db: testDb,
            now: sonra,
            rateLimitKey: `10.0.0.${20 + index}`,
            sleep: noWait,
          },
          { email: "mudur@ornek.test", password: parola },
        ),
      ),
    );

    // Tam olarak biri çalışmalı: iki parola birden geçerli olsaydı, kaybeden
    // isteğin sahibi de hesaba girebilirdi.
    expect(denemeler.filter((r) => r.ok)).toHaveLength(1);
  });

  it("eski parola her iki durumda da geçersizleşir", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");

    await Promise.all([
      changePassword(
        { db: testDb, now },
        { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: "parola-bir-1234" },
      ),
      changePassword(
        { db: testDb, now },
        { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: "parola-iki-1234" },
      ),
    ]);

    const eski = await login(
      { db: testDb, now, rateLimitKey: "10.0.0.30", sleep: noWait },
      { email: "mudur@ornek.test", password: OLD_PASSWORD },
    );

    expect(eski.ok).toBe(false);
  });
});
