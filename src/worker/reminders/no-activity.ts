import type { PrismaClient } from "@prisma/client";

import { toDateValue } from "@/server/activities/date-rules";
import { activityMaintenanceReader } from "@/server/authz/activity-repository";
import { isNoActivityDay } from "@/server/absence/service";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import {
  loadUnitCalendarIndex,
  resolveUnitWorkWindowFrom,
  type UnitWorkWindow,
} from "@/server/calendar/unit-calendar";
import { companyDay, companyMinuteOfDay } from "@/shared/format/date-time";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";


//

//




//


export type NoActivityReminderDb = Pick<
  PrismaClient,
  | "user"
  | "activity"
  | "notificationQueue"
  | "systemSetting"
  | "noActivityPeriod"
  | "workCalendar"
  | "holiday"
  | "orgUnit"
  | "orgUnitWorkCalendar"
>;

export interface ReminderOutcome {

  queued: number;

  skippedHasActivity: number;

  skippedNoActivityMark: number;

  skippedNotDue: boolean;
}

export async function sendMissingActivityReminders(
  db: NoActivityReminderDb,
  now: Date,
): Promise<ReminderOutcome> {
  const emptyOutcome: ReminderOutcome = {
    queued: 0,
    skippedHasActivity: 0,
    skippedNoActivityMark: 0,
    skippedNotDue: true,
  };




  //


  const companyCalendar = await loadWorkCalendar(db, now, now);
  const today = companyDay(now);
  const isHoliday = companyCalendar.holidays.includes(today);
  const currentMinute = companyMinuteOfDay(now);




  const users = await db.user.findMany({
    where: { isActive: true, writesActivities: true },
    select: { id: true, orgUnitId: true },
  });

  if (users.length === 0) return emptyOutcome;

  const leadMinutes = await readNumericSetting(
    db,
    SETTING_KEYS.noActivityReminderLeadMinutes,
  );



  //




  const calendarIndex = await loadUnitCalendarIndex(db);
  const unitIds = [...new Set(users.map((user) => user.orgUnitId))];
  const workWindows = new Map<string, UnitWorkWindow>();
  for (const unitId of unitIds) {
    workWindows.set(unitId, resolveUnitWorkWindowFrom(calendarIndex, unitId));
  }

  const isoDay = new Date(`${today}T00:00:00.000Z`).getUTCDay() || 7;

  // `skippedNotDue` means that no unit has reached its reminder time. There is
  // no single global answer because windows are unit-specific: one unit may close
  // at 17:00 and another at 18:00, with reminders firing a configured lead time
  // before the end of each window.
  const outcome: ReminderOutcome = { ...emptyOutcome, skippedNotDue: true };
  const day = toDateValue(today);

  for (const user of users) {
    const workWindow = workWindows.get(user.orgUnitId);
    if (!workWindow) continue;

    // Three conditions must hold: today is a workday for the unit, a public
    // holiday does not block it, and the reminder time has arrived.
    const workDay =
      workWindow.workingDays.includes(isoDay) &&
      (!isHoliday || workWindow.worksOnHolidays);

    const triggerMinute = Math.max(
      workWindow.workStartMinute,
      workWindow.workEndMinute - leadMinutes,
    );

    if (!workDay || currentMinute < triggerMinute) continue;

    // At least one unit reached its reminder time; this run was not wasted.
    outcome.skippedNotDue = false;

    const todayActivity = await activityMaintenanceReader(db).count({
      where: {
        authorId: user.id,
        activityDate: day,
        // A cancelled record does not count as an activity entry.
        approvalStatus: { not: "CANCELLED" },
      },
    });

    if (todayActivity > 0) {
      outcome.skippedHasActivity += 1;
      continue;
    }

    if (await isNoActivityDay(db, user.id, today)) {
      outcome.skippedNoActivityMark += 1;
      continue;
    }

    // One reminder per day: the idempotency key includes the day, so a second
    // run does not enqueue another one.
    const enqueued = await enqueueNotification(db, {
      userId: user.id,
      eventType: NOTIFICATION_EVENTS.noActivityToday,
      payload: { day: today },
      idempotencyKey: `no_activity_today:${user.id}:${today}`,
      now,
    });

    if (enqueued) outcome.queued += 1;
  }

  return outcome;
}
