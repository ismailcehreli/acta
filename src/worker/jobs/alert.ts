import type { PrismaClient } from "@prisma/client";

import { JOB_NAMES, listJobHealth } from "@/server/jobs/status";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  readBooleanSetting,
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";

// Gecikme alarmı (§12.4): bir iş beklenen aralığın iki katı süredir
// çalışmadıysa sistem yöneticisine e-posta gider.
//
// Alarm **tekrarlanır ama yağmura dönmez**: idempotency anahtarı saat dilimini
// taşır, yani aynı iş için saatte en fazla bir bildirim yazılır. Tek seferlik
// olsaydı, arıza sürerken ikinci bir uyarı hiç gelmezdi.

export type JobAlertDb = Pick<
  PrismaClient,
  "scheduledJobStatus" | "notificationQueue" | "user" | "systemSetting"
>;

export interface JobAlertOutcome {
  delayedJobs: string[];
  queued: number;
}

/** Ayara göre tekrarlanan alarm için kararlı zaman dilimi. */
function tekrarAnahtari(now: Date, saat: number): string {
  return String(Math.floor(now.getTime() / (saat * 60 * 60 * 1_000)));
}

export async function alertOnDelayedJobs(
  db: JobAlertDb,
  now: Date,
): Promise<JobAlertOutcome> {
  const jobs = await listJobHealth(db, now);
  const [alarmAcik, yedekIzleniyor, tekrarSaati] = await Promise.all([
    readBooleanSetting(db, SETTING_KEYS.jobDelayAlertEnabled),
    readBooleanSetting(db, SETTING_KEYS.backupMonitoringEnabled),
    readNumericSetting(db, SETTING_KEYS.jobDelayAlertRepeatHours),
  ]);
  const geciken = alarmAcik
    ? jobs.filter(
        (job) =>
          job.delayed &&
          (job.jobName !== JOB_NAMES.backup || yedekIzleniyor),
      )
    : [];

  const outcome: JobAlertOutcome = {
    delayedJobs: geciken.map((job) => job.jobName),
    queued: 0,
  };

  if (geciken.length === 0) return outcome;

  const yoneticiler = await db.user.findMany({
    where: { isSystemAdmin: true, isActive: true },
    select: { id: true },
  });

  // Sistem yöneticisi yoksa alarm gidecek kimse yok; bu da sessiz kalmamalı.
  if (yoneticiler.length === 0) {
    console.error(
      "[iş izleme] Gecikmiş iş var ama aktif sistem yöneticisi yok; alarm gönderilemedi.",
    );
    return outcome;
  }

  const tekrar = tekrarAnahtari(now, tekrarSaati);

  for (const job of geciken) {
    for (const yonetici of yoneticiler) {
      const yazildi = await enqueueNotification(db, {
        userId: yonetici.id,
        eventType: NOTIFICATION_EVENTS.jobDelayed,
        payload: {
          jobName: job.jobName,
          lagMinutes:
            job.lagSeconds === null ? null : Math.floor(job.lagSeconds / 60),
        },
        idempotencyKey: `job_delayed:${job.jobName}:${yonetici.id}:${tekrar}`,
        now,
      });

      if (yazildi) outcome.queued += 1;
    }
  }

  return outcome;
}
