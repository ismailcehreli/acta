import type { PrismaClient } from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";
import {
  listActivitiesByAuthors,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import { periodCoveringDay } from "@/server/absence/period-filter";
import { JOB_NAMES, listJobHealth } from "@/server/jobs/status";
import { readBooleanSetting, SETTING_KEYS } from "@/server/settings/system-settings";


//





export type SummaryDb = Pick<
  PrismaClient,
  | "user"
  | "notificationQueue"
  | "scheduledJobStatus"
  | "systemSetting"
> & ActivityRepositoryDb;

export interface TeamParticipation {

  people: number;

  wrote: number;
}


export async function teamParticipationToday(
  db: SummaryDb,
  subordinates: string[],
  now: Date,
): Promise<TeamParticipation | null> {
  if (subordinates.length === 0) return null;

  const open = await readBooleanSetting(
    db,
    SETTING_KEYS.managerParticipationSummary,
  );
  if (!open) return null;


  //

  //      gibi roller).

  //



  //


  const today = companyDay(now);

  const expectedUsers = await db.user.findMany({
    where: {
      id: { in: subordinates },
      writesActivities: true,

      noActivityPeriods: { none: periodCoveringDay(toDateValue(today)) },
    },
    select: { id: true },
  });
  if (expectedUsers.length === 0) return null;

  const expectedUserIds = expectedUsers.map((person) => person.id);

  const authors = await listActivitiesByAuthors(db, expectedUserIds, {
    where: {
      activityDate: toDateValue(today),
      approvalStatus: { not: "CANCELLED" },
    },
    select: { authorId: true },
    distinct: ["authorId"],
  });

  return { people: expectedUserIds.length, wrote: authors.length };
}

export interface OperationsSummary {
  queuePending: number;
  queueFailed: number;
  jobsTotal: number;
  jobsDelayed: number;

  backupMonitoring: boolean;

  backupAgeHours: number | null;
}


export async function operationsSummary(
  db: SummaryDb,
  now: Date,
): Promise<OperationsSummary> {
  const [queuePending, queueFailed, jobs, backupMonitoringEnabled] = await Promise.all([
    db.notificationQueue.count({ where: { status: "PENDING" } }),
    db.notificationQueue.count({ where: { status: "FAILED" } }),
    listJobHealth(db, now),
    readBooleanSetting(db, SETTING_KEYS.backupMonitoringEnabled),
  ]);

  const backupJob = jobs.find((job) => job.jobName === JOB_NAMES.backup);
  const monitoredJobs = jobs.filter(
    (job) => job.jobName !== JOB_NAMES.backup || backupMonitoringEnabled,
  );

  return {
    queuePending,
    queueFailed,
    jobsTotal: monitoredJobs.length,
    jobsDelayed: monitoredJobs.filter((job) => job.delayed).length,
    backupMonitoring: backupMonitoringEnabled,
    backupAgeHours:
      backupJob?.lagSeconds === null || backupJob === undefined
        ? null
        : Math.floor(backupJob.lagSeconds / 3600),
  };
}
