import { createHmac, timingSafeEqual } from "node:crypto";

// Okuma bileti (§10.2). Süreyi kim ölçüyor sorusunun cevabıdır.
//
// Ölçüm bütünüyle istemcinin beyanına dayanıyordu: sunucu eylemi `dwellMs`
// parametresi alıyor, istemci detay ekranını hiç açmadan "iki saniye geçti"
// diyebiliyordu (denetim 18.08.2026, FAZ 4 bulgu 8). Bu veri yalnız
// gösterge değildir — başkasının okuması yazarın düzeltme hakkını kapatır.
//
// Bilet detay sayfası **sunucuda** üretilirken imzalanır ve zamanı sunucu
// koyar. Kayıt çağrısında süre yeniden sunucuda hesaplanır; istemciden gelen
// tek şey biletin kendisidir. Bilet üretilmiş olması, kişinin faaliyeti
// görebildiğinin de kanıtıdır: sayfa görünürlükten geçmeden render edilmez.

/** Bilet bu süreden eskiyse kabul edilmez; sekmede unutulan sayfa okuma üretmez. */
export const READ_TICKET_MAX_AGE_MS = 60 * 60_000;

export type TicketVerification =
  | { ok: true; dwellMs: number }
  | { ok: false; reason: "invalid" | "expired" };

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function payloadOf(activityId: string, userId: string, issuedAtMs: number): string {
  return `${activityId}:${userId}:${issuedAtMs}`;
}

export function issueReadTicket(
  activityId: string,
  userId: string,
  issuedAt: Date,
  secret: string,
): string {
  const issuedAtMs = issuedAt.getTime();
  return `${issuedAtMs}.${signature(payloadOf(activityId, userId, issuedAtMs), secret)}`;
}

/**
 * Bileti doğrular ve **sunucunun ölçtüğü** süreyi döndürür. Bilet başka bir
 * faaliyet ya da başka bir kullanıcı için üretilmişse imza tutmaz.
 */
export function verifyReadTicket(
  ticket: string,
  activityId: string,
  userId: string,
  now: Date,
  secret: string,
): TicketVerification {
  const separator = ticket.indexOf(".");
  if (separator <= 0) return { ok: false, reason: "invalid" };

  const issuedAtMs = Number(ticket.slice(0, separator));
  const provided = ticket.slice(separator + 1);
  if (!Number.isSafeInteger(issuedAtMs)) return { ok: false, reason: "invalid" };

  const expected = signature(payloadOf(activityId, userId, issuedAtMs), secret);
  // Karşılaştırma sabit zamanlıdır; uzunluk farkı da imza uyuşmazlığıdır.
  if (provided.length !== expected.length) return { ok: false, reason: "invalid" };
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return { ok: false, reason: "invalid" };
  }

  const dwellMs = now.getTime() - issuedAtMs;
  // Gelecekten gelen bilet: sunucu saati geriye alınmış ya da bilet uydurulmuş.
  if (dwellMs < 0) return { ok: false, reason: "invalid" };
  if (dwellMs > READ_TICKET_MAX_AGE_MS) return { ok: false, reason: "expired" };

  return { ok: true, dwellMs };
}
