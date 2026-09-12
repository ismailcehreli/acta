import type { Prisma, PrismaClient } from "@prisma/client";

import { deleteStoredFile } from "@/server/attachments/storage";
import {
  activityMaintenanceReader,
  attachmentMaintenanceReader,
  lockActivitiesForMaintenance,
} from "@/server/authz/activity-repository";
import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import {
  DEMO_EMAIL_DOMAIN,
  DEMO_OBJECT_ORG_UNIT,
  DEMO_ORIGIN_CREATED,
  listLegacyDemoOriginCandidates,
  type LegacyDemoOriginCandidate,
} from "./origin";

// Demo data purging.
//
// This is a deliberate and narrow exception to the "no physical delete" principle.
// Demo data is not a business record but test/sample material; deactivating it does
// not clean the system, it merely hides the sample data.
//
// Invariants:
//   - Look before deleting: if real user data is attached to the delete set,
//     purge halts immediately and reports what is blocking it.
//   - Audit log is immutable: only records where both actor and target are demo objects are deleted.
//   - Purge itself leaves an audit log.

export interface PurgeSummary {
  users: number;
  activities: number;
  conversations: number;
  followUps: number;
  notifications: number;
  orgUnits: number;
  /** Number of attachment files deleted from storage. */
  files: number;
  helpArticles: number;
}

export type PurgeResult =
  | { ok: true; summary: PurgeSummary }
  | { ok: false; error: "nothing_to_purge" }
  | {
      ok: false;
      error: "legacy_demo_origin_unknown";
      candidates: LegacyDemoOriginCandidate[];
    }
  | { ok: false; error: "blocked"; detail: string };

export type PurgeDb = PrismaClient;

/** Checks whether demo data is present. */
export async function demoDataPresent(db: PurgeDb): Promise<boolean> {
  const count = await db.user.count({
    where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
  });
  return count > 0;
}

/**
 * Checks whether any real user data is connected before deletion.
 *
 * Each item is checked individually to provide clear feedback on what blocked deletion.
 */
async function collectBlockers(
  db: PurgeDb,
  userIds: string[],
  activityIds: string[],
  demoObjectIds: string[],
): Promise<string[]> {
  const nonDemo = { notIn: userIds };
  const blockers: string[] = [];

  const [
    messages,
    conversations,
    followUps,
    followUpEvents,
    attachments,
    revisions,
    cancellations,
    approvalRounds,
    periods,
    scoreFacts,
    appreciations,
    auditLogs,
  ] = await Promise.all([
    db.conversationMessage.count({
      where: {
        conversation: { activityId: { in: activityIds } },
        authorId: nonDemo,
      },
    }),
    db.conversation.count({
      where: {
        activityId: { in: activityIds },
        OR: [{ askerId: nonDemo }, { responsibleId: nonDemo }, { closedById: nonDemo }],
      },
    }),
    db.followUpItem.count({
      where: {
        activityId: { in: activityIds },
        OR: [{ openedById: nonDemo }, { ownerId: nonDemo }, { closedById: nonDemo }],
      },
    }),
    db.followUpItemEvent.count({
      where: { followUp: { activityId: { in: activityIds } }, actorId: nonDemo },
    }),
    attachmentMaintenanceReader(db).count({
      where: { activityId: { in: activityIds }, uploadedById: nonDemo },
    }),
    db.activityRevision.count({
      where: { activityId: { in: activityIds }, changedById: nonDemo },
    }),
    db.cancellationRecord.count({
      where: { activityId: { in: activityIds }, cancelledById: nonDemo },
    }),
    // A real manager may have decided on a demo record; decision history cannot be deleted
    db.approvalRound.count({
      where: { activityId: { in: activityIds }, decidedById: nonDemo },
    }),
    // A demo user may have marked leave or acted as deputy for a real user
    db.noActivityPeriod.count({
      where: {
        userId: nonDemo,
        OR: [{ markedById: { in: userIds } }, { deputyId: { in: userIds } }],
      },
    }),
    // Score contribution: a demo activity may have written contribution to a closed period of a real user
    db.userScorePeriodFact.count({
      where: { activityId: { in: activityIds }, userId: nonDemo },
    }),
    // Appreciation from a real user on demo activity, or demo user appreciation on real activity
    db.activityAppreciation.count({
      where: {
        OR: [
          { activityId: { in: activityIds }, userId: nonDemo },
          { activityId: { notIn: activityIds }, userId: { in: userIds } },
        ],
      },
    }),
    // Audit log: actor is demo but object is not in demo objects list
    db.auditLog.count({
      where: {
        OR: [{ userId: { in: userIds } }, { actualUserId: { in: userIds } }],
        NOT: { objectId: { in: demoObjectIds } },
      },
    }),
  ]);

  if (messages > 0) blockers.push(`${messages} conversation message(s) belong to a real user`);
  if (conversations > 0) blockers.push(`${conversations} conversation(s) involve a real user`);
  if (followUps > 0) blockers.push(`${followUps} follow-up item(s) are linked to a real user`);
  if (followUpEvents > 0) blockers.push(`${followUpEvents} follow-up event(s) were performed by a real user`);
  if (attachments > 0) blockers.push(`${attachments} attachment(s) were uploaded by a real user`);
  if (revisions > 0) blockers.push(`${revisions} revision(s) were made by a real user`);
  if (cancellations > 0) blockers.push(`${cancellations} cancellation(s) were made by a real user`);
  if (approvalRounds > 0) {
    blockers.push(`${approvalRounds} approval decision(s) were made by a real user`);
  }
  if (periods > 0) blockers.push(`${periods} leave record(s) belong to a real user`);
  if (scoreFacts > 0) {
    blockers.push(
      `${scoreFacts} score contribution(s) belong to a closed period of a real user`,
    );
  }
  if (appreciations > 0) {
    blockers.push(`${appreciations} appreciation record(s) belong to a real user`);
  }
  if (auditLogs > 0) {
    blockers.push(
      `${auditLogs} audit record(s) point to a real object (audit log is immutable)`,
    );
  }

  return blockers;
}

