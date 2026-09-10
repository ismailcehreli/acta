import type { PrismaClient } from "@prisma/client";

import { closeConversation, type Actor, type ConversationDb } from "./service";

// Pasifleştirmenin önündeki açık konuşmaları gerekçeyle kapatır (§9.3, §4.6).
//
// İdari kapatmanın yeri buraya konuldu: sistem yöneticisi faaliyet içeriğini
// göremediği için (§15.1) detay ekranındaki kapatma formuna hiçbir yoldan
// ulaşamıyordu — kural servis düzeyinde vardı, kullanılamıyordu (plan açık
// soru 12, ürün sahibi kararı 18.08.2026). Kilit de burada doğuyor: §4.6 açık
// konuşması olan kullanıcının pasifleştirilmesini engelliyor.
//
// Her konuşma ayrı kapatılır ve kapatma kararı tek yerden — `closeConversation`
// — geçer; yetki, gerekçe zorunluluğu ve satır kilidi orada. Kısmi başarı
// gizlenmez: kaç konuşmanın kapanmadığı çağırana döner.

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
