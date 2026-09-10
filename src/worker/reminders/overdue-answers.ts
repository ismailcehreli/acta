import type { PrismaClient } from "@prisma/client";

import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { resolveManager } from "@/server/org/resolve-manager";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";

// "3 iş günüdür cevap yok" hatırlatması (§12.2): sorumluya **ve yöneticisine**
// gider. Amaç, sorulan sorunun sessizce unutulmaması.
//
// Sayaç **sorumluluğun son el değiştirdiği andan** işler (ürün sahibi kararı,
// 18.08.2026 — açık soru 13). Konuşmanın açılışından ölçmek, canlı bir
// tartışmanın ortasında da hatırlatma göndermek demekti: soru → cevap → karşı
// soru zincirinde her mesaj sırayı devrediyor ve bekleyen taraf değişiyor.
//
// Bu kural §9.3'teki 10 iş günüyle karıştırılmamalı: o, **soranın üstüne
// kapatma yetkisi** verir; bu, cevap vermeyene hatırlatma gönderir.

/**
 * Kaç iş günü cevapsız kalınca hatırlatma gider (§12.2). Varsayılan; güncel
 * değer sistem ayarlarından gelir (§16.5) — "bugün üç, yarın bir" kararı
 * ekrandan verilebilmeli.
 */
export const OVERDUE_ANSWER_BUSINESS_DAYS = 3;

export type OverdueAnswerDb = Pick<
  PrismaClient,
  | "conversation"
  | "conversationMessage"
  | "notificationQueue"
  | "workCalendar"
  | "holiday"
  | "user"
  | "orgUnit"
  | "systemSetting"
>;

export interface OverdueOutcome {
  /** Kuyruğa yazılan hatırlatma sayısı (sorumlu + yönetici ayrı sayılır). */
  queued: number;
  /** Süresi dolmuş konuşma sayısı. */
  overdueConversations: number;
  /** Yöneticisi bulunamadığı için yalnız sorumluya gidenler. */
  managerNotFound: number;
}

export async function sendOverdueAnswerReminders(
  db: OverdueAnswerDb,
  now: Date,
): Promise<OverdueOutcome> {
  const outcome: OverdueOutcome = {
    queued: 0,
    overdueConversations: 0,
    managerNotFound: 0,
  };

  const open = await db.conversation.findMany({
    where: { status: "OPEN" },
    select: { id: true, responsibleId: true, openedAt: true, activityId: true },
  });

  if (open.length === 0) return outcome;

  const [calendarSettings, companyCalendar, esik] = await Promise.all([
    readWorkCalendar(db),
    // Aralık en eski konuşmanın açılışından bugüne; tatiller o aralıktan okunur.
    loadWorkCalendar(
      db,
      open.reduce((min, c) => (c.openedAt < min ? c.openedAt : min), open[0].openedAt),
      now,
    ),
    readNumericSetting(db, SETTING_KEYS.overdueAnswerBusinessDays),
  ]);

  const takvim = {
    workingDays: calendarSettings.workingDays,
    holidays: companyCalendar.holidays,
  };

  for (const conversation of open) {
    // Sorumluluğun son el değiştirdiği an = son mesajın yazıldığı an. Hiç mesaj
    // yoksa (kuramsal) açılış anı kullanılır.
    const sonMesaj = await db.conversationMessage.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const bekleyenAndan = sonMesaj?.createdAt ?? conversation.openedAt;
    const isGunu = businessDaysBetween(bekleyenAndan, now, takvim);

    if (isGunu < esik) continue;

    outcome.overdueConversations += 1;

    // Anahtar bekleme anını taşır: cevap gelip sayaç yeniden dolarsa yeni bir
    // hatırlatma gidebilir, ama aynı bekleyiş için ikinci kez gitmez.
    const anahtar = `${conversation.id}:${bekleyenAndan.toISOString()}`;

    const yazildi = await enqueueNotification(db, {
      userId: conversation.responsibleId,
      eventType: NOTIFICATION_EVENTS.answerOverdue,
      payload: { activityId: conversation.activityId, conversationId: conversation.id },
      idempotencyKey: `answer_overdue:${anahtar}:${conversation.responsibleId}`,
      now,
    });
    if (yazildi) outcome.queued += 1;

    const manager = await resolveManager(db, conversation.responsibleId);

    // Yöneticisi bulunamayan durum sessizce geçilmez; sayılır ve çağırana döner.
    if (!manager.found) {
      outcome.managerNotFound += 1;
      continue;
    }

    const yoneticiyeYazildi = await enqueueNotification(db, {
      userId: manager.managerId,
      eventType: NOTIFICATION_EVENTS.answerOverdue,
      payload: { activityId: conversation.activityId, conversationId: conversation.id },
      idempotencyKey: `answer_overdue:${anahtar}:${manager.managerId}`,
      now,
    });
    if (yoneticiyeYazildi) outcome.queued += 1;
  }

  return outcome;
}
