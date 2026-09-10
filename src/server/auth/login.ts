import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";

import {
  isLockThresholdReached,
  isLocked,
  lockUntil,
  loginDelayMs,
} from "./lockout";
import { hashPassword, verifyPassword } from "./password";
import { clearFailures, peekFailures, recordFailure } from "./rate-limit";
import {
  createSessionIfCredentialUnchanged,
  type CreatedSession,
} from "./session";

// Giriş akışı (§15.3). Dışarıdan alınan her şey (veritabanı, saat, bekleme)
// parametredir; kural sahte saatle ve beklemeden test edilebilsin diye.

export type LoginFailureReason =
  /** Kullanıcı yok, parola yanlış veya kullanıcı pasif — üçü de aynı cevabı
   *  verir: hangi e-postanın kayıtlı olduğu dışarıdan anlaşılmamalı. */
  | "invalid_credentials"
  /** Hesap geçici olarak kilitli. Bu ayrım yalnızca sunucu tarafında anlamlı;
   *  kullanıcıya dönen metin `invalid_credentials` ile aynıdır, aksi hâlde
   *  kilit cevabı hesabın var olduğunu doğrulardı (denetim, bulgu 8). */
  | "locked"
  | "rate_limited";

export type LoginResult =
  | {
      ok: true;
      userId: string;
      session: CreatedSession;
      mustChangePassword: boolean;
    }
  | {
      ok: false;
      reason: LoginFailureReason;
      /** Kilit veya hız sınırı bitene kadar kalan süre. */
      retryAfterMs?: number;
    };

/** Giriş akışının dokunduğu tablolar; fazlasına erişim istenmez. */
export type LoginDb = Pick<
  PrismaClient,
  | "user"
  | "userCredential"
  | "session"
  | "systemSetting"
  | "auditLog"
  | "$queryRaw"
  | "$transaction"
>;

