import type { PrismaClient } from "@prisma/client";

import { activityMaintenanceReader } from "@/server/authz/activity-repository";
import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";



//




//



export type OverdueApprovalDb = Pick<
  PrismaClient,
  | "activity"
  | "notificationQueue"
  | "workCalendar"
  | "holiday"
  | "systemSetting"
>;

export interface OverdueApprovalOutcome {

  queued: number;

  overdue: number;
}

export async function sendOverdueApprovalReminders(
  db: OverdueApprovalDb,
  now: Date,
): Promise<OverdueApprovalOutcome> {
  const outcome: OverdueApprovalOutcome = { queued: 0, overdue: 0 };

  const pendingRecords = await activityMaintenanceReader(db).findMany({
    where: {
      approvalStatus: "PENDING_APPROVAL",
      approverId: { not: null },
      approvalSubmittedAt: { not: null },
    },
    select: {
      id: true,
      approverId: true,
      approvalSubmittedAt: true,
    },
  });

  if (pendingRecords.length === 0) return outcome;

  const earliest = pendingRecords.reduce(
    (min, record) =>
      record.approvalSubmittedAt! < min ? record.approvalSubmittedAt! : min,
    pendingRecords[0].approvalSubmittedAt!,
  );

  const [calendarSettings, companyCalendar, threshold] = await Promise.all([
    readWorkCalendar(db),
    loadWorkCalendar(db, earliest, now),
    readNumericSetting(db, SETTING_KEYS.pendingApprovalBusinessDays),
  ]);

  const calendar = {
    workingDays: calendarSettings.workingDays,
    holidays: companyCalendar.holidays,
  };

  for (const record of pendingRecords) {
    const pendingSince = record.approvalSubmittedAt!;
    const isDay = businessDaysBetween(pendingSince, now, calendar);

    if (isDay < threshold) continue;

    outcome.overdue += 1;



    const enqueued = await enqueueNotification(db, {
      userId: record.approverId!,
      eventType: NOTIFICATION_EVENTS.approvalOverdue,
      payload: { activityId: record.id },
      idempotencyKey: `approval_overdue:${record.id}:${pendingSince.toISOString()}`,
      now,
    });

    if (enqueued) outcome.queued += 1;
  }

  return outcome;
}
