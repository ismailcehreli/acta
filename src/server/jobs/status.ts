import type { PrismaClient } from "@prisma/client";

// Zamanlanmış işlerin nabzı (§12.4).
//
// **Zamanlayıcı durursa sistem çalışıyor görünür ama bu süreçler sessizce
// ölür.** Tespit edilmesi en zor arıza türü budur: ekranlar açılır, kayıtlar
// yazılır, yalnız hatırlatmalar ve bildirimler gelmez — kimse fark etmez.
//
// Karşı önlem üç parçalı: her iş son başarılı çalışmasını yazar, gecikme
// sağlık ucundan ve yönetim ekranından görünür, beklenen aralığın iki katı
// gecikmede sistem yöneticisine alarm gider.

export const JOB_NAMES = {
  /** Bildirim kuyruğunun gönderimi. */
  notificationDispatch: "notification_dispatch",
  /** Tarayıcı bildirimlerinin gönderimi (Görev 5.3b). */
  pushDispatch: "push_dispatch",
  /** Mesai sonu "bugün faaliyet yok" hatırlatması. */
  missingActivityReminder: "missing_activity_reminder",
  /** "Üç iş günüdür cevap yok" hatırlatması. */
  overdueAnswerReminder: "overdue_answer_reminder",
  /** Onay bekleyen kayıt gecikti hatırlatması (§5.4). */
  overdueApprovalReminder: "overdue_approval_reminder",
  /** Kapanan dönemin skorunu saklar (Görev 11.11). */
  scorePeriodClose: "score_period_close",
  /**
   * Günlük yedek (§15.6). İşleyici içinde çalışmaz; `scripts/backup.sh`
   * bitince nabzını kendisi yazar. Böylece "yedek alınmadı" durumu, zamanlanmış
   * iş gecikmesi olarak **mevcut alarm yoluna** düşer — ayrı bir izleme
   * kurmaya gerek kalmaz.
   */
  backup: "backup",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/** İşlerin beklenen çalışma aralığı (dakika). İşleyici turu bir dakikadır. */
export const DEFAULT_EXPECTED_INTERVAL_MINUTES = 1;

/**
 * İşe özel beklenen aralıklar. Yedek günde bir alınır; ona bir dakikalık
 * eşikle bakmak her turda alarm üretirdi.
 */
export const EXPECTED_INTERVAL_MINUTES: Record<string, number> = {
  [JOB_NAMES.backup]: 24 * 60,
};

function expectedInterval(jobName: string): number {
  return EXPECTED_INTERVAL_MINUTES[jobName] ?? DEFAULT_EXPECTED_INTERVAL_MINUTES;
}

export type JobStatusDb = Pick<PrismaClient, "scheduledJobStatus">;

/**
 * İşin başarıyla bittiğini kaydeder. Kayıt yoksa açılır: yeni bir iş eklendiğinde
 * elle satır oluşturmak gerekmesin.
 */
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

/**
 * İşin hata verdiğini kaydeder. **Son başarılı çalışma zamanına dokunulmaz**:
 * hata, işin en son ne zaman gerçekten çalıştığı bilgisini silmemeli — gecikme
 * hesabı ona dayanıyor.
 */
export async function recordJobFailure(
  db: JobStatusDb,
  jobName: JobName,
  message: string,
  expectedIntervalMinutes = expectedInterval(jobName),
): Promise<void> {
  const kisaltilmis = message.slice(0, 1_000);

  await db.scheduledJobStatus.upsert({
    where: { jobName },
    update: { lastError: kisaltilmis },
    create: {
      jobName,
      lastSuccessAt: null,
      lastError: kisaltilmis,
      expectedIntervalMinutes,
    },
  });
}

export interface JobHealth {
  jobName: string;
  lastSuccessAt: Date | null;
  lastError: string | null;
  expectedIntervalMinutes: number;
  /** Son başarılı çalışmadan bu yana geçen saniye; hiç çalışmadıysa `null`. */
  lagSeconds: number | null;
  /** Beklenen aralığın iki katı aşıldı mı (§12.4). */
  delayed: boolean;
}

/** Gecikme eşiği: beklenen aralığın iki katı (§12.4). */
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

  const esikSaniye = row.expectedIntervalMinutes * 60 * DELAY_FACTOR;

  return {
    ...row,
    lagSeconds,
    // Hiç çalışmamış iş de gecikmiş sayılır: "hiç çalışmadı" bir sağlık
    // durumu değil, arızadır.
    delayed: lagSeconds === null || lagSeconds > esikSaniye,
  };
}

export async function listJobHealth(
  db: JobStatusDb,
  now: Date,
): Promise<JobHealth[]> {
  const rows = await db.scheduledJobStatus.findMany({
    orderBy: { jobName: "asc" },
  });

  const kayitli = new Map(rows.map((row) => [row.jobName, row]));

  // Beklenen işlerin tamamı listelenir: hiç kaydı olmayan iş, listede
  // görünmediği için sağlıklı sanılmamalı.
  return Object.values(JOB_NAMES).map((jobName) =>
    describeJob(
      kayitli.get(jobName) ?? {
        jobName,
        lastSuccessAt: null,
        lastError: null,
        expectedIntervalMinutes: expectedInterval(jobName),
      },
      now,
    ),
  );
}

/** Sağlık ucu için tek sayı: en çok gecikmiş işin gecikmesi. */
export function worstLagSeconds(jobs: JobHealth[]): number | null {
  if (jobs.length === 0) return null;
  if (jobs.some((job) => job.lagSeconds === null)) return null;

  return Math.max(...jobs.map((job) => job.lagSeconds ?? 0));
}
