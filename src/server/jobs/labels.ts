import { JOB_NAMES, type JobName } from "./status";

export interface JobLabel {
  label: string;
  description: string;
  labelKey: string;
  descriptionKey: string;
}


export const JOB_LABELS: Record<JobName, JobLabel> = {
  [JOB_NAMES.notificationDispatch]: {
    label: "Email delivery",
    description: "Delivers queued email messages.",
    labelKey: "screens.jobs.jobLabels.notification_dispatch.label",
    descriptionKey: "screens.jobs.jobLabels.notification_dispatch.description",
  },
  [JOB_NAMES.pushDispatch]: {
    label: "Browser notification delivery",
    description: "Delivers queued browser notifications.",
    labelKey: "screens.jobs.jobLabels.push_dispatch.label",
    descriptionKey: "screens.jobs.jobLabels.push_dispatch.description",
  },
  [JOB_NAMES.missingActivityReminder]: {
    label: "Daily activity reminder",
    description: "Reminds people who have not entered an activity today.",
    labelKey: "screens.jobs.jobLabels.missing_activity_reminder.label",
    descriptionKey: "screens.jobs.jobLabels.missing_activity_reminder.description",
  },
  [JOB_NAMES.overdueAnswerReminder]: {
    label: "Unanswered question reminder",
    description: "Sends reminders for overdue questions.",
    labelKey: "screens.jobs.jobLabels.overdue_answer_reminder.label",
    descriptionKey: "screens.jobs.jobLabels.overdue_answer_reminder.description",
  },
  [JOB_NAMES.overdueApprovalReminder]: {
    label: "Pending approval reminder",
    description: "Sends reminders for overdue approvals.",
    labelKey: "screens.jobs.jobLabels.overdue_approval_reminder.label",
    descriptionKey: "screens.jobs.jobLabels.overdue_approval_reminder.description",
  },
  [JOB_NAMES.scorePeriodClose]: {
    label: "Score period recording",
    description: "Stores scores for closed periods.",
    labelKey: "screens.jobs.jobLabels.score_period_close.label",
    descriptionKey: "screens.jobs.jobLabels.score_period_close.description",
  },
  [JOB_NAMES.backup]: {
    label: "Daily backup",
    description: "Creates an encrypted backup of the database and file storage.",
    labelKey: "screens.jobs.jobLabels.backup.label",
    descriptionKey: "screens.jobs.jobLabels.backup.description",
  },
};

function knownJob(jobName: string): JobLabel | undefined {
  return Object.prototype.hasOwnProperty.call(JOB_LABELS, jobName)
    ? JOB_LABELS[jobName as JobName]
    : undefined;
}

export function jobLabel(jobName: string): string {
  return knownJob(jobName)?.label ?? "Scheduled job";
}

export function jobDescription(jobName: string): string {
  return knownJob(jobName)?.description ?? "Runs a background job.";
}

export function jobLabelKey(jobName: string): string {
  return knownJob(jobName)?.labelKey ?? "screens.jobs.unknownJob";
}

export function jobDescriptionKey(jobName: string): string {
  return knownJob(jobName)?.descriptionKey ?? "screens.jobs.unknownJob";
}


export function formatJobInterval(minutes: number): string {
  const minuteCount = minutes % 60;
  const hourCount = Math.floor(minutes / 60);
  const minuteLabel = minuteCount === 1 ? "minute" : "minutes";
  const hourLabel = hourCount === 1 ? "hour" : "hours";

  if (minutes < 60) return `${minutes} ${minuteLabel}`;
  if (minuteCount === 0) return `${hourCount} ${hourLabel}`;
  return `${hourCount} ${hourLabel} ${minuteCount} ${minuteLabel}`;
}

/** Formats a delay for use in an email sentence. */
export function formatJobLag(minutes: number | null): string {
  if (minutes === null) return "a long time";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}
