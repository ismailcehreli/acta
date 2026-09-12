import type { PrismaClient } from "@prisma/client";

import { JOB_NAMES, listJobHealth } from "@/server/jobs/status";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  readBooleanSetting,
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";



//




export type JobAlertDb = Pick<
  PrismaClient,
  "scheduledJobStatus" | "notificationQueue" | "user" | "systemSetting"
>;

export interface JobAlertOutcome {
  delayedJobs: string[];
  queued: number;
}


function recurrenceKey(now: Date, hours: number): string {
  return String(Math.floor(now.getTime() / (hours * 60 * 60 * 1_000)));
}

export async function alertOnDelayedJobs(
  db: JobAlertDb,
  now: Date,
): Promise<JobAlertOutcome> {
  const jobs = await listJobHealth(db, now);
  const [alertOpen, backupMonitoring, repeatHours] = await Promise.all([
    readBooleanSetting(db, SETTING_KEYS.jobDelayAlertEnabled),
    readBooleanSetting(db, SETTING_KEYS.backupMonitoringEnabled),
    readNumericSetting(db, SETTING_KEYS.jobDelayAlertRepeatHours),
  ]);
  const overdue = alertOpen
    ? jobs.filter(
        (job) =>
          job.delayed &&
          (job.jobName !== JOB_NAMES.backup || backupMonitoring),
      )
    : [];

  const outcome: JobAlertOutcome = {
    delayedJobs: overdue.map((job) => job.jobName),
    queued: 0,
  };

  if (overdue.length === 0) return outcome;

  const administrators = await db.user.findMany({
    where: { isSystemAdmin: true, isActive: true },
    select: { id: true },
  });


  if (administrators.length === 0) {
    console.error(
      "[job monitoring] A job is overdue, but no active system administrator exists; alert not queued.",
    );
    return outcome;
  }

  const recurrence = recurrenceKey(now, repeatHours);

  for (const job of overdue) {
    for (const manager of administrators) {
      const queued = await enqueueNotification(db, {
        userId: manager.id,
        eventType: NOTIFICATION_EVENTS.jobDelayed,
        payload: {
          jobName: job.jobName,
          lagMinutes:
            job.lagSeconds === null ? null : Math.floor(job.lagSeconds / 60),
        },
        idempotencyKey: `job_delayed:${job.jobName}:${manager.id}:${recurrence}`,
        now,
      });

      if (queued) outcome.queued += 1;
    }
  }

  return outcome;
}
