import type { PrismaClient } from "@prisma/client";


//



//




export const JOB_NAMES = {

  notificationDispatch: "notification_dispatch",

  pushDispatch: "push_dispatch",

  missingActivityReminder: "missing_activity_reminder",

  overdueAnswerReminder: "overdue_answer_reminder",

  overdueApprovalReminder: "overdue_approval_reminder",

  scorePeriodClose: "score_period_close",

  backup: "backup",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];


export const DEFAULT_EXPECTED_INTERVAL_MINUTES = 1;


export const EXPECTED_INTERVAL_MINUTES: Record<string, number> = {
  [JOB_NAMES.backup]: 24 * 60,
};

function expectedInterval(jobName: string): number {
  return EXPECTED_INTERVAL_MINUTES[jobName] ?? DEFAULT_EXPECTED_INTERVAL_MINUTES;
}

export type JobStatusDb = Pick<PrismaClient, "scheduledJobStatus">;


export async function recordJobSuccess(
  db: JobStatusDb,
  jobName: JobName,
  now: Date,
  expectedIntervalMinutes = expectedInterval(jobName),
): Promise<void> {
  await db.scheduledJobStatus.upsert({
    where: { jobName },
    update: { lastSuccessAt: now, lastError: null, expectedIntervalMinutes },
    create: {
      jobName,
      lastSuccessAt: now,
      lastError: null,
      expectedIntervalMinutes,
    },
  });
}


export async function recordJobFailure(
  db: JobStatusDb,
  jobName: JobName,
  message: string,
  expectedIntervalMinutes = expectedInterval(jobName),
): Promise<void> {
  const truncatedMessage = message.slice(0, 1_000);

  await db.scheduledJobStatus.upsert({
    where: { jobName },
    update: { lastError: truncatedMessage },
    create: {
      jobName,
      lastSuccessAt: null,
      lastError: truncatedMessage,
      expectedIntervalMinutes,
    },
  });
}

export interface JobHealth {
  jobName: string;
  lastSuccessAt: Date | null;
  lastError: string | null;
  expectedIntervalMinutes: number;

  lagSeconds: number | null;

  delayed: boolean;
}


export const DELAY_FACTOR = 2;

export function describeJob(
  row: {
    jobName: string;
    lastSuccessAt: Date | null;
    lastError: string | null;
    expectedIntervalMinutes: number;
  },
  now: Date,
): JobHealth {
  const lagSeconds =
    row.lastSuccessAt === null
      ? null
      : Math.max(0, Math.floor((now.getTime() - row.lastSuccessAt.getTime()) / 1000));

  const thresholdSeconds = row.expectedIntervalMinutes * 60 * DELAY_FACTOR;

  return {
    ...row,
    lagSeconds,


    delayed: lagSeconds === null || lagSeconds > thresholdSeconds,
  };
}

export async function listJobHealth(
  db: JobStatusDb,
  now: Date,
): Promise<JobHealth[]> {
  const rows = await db.scheduledJobStatus.findMany({
    orderBy: { jobName: "asc" },
  });

  const registered = new Map(rows.map((row) => [row.jobName, row]));



  return Object.values(JOB_NAMES).map((jobName) =>
    describeJob(
      registered.get(jobName) ?? {
        jobName,
        lastSuccessAt: null,
        lastError: null,
        expectedIntervalMinutes: expectedInterval(jobName),
      },
      now,
    ),
  );
}


export function worstLagSeconds(jobs: JobHealth[]): number | null {
  if (jobs.length === 0) return null;
  if (jobs.some((job) => job.lagSeconds === null)) return null;

  return Math.max(...jobs.map((job) => job.lagSeconds ?? 0));
}
