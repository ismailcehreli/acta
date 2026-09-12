import type { PrismaClient } from "@prisma/client";

import { appSecret } from "@/server/auth/config";
import {
  findVisibleActivity,
  lockActivityForMaintenance,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";
import { READ_DWELL_MS } from "@/shared/reads";

import { verifyReadTicket } from "./ticket";

export { READ_DWELL_MS } from "@/shared/reads";

// Read receipts (§10).
export function countsAsRead(dwellMs: number, requiredMs = READ_DWELL_MS): boolean {
  return dwellMs >= requiredMs;
}

export type ReadsDb = Pick<
  PrismaClient,
  "readReceipt" | "$executeRaw" | "$transaction" | "systemSetting"
> & ActivityRepositoryDb;

export type MarkReadResult =
  | { ok: true; recorded: boolean }
  | { ok: false; reason: "not_visible" | "too_short" | "invalid_ticket" };


export async function recordReadFromTicket(
  db: ReadsDb,
  viewer: { id: string; isSystemAdmin: boolean },
  activityId: string,
  ticket: string,
  now: Date,
  secret: string = appSecret(),
): Promise<MarkReadResult> {
  const verified = verifyReadTicket(ticket, activityId, viewer.id, now, secret);
  if (!verified.ok) return { ok: false, reason: "invalid_ticket" };

  return markActivityAsRead(db, viewer, activityId, verified.dwellMs, now);
}

export async function markActivityAsRead(
  db: ReadsDb,
  viewer: { id: string; isSystemAdmin: boolean },
  activityId: string,
  dwellMs: number,
  now: Date,
): Promise<MarkReadResult> {
  const requiredSeconds = await readNumericSetting(db, SETTING_KEYS.readDwellSeconds);
  if (!countsAsRead(dwellMs, requiredSeconds * 1_000)) {
    return { ok: false, reason: "too_short" };
  }

  return db.$transaction(async (tx) => {



    await lockActivityForMaintenance(tx, activityId);

    const activity = await findVisibleActivity(tx, viewer, {
      where: { id: activityId },
      select: { id: true, authorId: true, approvalStatus: true },
    });


    if (!activity) return { ok: false, reason: "not_visible" };




    if (activity.authorId === viewer.id) return { ok: true, recorded: false };



    // Keep the first and latest read timestamps monotonic (audit phase 4).
    await tx.$executeRaw`
      INSERT INTO "ReadReceipt" ("activityId", "userId", "firstReadAt", "lastReadAt")
      VALUES (${activityId}, ${viewer.id}, ${now}, ${now})
      ON CONFLICT ("activityId", "userId") DO UPDATE
      SET "firstReadAt" = LEAST("ReadReceipt"."firstReadAt", EXCLUDED."firstReadAt"),
          "lastReadAt"  = GREATEST("ReadReceipt"."lastReadAt", EXCLUDED."lastReadAt")
    `;

    return { ok: true, recorded: true };
  });
}

export interface ReaderView {
  userId: string;
  fullName: string;
  firstReadAt: Date;
  lastReadAt: Date;
}

/**
 * Who can see read receipts (§10.3): **the author and the reader themselves.**
 * A manager cannot see what their team read; this is deliberate and is not a
 * surveillance tool. The v2 "board chair exception" was removed in v3 and is
 * not implemented here.
 */
export async function listActivityReaders(
  db: ReadsDb,
  viewer: { id: string; isSystemAdmin: boolean },
  activityId: string,
): Promise<ReaderView[]> {
  const activity = await findVisibleActivity(db, viewer, {
    where: { id: activityId },
    select: { id: true, authorId: true, approvalStatus: true },
  });

  if (!activity) return [];

  const isAuthor = activity.authorId === viewer.id;

  const rows = await db.readReceipt.findMany({
    // The author sees every reader; everyone else sees only their own receipt.
    where: isAuthor ? { activityId } : { activityId, userId: viewer.id },
    orderBy: { firstReadAt: "asc" },
    select: {
      userId: true,
      firstReadAt: true,
      lastReadAt: true,
      user: { select: { fullName: true } },
    },
  });

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.user.fullName,
    firstReadAt: row.firstReadAt,
    lastReadAt: row.lastReadAt,
  }));
}