class PurgeBlocked extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

class LegacyDemoOriginUnknown extends Error {
  constructor(readonly candidates: LegacyDemoOriginCandidate[]) {
    super("Origins of legacy demo org units have not been classified");
  }
}

export async function purgeDemoData(
  db: PurgeDb,
  actorId: string,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const demoUsers = await db.user.findMany({
    where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    select: { id: true },
  });

  if (demoUsers.length === 0) {
    return { ok: false, error: "nothing_to_purge" };
  }

  const userIds = demoUsers.map((u) => u.id);

  const demoActivities = await activityMaintenanceReader(db).findMany({
    where: { authorId: { in: userIds } },
    select: { id: true },
  });
  const activityIds = demoActivities.map((a) => a.id);

  // Storage paths are read before the transaction; disk deletion occurs after commit
  const files = await attachmentMaintenanceReader(db).findMany({
    where: { activityId: { in: activityIds } },
    select: { storagePath: true },
  });

  try {
    const summary = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('acta:demo_data'))`;

      // Session variable allowing physical deletion during this transaction only
      await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'yes'");

      const unclassifiedUnits = await listLegacyDemoOriginCandidates(
        tx as unknown as PurgeDb,
      );
      if (unclassifiedUnits.length > 0) {
        throw new LegacyDemoOriginUnknown(unclassifiedUnits);
      }

      // Lock activities and sub-objects
      await lockActivitiesForMaintenance(tx, activityIds);

      const freshConversations = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Conversation"
        WHERE "activityId" = ANY(${activityIds}::text[])
        ORDER BY "id"
        FOR UPDATE
      `;
      const freshFollowUps = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "FollowUpItem"
        WHERE "activityId" = ANY(${activityIds}::text[])
        ORDER BY "id"
        FOR UPDATE
      `;

      const demoUnitRecords = await tx.demoObject.findMany({
        where: { objectType: DEMO_OBJECT_ORG_UNIT },
        select: { objectId: true, origin: true },
      });
      const demoUnitIds = demoUnitRecords
        .filter((row) => row.origin === DEMO_ORIGIN_CREATED)
        .map((row) => row.objectId);

      const demoHelpArticles = await tx.helpArticle.findMany({
        where: { createdById: { in: userIds } },
        select: { id: true },
      });
      const demoHelpArticleIds = demoHelpArticles.map((article) => article.id);
      if (demoHelpArticleIds.length > 0) {
        const realUserEdits = await tx.helpArticle.count({
          where: {
            id: { in: demoHelpArticleIds },
            updatedById: { notIn: userIds },
          },
        });
        if (realUserEdits > 0) {
          throw new PurgeBlocked(
            `${realUserEdits} help article(s) were edited by a real administrator`,
          );
        }
      }

      const demoObjectIds = [
        ...userIds,
        ...activityIds,
        ...freshConversations.map((c) => c.id),
        ...freshFollowUps.map((f) => f.id),
        ...demoUnitIds,
        ...demoHelpArticleIds,
      ];

      const blockers = await collectBlockers(
        tx as unknown as PurgeDb,
        userIds,
        activityIds,
        demoObjectIds,
      );
      if (blockers.length > 0) {
        throw new PurgeBlocked(blockers.join("; "));
      }

      const demoUserFilter = { in: userIds };
      const followUps = await tx.followUpItem.findMany({
        where: {
          activityId: { in: activityIds },
          openedById: demoUserFilter,
          ownerId: demoUserFilter,
          OR: [{ closedById: null }, { closedById: demoUserFilter }],
        },
        select: { id: true },
      });
      const followUpIds = followUps.map((f) => f.id);

      await tx.followUpItemEvent.deleteMany({
        where: { followUpId: { in: followUpIds }, actorId: demoUserFilter },
      });
      const deletedFollowUps = await tx.followUpItem.deleteMany({
        where: { id: { in: followUpIds } },
      });

      const conversations = await tx.conversation.findMany({
        where: {
          activityId: { in: activityIds },
          askerId: demoUserFilter,
          responsibleId: demoUserFilter,
          OR: [{ closedById: null }, { closedById: demoUserFilter }],
        },
        select: { id: true },
      });
      await tx.conversationMessage.deleteMany({
        where: { conversationId: { in: conversations.map((c) => c.id) } },
      });
      const deletedConversations = await tx.conversation.deleteMany({
        where: { id: { in: conversations.map((c) => c.id) } },
      });

      await tx.readReceipt.deleteMany({ where: { activityId: { in: activityIds } } });
      await tx.attachment.deleteMany({ where: { activityId: { in: activityIds } } });
      await tx.activityTargetDept.deleteMany({
        where: { activityId: { in: activityIds } },
      });
      await tx.cancellationRecord.deleteMany({
        where: { activityId: { in: activityIds } },
      });
      await tx.activityRevision.deleteMany({
        where: { activityId: { in: activityIds } },
      });
      await tx.activityApprover.deleteMany({
        where: { activityId: { in: activityIds } },
      });
      await tx.activityAppreciation.deleteMany({
        where: {
          OR: [
            { activityId: { in: activityIds } },
            { userId: { in: userIds } },
          ],
        },
      });
      await tx.approvalRound.deleteMany({
        where: {
          activityId: { in: activityIds },
          OR: [{ decidedById: null }, { decidedById: demoUserFilter }],
        },
      });

      await tx.userScorePeriodFact.deleteMany({
        where: { userId: { in: userIds } },
      });

      const deletedNotifications = await tx.notificationQueue.deleteMany({
        where: {
          OR: [{ userId: { in: userIds } }, { activityId: { in: activityIds } }],
        },
      });

      const deletedActivities = await tx.activity.deleteMany({
        where: { id: { in: activityIds } },
      });

      const deletedHelpArticles = await tx.helpArticle.deleteMany({
        where: { id: { in: demoHelpArticleIds } },
      });

      await tx.noActivityPeriod.deleteMany({
        where: { userId: { in: userIds } },
      });

      await tx.userScorePeriod.deleteMany({
        where: { userId: { in: userIds } },
      });
      await tx.scoreRecalculationRequest.deleteMany({
        where: { userId: { in: userIds } },
      });
      await tx.scoreUserStateEvent.deleteMany({
        where: { userId: { in: userIds } },
      });
      await tx.pushSubscription.deleteMany({ where: { userId: { in: userIds } } });

      await tx.auditLog.deleteMany({
        where: {
          OR: [{ userId: { in: userIds } }, { actualUserId: { in: userIds } }],
          objectId: { in: demoObjectIds },
        },
      });

      await tx.session.deleteMany({ where: { userId: { in: userIds } } });
      await tx.userCredential.deleteMany({ where: { userId: { in: userIds } } });

      const deletedUsers = await tx.user.deleteMany({
        where: { id: { in: userIds } },
      });

      await tx.scoreUnitCalendarEvent.deleteMany({
        where: { orgUnitId: { in: demoUnitIds } },
      });
      await tx.scoreOrgUnitStateEvent.deleteMany({
        where: { orgUnitId: { in: demoUnitIds } },
      });
      const deletedUnitIds = await purgeOrgUnits(tx, demoUnitIds);
      const deletedUnitsCount = deletedUnitIds.length;

      await tx.demoObject.deleteMany({
        where: {
          objectType: DEMO_OBJECT_ORG_UNIT,
          objectId: { in: demoUnitRecords.map((r) => r.objectId) },
        },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.setting,
        objectId: "demo_data",
        action: AUDIT_ACTIONS.demoDataPurged,
        detail: {
          users: deletedUsers.count,
          activities: deletedActivities.count,
          conversations: deletedConversations.count,
          followUps: deletedFollowUps.count,
          notifications: deletedNotifications.count,
          orgUnits: deletedUnitsCount,
          files: files.length,
          helpArticles: deletedHelpArticles.count,
        },
        now,
      });

      return {
        users: deletedUsers.count,
        activities: deletedActivities.count,
        conversations: deletedConversations.count,
        followUps: deletedFollowUps.count,
        notifications: deletedNotifications.count,
        orgUnits: deletedUnitsCount,
        files: files.length,
        helpArticles: deletedHelpArticles.count,
      } satisfies PurgeSummary;
    });

    for (const file of files) {
      try {
        await deleteStoredFile(file.storagePath);
      } catch (error) {
        console.error("[demo-data] file delete failed", file.storagePath, error);
      }
    }

    return { ok: true, summary };
  } catch (error) {
    if (error instanceof LegacyDemoOriginUnknown) {
      return {
        ok: false,
        error: "legacy_demo_origin_unknown",
        candidates: error.candidates,
      };
    }

    return {
      ok: false,
      error: "blocked",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Deletes demo org units from leaves towards the root, only if empty and childless.
 * Root unit is never deleted.
 */
async function purgeOrgUnits(
  tx: Prisma.TransactionClient,
  demoUnitIds: string[],
): Promise<string[]> {
  const deleted: string[] = [];
  const remaining = new Set(demoUnitIds);

  while (remaining.size > 0) {
    let progress = 0;

    for (const unitId of [...remaining]) {
      const unit = await tx.orgUnit.findUnique({
        where: { id: unitId },
        select: { id: true, parentId: true },
      });
      if (!unit) {
        remaining.delete(unitId);
        continue;
      }
      if (unit.parentId === null) continue;

      const [userCount, childCount, activityCount] = await Promise.all([
        tx.user.count({ where: { orgUnitId: unit.id } }),
        tx.orgUnit.count({ where: { parentId: unit.id } }),
        activityMaintenanceReader(tx).count({ where: { authorOrgUnitId: unit.id } }),
      ]);
      if (userCount > 0 || childCount > 0 || activityCount > 0) continue;

      await tx.orgUnit.delete({ where: { id: unit.id } });
      remaining.delete(unit.id);
      deleted.push(unit.id);
      progress += 1;
    }

    if (progress === 0) break;
  }

  if (remaining.size > 0) {
    const names = await tx.orgUnit.findMany({
      where: { id: { in: [...remaining] } },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    throw new PurgeBlocked(
      `${remaining.size} demo org unit(s) could not be safely deleted: ${names
        .map((unit) => `${unit.name} (${unit.id})`)
        .join(", ")}`,
    );
  }

  return deleted;
}
