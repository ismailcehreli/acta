import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import { acquireScoreClosureLock } from "./recalculation";

export type HistoricalCorrectionDb = Pick<
  PrismaClient,
  | "user"
  | "orgUnit"
  | "scoreUserStateEvent"
  | "scorePeriodLedger"
  | "scoreRecalculationRequest"
  | "auditLog"
  | "$transaction"
  | "$executeRaw"
>;

export interface UserScoreStateCorrection {
  userId: string;
  effectiveAt: Date;
  reason: string;
  state: {
    isActive: boolean;
    isScored: boolean;
    writesActivities: boolean;
    isUnitManager: boolean;
    orgUnitId: string;
  };
}

export type HistoricalCorrectionResult =
  | { ok: true; eventId: string; queuedPeriods: number }
  | {
      ok: false;
      error:
        | "not_allowed"
        | "not_found"
        | "invalid_org_unit"
        | "invalid_reason"
        | "future_effective_at";
      message: string;
    };

function periodStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}


export async function correctUserScoreHistory(
  db: HistoricalCorrectionDb,
  actorId: string,
  input: UserScoreStateCorrection,
  now: Date = new Date(),
): Promise<HistoricalCorrectionResult> {
  const reason = input.reason.trim();
  if (reason.length < 5) {
    return {
      ok: false,
      error: "invalid_reason",
      message: "The historical correction reason must contain at least 5 characters.",
    };
  }
  if (input.effectiveAt >= now) {
    return {
      ok: false,
      error: "future_effective_at",
      message: "A historical correction cannot take effect in the future.",
    };
  }

  return db.$transaction(async (tx) => {
    await acquireScoreClosureLock(tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('acta:score_history'))`;

    const actor = await tx.user.findFirst({
      where: { id: actorId, isActive: true, isSystemAdmin: true },
      select: { id: true },
    });
    if (!actor) {
      return {
        ok: false as const,
        error: "not_allowed" as const,
        message: "Only an active system administrator can perform this action.",
      };
    }

    const [target, unit] = await Promise.all([
      tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      }),
      tx.orgUnit.findUnique({
        where: { id: input.state.orgUnitId },
        select: { id: true },
      }),
    ]);
    if (!target) {
      return {
        ok: false as const,
        error: "not_found" as const,
        message: "The user whose history should be corrected was not found.",
      };
    }
    if (!unit) {
      return {
        ok: false as const,
        error: "invalid_org_unit" as const,
        message: "The organizational unit in the historical correction was not found.",
      };
    }

    const event = await tx.scoreUserStateEvent.create({
      data: {
        userId: input.userId,
        effectiveAt: input.effectiveAt,
        recordedAt: now,
        ...input.state,
        reason,
        actorId,
      },
    });

    const ledgers = await tx.scorePeriodLedger.findMany({
      where: { periodStart: { gte: periodStart(input.effectiveAt) } },
      select: { periodStart: true },
    });
    if (ledgers.length > 0) {
      await tx.scoreRecalculationRequest.createMany({
        data: ledgers.map((ledger) => ({
          userId: input.userId,
          periodStart: ledger.periodStart,
          sourceType: "USER_HISTORY_CORRECTION",
          sourceId: event.id,
          requestedAt: now,
        })),
        skipDuplicates: true,
      });
    }

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.user,
      objectId: input.userId,
      action: AUDIT_ACTIONS.scoreHistoryCorrected,
      detail: {
        effectiveAt: input.effectiveAt.toISOString(),
        queuedPeriods: ledgers.length,
        eventId: event.id,
      },
      now,
    });

    return {
      ok: true as const,
      eventId: event.id,
      queuedPeriods: ledgers.length,
    };
  });
}
