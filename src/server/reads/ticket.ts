import { createHmac, timingSafeEqual } from "node:crypto";


//




//






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
 * Verify the ticket and return the **server-measured** dwell time. A ticket
 * issued for another activity or user has an invalid signature.
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
  // Compare in constant time; a length mismatch is also a signature mismatch.
  if (provided.length !== expected.length) return { ok: false, reason: "invalid" };
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return { ok: false, reason: "invalid" };
  }

  const dwellMs = now.getTime() - issuedAtMs;
  // A future ticket means the server clock moved backwards or the ticket was forged.
  if (dwellMs < 0) return { ok: false, reason: "invalid" };
  if (dwellMs > READ_TICKET_MAX_AGE_MS) return { ok: false, reason: "expired" };

  return { ok: true, dwellMs };
}
