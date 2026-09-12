import { createHmac, timingSafeEqual } from "node:crypto";


//








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

  const encodedPayload = Buffer.from(JSON.stringify(parts)).toString("base64url");
  return `${encodedPayload}.${signature(payloadOf(parts), secret)}`;
}

export function verifyResetToken(
  token: string,
  now: Date,
  secret: string,
): ResetTokenVerification {
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) return { ok: false, reason: "invalid" };

  let parts: TokenParts;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(token.slice(0, separatorIndex), "base64url").toString(),
    );
    if (typeof decoded !== "object" || decoded === null) {
      return { ok: false, reason: "invalid" };
    }

    const { userId, version, expiresAtMs } = decoded as Record<string, unknown>;
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

  const expectedSignature = signature(payloadOf(parts), secret);
  const providedSignature = token.slice(separatorIndex + 1);

  // Compare in constant time; a length mismatch is also a signature mismatch.
  if (providedSignature.length !== expectedSignature.length) return { ok: false, reason: "invalid" };
  if (!timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
    return { ok: false, reason: "invalid" };
  }

  if (now.getTime() > parts.expiresAtMs) return { ok: false, reason: "expired" };

  return { ok: true, userId: parts.userId, credentialVersion: parts.version };
}
