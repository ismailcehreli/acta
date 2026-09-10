import { JOB_NAMES, type JobName } from "./status";

export interface JobLabel {
  label: string;
  description: string;
}

/** Zamanlanmış işlerin kullanıcıya gösterilen adları tek yerde tutulur. */
export const JOB_LABELS: Record<JobName, JobLabel> = {
  [JOB_NAMES.notificationDispatch]: {
    label: "E-posta gönderimi",
    description: "Kuyruktaki e-postaları gönderir.",
  },
  [JOB_NAMES.pushDispatch]: {
    label: "Tarayıcı bildirimi gönderimi",
    description: "Kuyruktaki tarayıcı bildirimlerini gönderir.",
  },
  [JOB_NAMES.missingActivityReminder]: {
    label: "Günlük faaliyet hatırlatması",
    description: "Bugün faaliyet yazmayan kişilere hatırlatma gönderir.",
  },
  [JOB_NAMES.overdueAnswerReminder]: {
    label: "Cevap bekleyen soru hatırlatması",
    description: "Süresi geçen sorular için hatırlatma gönderir.",
  },
  [JOB_NAMES.overdueApprovalReminder]: {
    label: "Onay bekleyen kayıt hatırlatması",
    description: "Süresi geçen onaylar için hatırlatma gönderir.",
  },
  [JOB_NAMES.scorePeriodClose]: {
    label: "Dönem puanı kaydı",
    description: "Kapanan dönemin puanını saklar.",
  },
  [JOB_NAMES.backup]: {
    label: "Günlük yedekleme",
    description: "Veritabanı ve dosya depolarının şifreli yedeğini alır.",
  },
};

function knownJob(jobName: string): JobLabel | undefined {
  return Object.prototype.hasOwnProperty.call(JOB_LABELS, jobName)
    ? JOB_LABELS[jobName as JobName]
    : undefined;
}

export function jobLabel(jobName: string): string {
  return knownJob(jobName)?.label ?? "Zamanlanmış iş";
}

export function jobDescription(jobName: string): string {
  return knownJob(jobName)?.description ?? "Arka plandaki bir işi çalıştırır.";
}

/** Dakikayı, ekranda okunabilecek kısa bir aralığa çevirir. */
export function formatJobInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} dakika`;
  if (minutes % 60 === 0) return `${minutes / 60} saat`;
  return `${Math.floor(minutes / 60)} saat ${minutes % 60} dakika`;
}

/** Gecikme süresini e-posta cümlesinde kullanılacak hâle getirir. */
export function formatJobLag(minutes: number | null): string {
  if (minutes === null) return "uzun süredir";
  if (minutes < 60) return `${minutes} dakikadır`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saattir`;
  return `${Math.floor(hours / 24)} gündür`;
}