export interface LoginDependencies {
  db: LoginDb;
  now: Date;
  /** Hız sınırı anahtarı; genellikle istemci IP'si. */
  rateLimitKey: string;
  /** Artan gecikmeyi uygular. Testlerde beklemeden geçilir. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Hiçbir hesaba ait olmayan sabit bir özet; ilk ihtiyaçta bir kez üretilir.
let dummyHash: Promise<string> | null = null;

/**
 * Kullanıcı bulunamadığında da bir parola doğrulaması yapılır. Aksi hâlde
 * "kayıtlı e-posta" ile "kayıtsız e-posta" cevap süresinden ayırt edilebilirdi.
 */
async function burnTime(password: string): Promise<void> {
  dummyHash ??= hashPassword("gecersiz-parola-yer-tutucu");
  await verifyPassword(await dummyHash, password);
}

export async function login(
  deps: LoginDependencies,
  input: {
    email: string;
    password: string;
    /**
     * "Beni hatırla". Yalnız oturum ömrünü uzatır; kilitlenme, hız sınırı ve
     * parola değişiminde oturum iptali aynen işler.
     */
    remember?: boolean;
  },
): Promise<LoginResult> {
  const { db, now, rateLimitKey } = deps;
  const sleep = deps.sleep ?? defaultSleep;

  const clientKey = `istemci:${rateLimitKey}`;
  // İstemci adresi başlıktan geldiği için değiştirilebilir; denenen hesap
  // değiştirilemez. İki sayaç birlikte tutulur.
  const accountKey = `hesap:${input.email}`;
  const clock = now.getTime();

  const byClient = peekFailures(clientKey, clock);
  const byAccount = peekFailures(accountKey, clock);

  if (byClient.blocked || byAccount.blocked) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterMs: Math.max(byClient.retryAfterMs, byAccount.retryAfterMs),
    };
  }

  /** Başarısız denemeyi iki sayaca da işler. */
  const noteFailure = () => {
    recordFailure(clientKey, clock);
    recordFailure(accountKey, clock);
  };

  const user = await db.user.findUnique({
    where: { email: input.email },
    include: { credential: true },
  });

  if (!user || !user.credential || !user.isActive) {
    // Kayıtlı hesapla aynı gecikme profilini uygula: gecikmenin yokluğu da
    // "bu e-posta kayıtlı değil" bilgisidir.
    await sleep(loginDelayMs(byAccount.count));
    await burnTime(input.password);
    noteFailure();

    // §15.2 "oturum açma denemeleri": kayıtsız ya da pasif bir hesaba yapılan
    // deneme de iz bırakır. Kullanıcı bilinmediği için kayıt kullanıcısızdır;
    // denenen adres ayrıntıda durur.
    await recordAudit(db, {
      userId: user?.id ?? null,
      objectType: AUDIT_OBJECTS.session,
      objectId: input.email,
      action: AUDIT_ACTIONS.loginFailed,
      detail: { email: input.email, reason: user ? "inactive" : "unknown_email" },
      ipAddress: deps.rateLimitKey,
      now,
    });

    return { ok: false, reason: "invalid_credentials" };
  }

  const credential = user.credential;
  const { lockedUntil } = credential;

  if (isLocked(lockedUntil, now)) {
    // Kilitli hesap da diğer yollarla aynı gecikmeyi ve aynı parola doğrulama
    // maliyetini öder. Hemen dönmek, cevap süresinden "bu e-posta kayıtlı ve
    // aktif" bilgisini sızdırıyordu (denetim FAZ 2, bulgu 2).
    await sleep(loginDelayMs(byAccount.count));
    await burnTime(input.password);
    noteFailure();

    return {
      ok: false,
      reason: "locked",
      retryAfterMs: lockedUntil.getTime() - now.getTime(),
    };
  }

  // Kilit süresi dolmuşsa sayaç sıfırdan başlar; temizlik tek ifadede yapılır
  // ki iki eşzamanlı istek arasında yarım kalmış bir durum oluşmasın.
  let previousFailures = credential.failedLoginCount;
  if (credential.lockedUntil !== null) {
    await db.userCredential.updateMany({
      where: { userId: user.id, lockedUntil: { lte: now } },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    previousFailures = 0;
  }

  await sleep(loginDelayMs(previousFailures));

  const passwordMatches = await verifyPassword(
    credential.passwordHash,
    input.password,
  );

  if (!passwordMatches) {
    // Sayaç veritabanında atomik olarak artırılır. Okuyup geri yazmak, aynı
    // anda gelen denemelerde kayıp güncellemeye ve kilidin hiç devreye
    // girmemesine yol açıyordu (denetim, bulgu 6).
    const { failedLoginCount } = await db.userCredential.update({
      where: { userId: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });

    noteFailure();

    if (isLockThresholdReached(failedLoginCount)) {
      const kilitDakikasi = await readNumericSetting(
        db,
        SETTING_KEYS.lockoutMinutes,
      );
      const lockedTo = lockUntil(now, kilitDakikasi);

      await db.userCredential.update({
        where: { userId: user.id },
        data: { lockedUntil: lockedTo },
      });

      await recordAudit(db, {
        userId: user.id,
        objectType: AUDIT_OBJECTS.session,
        objectId: user.id,
        action: AUDIT_ACTIONS.loginLocked,
        detail: { failedLoginCount, lockedUntil: lockedTo.toISOString() },
        ipAddress: deps.rateLimitKey,
        now,
      });

      return {
        ok: false,
        reason: "locked",
        retryAfterMs: lockedTo.getTime() - now.getTime(),
      };
    }

    await recordAudit(db, {
      userId: user.id,
      objectType: AUDIT_OBJECTS.session,
      objectId: user.id,
      action: AUDIT_ACTIONS.loginFailed,
      detail: { reason: "wrong_password", failedLoginCount },
      ipAddress: deps.rateLimitKey,
      now,
    });

    return { ok: false, reason: "invalid_credentials" };
  }

  await db.userCredential.update({
    where: { userId: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });

  // Başarılı giriş sayaçları temizler: meşru kullanıcı, sık giriş yaptığı için
  // kendini veya aynı adresi paylaşan mesai arkadaşlarını kilitlememeli.
  clearFailures(clientKey);
  clearFailures(accountKey);

  // Oturum yalnızca doğrulanan kimlik kuşağı hâlâ geçerliyse açılır: parola
  // doğrulaması ile oturum yazımı arasında parola değişmiş olabilir.
  // "Beni hatırla" işaretliyse oturum ömrü ayardaki gün sayısına çıkar.
  // Ayar 0 ise özellik kapalıdır ve işaret yok sayılır — giriş ekranı da
  // kutuyu hiç göstermez, ama istemciden gelen bir değere güvenilmez.
  const hatirlaGun = await readNumericSetting(db, SETTING_KEYS.rememberMeDays);
  const oturumSaati =
    input.remember && hatirlaGun > 0 ? hatirlaGun * 24 : undefined;

  const session = await createSessionIfCredentialUnchanged(
    db,
    user.id,
    credential.version,
    now,
    oturumSaati,
  );

  if (!session) {
    // Parola tam bu sırada değişti; doğrulanan parola artık geçerli değil.
    return { ok: false, reason: "invalid_credentials" };
  }

  // Son giriş zamanı yalnız parola doğrulaması ve oturum oluşturma birlikte
  // başarılı olduktan sonra güncellenir. Başarısız denemeler ve yarışta
  // geçersizleşen parolalar bu bilgiyi değiştiremez.
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: now },
  });

  await recordAudit(db, {
    userId: user.id,
    objectType: AUDIT_OBJECTS.session,
    objectId: session.sessionId,
    action: AUDIT_ACTIONS.loginSucceeded,
    ipAddress: deps.rateLimitKey,
    now,
  });

  return {
    ok: true,
    userId: user.id,
    session,
    mustChangePassword: credential.mustChangePassword,
  };
}
