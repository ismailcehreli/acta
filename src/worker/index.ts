

//


//



import { prisma } from "@/server/db";
import {
  JOB_NAMES,
  recordJobFailure,
  recordJobSuccess,
  type JobName,
} from "@/server/jobs/status";
import { readSmtpSettings } from "@/server/settings/smtp";

import { alertOnDelayedJobs } from "./jobs/alert";

import { dispatchNotifications } from "./notifications/dispatcher";
import { dispatchPushNotifications } from "./notifications/push";
import { webPushTransport } from "./notifications/push-transport";
import {
  createLogTransport,
  createSmtpTransport,
  type EmailTransport,
} from "./notifications/transport";
import { sendMissingActivityReminders } from "./reminders/no-activity";
import { drainScorePeriodWork } from "@/server/scoring/close-period";
import { sendOverdueAnswerReminders } from "./reminders/overdue-answers";
import { sendOverdueApprovalReminders } from "./reminders/overdue-approvals";

const TICK_INTERVAL_MS = Number(process.env.WORKER_TICK_INTERVAL_MS ?? 60_000);
const BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";





let transport: EmailTransport = createLogTransport();
let transportSignature = "";

async function updateTransport(): Promise<void> {
  const smtp = await readSmtpSettings(prisma);
  const signature = smtp ? JSON.stringify(smtp) : "";

  if (signature === transportSignature) return;

  transportSignature = signature;


  transport = smtp ? createSmtpTransport(smtp) : createLogTransport();
  log(`email transport: ${transport.name}`);
}

let stopping = false;
/** Interrupts the pending sleep when the process receives a shutdown signal. */
let interruptSleep: (() => void) | null = null;

function log(message: string): void {
  console.log(`[worker] ${new Date().toISOString()} ${message}`);
}

/**
 * Runs one job step and records its heartbeat. A failed step does not stop the
 * cycle: the failure is recorded, later steps run, and the issue is visible
 * through health reporting (§12.4).
 */
async function runJobStep<T>(
  jobName: JobName,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    const result = await run();
    await recordJobSuccess(prisma, jobName, new Date());
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`${jobName} failed: ${message}`);
    await recordJobFailure(prisma, jobName, message);
    return null;
  }
}

async function tick(): Promise<void> {
  const now = new Date();

  await updateTransport();

  // Queue reminders before dispatching the queue so reminders created in this
  // cycle can be delivered in the same cycle.
  const missingActivity = await runJobStep(JOB_NAMES.missingActivityReminder, () =>
    sendMissingActivityReminders(prisma, now),
  );
  if (missingActivity && missingActivity.queued > 0) {
    log(
      `reminder: ${missingActivity.queued} people have no activity today ` +
        `(${missingActivity.skippedHasActivity} entered one, ` +
        `${missingActivity.skippedNoActivityMark} are on leave)`,
    );
  }

  const overdueAnswers = await runJobStep(JOB_NAMES.overdueAnswerReminder, () =>
    sendOverdueAnswerReminders(prisma, now),
  );
  if (overdueAnswers && overdueAnswers.queued > 0) {
    log(
      `reminder: ${overdueAnswers.overdueConversations} overdue conversations, ` +
        `${overdueAnswers.queued} notifications` +
        (overdueAnswers.managerNotFound > 0
          ? ` (${overdueAnswers.managerNotFound} managers not found)`
          : ""),
    );
  }

  // Store closed-period scores: trends and decline detection use history,
  // while live calculation covers only the current period (Task 11.11).
  const scorePeriod = await runJobStep(JOB_NAMES.scorePeriodClose, () =>
    drainScorePeriodWork(prisma, now),
  );
  if (scorePeriod && scorePeriod.processed > 0) {
    log(
      `score period: ${scorePeriod.processed} jobs, ${scorePeriod.written} score revisions ` +
        `(${scorePeriod.periodStarts.join(", ")})`,
    );
  }

  const overdueApproval = await runJobStep(JOB_NAMES.overdueApprovalReminder, () =>
    sendOverdueApprovalReminders(prisma, now),
  );
  if (overdueApproval && overdueApproval.queued > 0) {
    log(
      `reminder: ${overdueApproval.overdue} overdue approvals, ` +
        `${overdueApproval.queued} notifications`,
    );
  }

  const result = await runJobStep(JOB_NAMES.notificationDispatch, () =>
    dispatchNotifications(prisma, transport, { now, baseUrl: BASE_URL }),
  );

  // Push is a separate step: notifications should continue if the mail server
  // fails, and vice versa. Queue records are separate so the channels do not
  // block one another.
  const push = await runJobStep(JOB_NAMES.pushDispatch, () =>
    dispatchPushNotifications(prisma, webPushTransport, {
      now,
      baseUrl: BASE_URL,
    }),
  );
  if (push && push.sent > 0) {
    log(
      `push: ${push.sent} sends, ${push.delivered} notifications delivered, ` +
        `${push.droppedSubscriptions} expired subscriptions dropped`,
    );
  }

  // Check delayed-job alerts at the **end** of the cycle: completed steps have
  // already written their heartbeats. Otherwise the process would alert about
  // itself on every startup. Alerts are queued for the next cycle.
  //
  // **Limit:** if the worker dies completely, this alert cannot be sent. The
  // external monitor catches that through `/api/health`, which reports
  // scheduler lag and declares the worker "down" after the threshold (§12.4).
  // This alert covers a live process with one stalled step.
  const delayedJobAlert = await alertOnDelayedJobs(prisma, new Date());
  if (delayedJobAlert.delayedJobs.length > 0) {
    log(
      `delayed jobs: ${delayedJobAlert.delayedJobs.join(", ")} · ${delayedJobAlert.queued} alerts queued`,
    );
  }

  // There are no silent cycles: log counts when work was done and a heartbeat
  // otherwise. The log should show that the scheduler is running (§12.4).
  if (result && result.sent + result.failed + result.givenUp > 0) {
    log(
      `notifications: ${result.sent} emails, ${result.delivered} sent, ` +
        `${result.failed} failed, ${result.givenUp} abandoned`,
    );
  } else {
    log("heartbeat");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      interruptSleep = null;
      resolve();
    }, ms);

    interruptSleep = () => {
      clearTimeout(timer);
      interruptSleep = null;
      resolve();
    };
  });
}

async function main(): Promise<void> {
  log(`started (interval: ${TICK_INTERVAL_MS} ms)`);

  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      // One failed cycle must not terminate the process; the error must remain
      // visible.
      log(`cycle failed: ${error instanceof Error ? error.message : error}`);
    }

    if (stopping) break;
    await sleep(TICK_INTERVAL_MS);
  }

  log("durdu");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`);
    stopping = true;
    interruptSleep?.();
  });
}

main().catch((error) => {
  log(`fatal error: ${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
