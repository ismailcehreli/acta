import type { BackupRequestSource, BackupRequestStatus, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { isUniqueViolation } from "@/server/db-errors";

export type BackupRequestDb = Pick<
  PrismaClient,
  "backupRequest" | "$transaction" | "auditLog"
>;

export type BackupRequestResult =
  | { ok: true; id: string }
  | { ok: false; error: "already_waiting"; message: string };

export interface BackupRequestView {
  id: string;
  source: BackupRequestSource;
  status: BackupRequestStatus;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  fileName: string | null;
  sizeBytes: string | null;
  message: string | null;
}


export async function requestBackup(
  db: BackupRequestDb,
  actorId: string,
  now = new Date(),
): Promise<BackupRequestResult> {
  try {
    const request = await db.$transaction(async (tx) => {
      const created = await tx.backupRequest.create({
        data: {
          source: "MANUAL",
          requestedById: actorId,
          status: "PENDING",
          requestedAt: now,
        },
        select: { id: true },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.backupRequest,
        objectId: created.id,
        action: AUDIT_ACTIONS.backupRequested,
        detail: { source: "MANUAL" },
        now,
      });

      return created;
    });

    return { ok: true, id: request.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        error: "already_waiting",
        message: "A backup is already waiting or running. Wait for it to finish.",
      };
    }
    throw error;
  }
}


export async function listBackupRequests(
  db: Pick<PrismaClient, "backupRequest">,
  limit = 10,
): Promise<BackupRequestView[]> {
  const rows = await db.backupRequest.findMany({
    orderBy: { requestedAt: "desc" },
    take: Math.max(1, Math.min(50, Math.trunc(limit))),
    select: {
      id: true,
      source: true,
      status: true,
      requestedAt: true,
      startedAt: true,
      finishedAt: true,
      fileName: true,
      sizeBytes: true,
      message: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes?.toString() ?? null,
    message: row.message,
  }));
}
