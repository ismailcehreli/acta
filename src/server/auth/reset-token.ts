import { createHmac, timingSafeEqual } from "node:crypto";

// Parola sıfırlama belirteci (§15.3): **tek kullanımlık ve süreli.**
//
// Belirteç ayrı bir tabloda tutulmuyor; kimlik kuşağına (`UserCredential.
// version`) bağlanıyor. Parola her değiştiğinde kuşak artıyor (Görev 1.1), bu
// yüzden kullanılmış bir belirteç ikinci kez doğrulanamıyor — "tek kullanımlık"
// özelliği kuşak sayacından geliyor, ayrı bir "kullanıldı" alanından değil.
// Kullanıcı parolasını başka bir yoldan değiştirdiyse de bekleyen belirteç
// kendiliğinden geçersizleşiyor.

/** Belirtecin ömrü: bir saat (§15.3 süre veriyor, sayı vermiyor). */
export const RESET_TOKEN_TTL_MS = 60 * 60_000;

export type ResetTokenVerification =
  | { ok: true; userId: string; credentialVersion: number }
  | { ok: false; reason: "invalid" | "expired" };

interface TokenParts {
  userId: string;
  version: number;
  expiresAtMs: number;
}

function payloadOf(parts: TokenParts): string {
  return `${parts.userId}:${parts.version}:${parts.expiresAtMs}`;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function issueResetToken(
  userId: string,
  credentialVersion: number,
  now: Date,
  secret: string,
  ttlMs: number = RESET_TOKEN_TTL_MS,
): string {
  const parts: TokenParts = {
    userId,
    version: credentialVersion,
    expiresAtMs: now.getTime() + ttlMs,
  };

  const govde = Buffer.from(JSON.stringify(parts)).toString("base64url");
  return `${govde}.${signature(payloadOf(parts), secret)}`;
}

export function verifyResetToken(
  token: string,
  now: Date,
  secret: string,
): ResetTokenVerification {
  const ayrac = token.lastIndexOf(".");
  if (ayrac <= 0) return { ok: false, reason: "invalid" };

  let parts: TokenParts;
  try {
    const cozulmus: unknown = JSON.parse(
      Buffer.from(token.slice(0, ayrac), "base64url").toString(),
    );
    if (typeof cozulmus !== "object" || cozulmus === null) {
      return { ok: false, reason: "invalid" };
    }

    const { userId, version, expiresAtMs } = cozulmus as Record<string, unknown>;
    if (
      typeof userId !== "string" ||
      typeof version !== "number" ||
      typeof expiresAtMs !== "number" ||
      !Number.isSafeInteger(version) ||
      !Number.isSafeInteger(expiresAtMs)
    ) {
      return { ok: false, reason: "invalid" };
    }

    parts = { userId, version, expiresAtMs };
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const beklenen = signature(payloadOf(parts), secret);
  const verilen = token.slice(ayrac + 1);

  // Sabit zamanlı karşılaştırma; uzunluk farkı da imza uyuşmazlığıdır.
  if (verilen.length !== beklenen.length) return { ok: false, reason: "invalid" };
  if (!timingSafeEqual(Buffer.from(verilen), Buffer.from(beklenen))) {
    return { ok: false, reason: "invalid" };
  }

  if (now.getTime() > parts.expiresAtMs) return { ok: false, reason: "expired" };

  return { ok: true, userId: parts.userId, credentialVersion: parts.version };
}
