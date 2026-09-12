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



//




//




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

  queued: number;

  overdueConversations: number;

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

  const [calendarSettings, companyCalendar, threshold] = await Promise.all([
    readWorkCalendar(db),

    loadWorkCalendar(
      db,
      open.reduce((min, c) => (c.openedAt < min ? c.openedAt : min), open[0].openedAt),
      now,
    ),
    readNumericSetting(db, SETTING_KEYS.overdueAnswerBusinessDays),
  ]);

  const calendar = {
    workingDays: calendarSettings.workingDays,
    holidays: companyCalendar.holidays,
  };

  for (const conversation of open) {


    const lastMessage = await db.conversationMessage.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const pendingSince = lastMessage?.createdAt ?? conversation.openedAt;
    const isDay = businessDaysBetween(pendingSince, now, calendar);

    if (isDay < threshold) continue;

    outcome.overdueConversations += 1;



    const key = `${conversation.id}:${pendingSince.toISOString()}`;

    const enqueued = await enqueueNotification(db, {
      userId: conversation.responsibleId,
      eventType: NOTIFICATION_EVENTS.answerOverdue,
      payload: { activityId: conversation.activityId, conversationId: conversation.id },
      idempotencyKey: `answer_overdue:${key}:${conversation.responsibleId}`,
      now,
    });
    if (enqueued) outcome.queued += 1;

    const manager = await resolveManager(db, conversation.responsibleId);

    // A missing manager is not silently ignored; count it and return the outcome.
    if (!manager.found) {
      outcome.managerNotFound += 1;
      continue;
    }

    const managerNotificationEnqueued = await enqueueNotification(db, {
      userId: manager.managerId,
      eventType: NOTIFICATION_EVENTS.answerOverdue,
      payload: { activityId: conversation.activityId, conversationId: conversation.id },
      idempotencyKey: `answer_overdue:${key}:${manager.managerId}`,
      now,
    });
    if (managerNotificationEnqueued) outcome.queued += 1;
  }

  return outcome;
}
