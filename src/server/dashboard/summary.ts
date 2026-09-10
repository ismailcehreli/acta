import type { PrismaClient } from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";
import {
  listActivitiesByAuthors,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import { gunuKapsayanDonem } from "@/server/absence/period-filter";
import { JOB_NAMES, listJobHealth } from "@/server/jobs/status";
import { readBooleanSetting, SETTING_KEYS } from "@/server/settings/system-settings";

// Ana ekranın kademeye göre değişen özetleri (§13.1).
//
// Düzen her kademede aynıdır; **kapsam genişler.** Çalışan kendi kaydını
// görür, yönetici ekibini, üst kademe tüm şirketi. Sistem yöneticisine ayrıca
// bir **işletim** bloğu düşer — içerik değil, sistemin çalışıp çalışmadığı
// (§15.1: işlevsel yetki içerik erişimi vermez).

export type SummaryDb = Pick<
  PrismaClient,
  | "user"
  | "notificationQueue"
  | "scheduledJobStatus"
  | "systemSetting"
> & ActivityRepositoryDb;

export interface TeamParticipation {
  /** Kapsamdaki kişi sayısı. */
  people: number;
  /** Bugün en az bir faaliyet yazan kişi sayısı. */
  wrote: number;
}

/**
 * Ekibin bugünkü katılımı. **Ayara bağlıdır ve varsayılanı kapalıdır** (§12.1):
 * zorunlu görünürlük, insanları "girmiş olmak için" içi boş faaliyet yazmaya
 * itebilir. Ayar kapalıyken `null` döner ve blok hiç render edilmez.
 */
export async function teamParticipationToday(
  db: SummaryDb,
  subordinates: string[],
  now: Date,
): Promise<TeamParticipation | null> {
  if (subordinates.length === 0) return null;

  const acik = await readBooleanSetting(
    db,
    SETTING_KEYS.managerParticipationSummary,
  );
  if (!acik) return null;

  // Payda **beklenen kişilerdir**. İki durumda kişi paydaya girmez:
  //
  //   1. Faaliyet yazması beklenmiyor (§7.4 istisnası — yönetim kurulu üyesi
  //      gibi roller).
  //   2. O gün için "faaliyet beklenmiyor" işareti var (izin, rapor).
  //
  // İkincisi 21.08.2026'da eklendi: ekran "katılım hesabında beklenen gün
  // sayılmaz" diyordu ama kod izinli kişiyi paydada tutuyordu. İzindeki
  // kişi oranı düşürüyor ve yönetici olmayan bir eksiklik görüyordu.
  //
  // Kimse beklenmiyorsa blok hiç gösterilmez — "0/0" bir bilgi değil, bir
  // kafa karışıklığıdır.
  const bugun = companyDay(now);

  const beklenenler = await db.user.findMany({
    where: {
      id: { in: subordinates },
      writesActivities: true,
      // O günü kapsayan bir işaret yoksa beklenir.
      noActivityPeriods: { none: gunuKapsayanDonem(toDateValue(bugun)) },
    },
    select: { id: true },
  });
  if (beklenenler.length === 0) return null;

  const beklenenIds = beklenenler.map((kisi) => kisi.id);

  const yazanlar = await listActivitiesByAuthors(db, beklenenIds, {
    where: {
      activityDate: toDateValue(bugun),
      approvalStatus: { not: "CANCELLED" },
    },
    select: { authorId: true },
    distinct: ["authorId"],
  });

  return { people: beklenenIds.length, wrote: yazanlar.length };
}

export interface OperationsSummary {
  queuePending: number;
  queueFailed: number;
  jobsTotal: number;
  jobsDelayed: number;
  /** Yedek izleme ayarı açık mı? İlk başarılı yedekten sonra açılır. */
  backupMonitoring: boolean;
  /** Son başarılı yedeğin üzerinden geçen saat; hiç alınmadıysa `null`. */
  backupAgeHours: number | null;
}

/**
 * Sistem yöneticisinin işletim özeti (§12.4). Faaliyet içeriği taşımaz;
 * yalnızca kuyruk, zamanlanmış işler ve yedek durumu.
 */
export async function operationsSummary(
  db: SummaryDb,
  now: Date,
): Promise<OperationsSummary> {
  const [queuePending, queueFailed, jobs, yedekIzleniyor] = await Promise.all([
    db.notificationQueue.count({ where: { status: "PENDING" } }),
    db.notificationQueue.count({ where: { status: "FAILED" } }),
    listJobHealth(db, now),
    readBooleanSetting(db, SETTING_KEYS.backupMonitoringEnabled),
  ]);

  const yedek = jobs.find((job) => job.jobName === JOB_NAMES.backup);
  const izlenenGecikmeler = jobs.filter(
    (job) => job.jobName !== JOB_NAMES.backup || yedekIzleniyor,
  );

  return {
    queuePending,
    queueFailed,
    jobsTotal: izlenenGecikmeler.length,
    jobsDelayed: izlenenGecikmeler.filter((job) => job.delayed).length,
    backupMonitoring: yedekIzleniyor,
    backupAgeHours:
      yedek?.lagSeconds === null || yedek === undefined
        ? null
        : Math.floor(yedek.lagSeconds / 3600),
  };
}
