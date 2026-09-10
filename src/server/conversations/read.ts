import type { PrismaClient } from "@prisma/client";

import {
  findVisibleActivity,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import { canViewActivity } from "@/server/authz/visibility";

// Konuşmaların okunması (§9.4): faaliyeti görebilen **ara kademeler de**
// konuşmaları görür — müdür, ekibi hakkında Genel Müdür'ün ne sorduğunu
// bilmelidir.
//
// Yetki burada da doğrulanır. Önceden bu fonksiyon görüntüleyiciyi hiç
// almıyordu ve yalnızca çağıran sayfanın ön kontrolüyle korunuyordu; kendi
// başına yetkisiz bir okuma yoluydu (denetim 18.08.2026, bulgu 1).

export type ConversationReadDb = Pick<PrismaClient, "conversation"> &
  ActivityRepositoryDb;

export interface ConversationMessageView {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: Date;
}

export interface ConversationView {
  id: string;
  status: "OPEN" | "CLOSED";
  askerId: string;
  askerName: string;
  /** İş şu an kimde (§9.1). */
  responsibleId: string;
  responsibleName: string;
  openedAt: Date;
  closedAt: Date | null;
  closeType: string | null;
  messages: ConversationMessageView[];
}

export async function listActivityConversations(
  db: ConversationReadDb,
  viewer: { id: string; isSystemAdmin: boolean },
  activityId: string,
): Promise<ConversationView[]> {
  const activity = await findVisibleActivity(db, viewer, {
    where: { id: activityId },
    select: { id: true, authorId: true, approvalStatus: true },
  });

  if (!activity) return [];

  const rows = await db.conversation.findMany({
    where: { activityId },
    orderBy: { openedAt: "asc" },
    select: {
      id: true,
      status: true,
      askerId: true,
      responsibleId: true,
      openedAt: true,
      closedAt: true,
      closeType: true,
      asker: { select: { fullName: true } },
      responsible: { select: { fullName: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          authorId: true,
          text: true,
          createdAt: true,
          author: { select: { fullName: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    askerId: row.askerId,
    askerName: row.asker.fullName,
    responsibleId: row.responsibleId,
    responsibleName: row.responsible.fullName,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    closeType: row.closeType,
    messages: row.messages.map((message) => ({
      id: message.id,
      authorId: message.authorId,
      authorName: message.author.fullName,
      text: message.text,
      createdAt: message.createdAt,
    })),
  }));
}

export interface OpenWorkItem {
  conversationId: string;
  activityId: string;
  activityTitle: string;
  /** Sıra bu kullanıcıda mı, yoksa karşı taraftan cevap mı bekliyor (§9.4). */
  waitingOnMe: boolean;
  counterpartName: string;
  openedAt: Date;
}

/**
 * "Bana düşenler" listesi (§9.4): **soru cevaplanana kadar hem soranın hem
 * sorumlunun listesinde durur** — Excel'de eksik olan tam olarak buydu.
 * Önceden yalnızca sorumluluğu üstünde olanlar sayılıyordu, soran kendi açık
 * sorusunu takip edemiyordu (denetim 18.08.2026, bulgu 7).
 *
 * Liste faaliyet görünürlüğüyle daraltılır: kişi artık göremediği bir
 * faaliyetin konuşmasını burada da görmez (bulgu 1).
 */
export async function listOpenWorkItems(
  db: ConversationReadDb,
  viewer: { id: string; isSystemAdmin: boolean },
  limit = 50,
): Promise<OpenWorkItem[]> {
  const rows = await db.conversation.findMany({
    where: {
      status: "OPEN",
      // Taraflar **sabittir**: soran ve faaliyetin yazarı. `responsibleId` her
      // mesajda el değiştirdiği için ona bakmak, sırası karşı tarafa geçen
      // kişiyi kendi işinden düşürüyordu.
      OR: [
        { askerId: viewer.id },
        { responsibleId: viewer.id },
        { activity: { authorId: viewer.id } },
      ],
    },
    orderBy: { openedAt: "asc" },
    take: limit,
    select: {
      id: true,
      activityId: true,
      askerId: true,
      responsibleId: true,
      openedAt: true,
      asker: { select: { fullName: true } },
      activity: {
        select: {
          id: true,
          title: true,
          authorId: true,
          approvalStatus: true,
          author: { select: { fullName: true } },
        },
      },
    },
  });

  const items: OpenWorkItem[] = [];

  for (const row of rows) {
    if ((await canViewActivity(db, viewer, row.activity)) !== "full") continue;

    items.push({
      conversationId: row.id,
      activityId: row.activityId,
      activityTitle: row.activity.title,
      waitingOnMe: row.responsibleId === viewer.id,
      // Karşı taraf da sabit rollerden okunur.
      counterpartName:
        row.askerId === viewer.id
          ? row.activity.author.fullName
          : row.asker.fullName,
      openedAt: row.openedAt,
    });
  }

  return items;
}
