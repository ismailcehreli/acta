import type { PrismaClient } from "@prisma/client";

import { closeConversation, type Actor, type ConversationDb } from "./service";


//





//




export type CloseForDeactivationDb = ConversationDb & Pick<PrismaClient, "conversation">;

export interface BulkCloseOutcome {
  closed: number;
  failed: number;
}

export async function closeOpenConversationsForUser(
  db: CloseForDeactivationDb,
  actor: Actor,
  targetUserId: string,
  reason: string,
  now: Date,
): Promise<BulkCloseOutcome> {
  const open = await db.conversation.findMany({
    where: {
      status: "OPEN",
      OR: [{ askerId: targetUserId }, { responsibleId: targetUserId }],
    },
    select: { id: true },
  });

  let closed = 0;
  let failed = 0;

  for (const conversation of open) {
    const result = await closeConversation(db, actor, conversation.id, now, reason);
    if (result.ok) closed += 1;
    else failed += 1;
  }

  return { closed, failed };
}
