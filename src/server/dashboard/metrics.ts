import type { Prisma, PrismaClient } from "@prisma/client";

import { managedAbsenceEmployeeIds } from "@/server/absence/service";
import { periodStart, type FeedFilters } from "@/server/activities/scope-feed";
import { openQuestionActivityWhere } from "@/server/activities/open-questions";
import {
  countVisibleActivities,
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  visibleActivityWhere,
  type Viewer,
} from "@/server/authz/visibility";
import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import { countableActivityWhere } from "@/server/activities/countable";
import { countManageableFeedback } from "@/server/feedback/service";
import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";

// Ana ekranın sayaçları.
//
// **Sayaç kapsam açmaz.** Hepsi `visibleActivityWhere` üzerinden hesaplanır;
// kullanıcı göremediği bir kaydı sayıda da göremez. Sayı sızıntısı da
// sızıntıdır: "kapsamınızda 4 onay bekliyor" bilgisi, görülemeyen bir kaydın
// varlığını ele verirdi.
//
// Kayıt sayısı ve yazan kişi sayısı akışla **aynı döneme** bağlıdır: kullanıcı
// dönemi değiştirince ikisi birlikte değişir. Bekleyen iş sayıları dönemden
// bağımsızdır — geçen haftadan kalan onay bu haftanın işidir.

export type MetricsDb = ActivityRepositoryDb &
  Pick<
    PrismaClient,
    | "conversation"
    | "followUpItem"
    | "workCalendar"
    | "holiday"
    | "systemSetting"
    | "feedback"
  >;

export interface DashboardMetrics {
  /** Dönemde kapsamda yazılan kayıt. */
  activities: number;
  /** Dönemde kapsamda kayıt yazan farklı kişi. */
  contributors: number;
  /** Kapsamda onay bekleyen kayıt. */
  pendingApproval: number;
  /** Kapsamda düzeltme istenmiş kayıt. */
  correctionRequested: number;
  /** Kapsamda başkasının sorduğu açık sorusu olan faaliyet. */
  openQuestions: number;
  /** Kapsamdaki kayıtlarda açık takip maddesi. */
  openFollowUps: number;
  /** Bunların kaçı eşiği aşacak kadar hareketsiz. */
  staleFollowUps: number;
  /** Hareketsizlik eşiği (iş günü); metinde geçsin diye taşınır. */
  staleThreshold: number;
  /** Bu kişi izin talebi karara bağlayabiliyorsa bekleyen talep sayısı. */
  pendingAbsence: number | null;
  /** Bu kişi geri bildirim yönetebiliyorsa yeni kayıt sayısı. */
  newFeedback: number | null;
}

export interface DashboardMetricsOptions {
  canManageAbsences?: boolean;
  canManageFeedback?: boolean;
}

/**
 * Oturum sahibinin kendi durumunu ekip toplamından bağımsız hesaplar.
 * `dashboardMetrics` yöneticinin alt ağacını sayar; bu yol yalnız kişinin
 * kendi faaliyetlerini ve kendi işlerini kullanır.
 */
export async function personalDashboardMetrics(
  db: MetricsDb,
  viewer: Viewer,
  period: FeedFilters["period"],
  now: Date,
): Promise<DashboardMetrics> {
  const [scope, takvimAyari, esik] = await Promise.all([
    visibleActivityWhere(db, viewer, []),
    readWorkCalendar(db),
    readNumericSetting(db, SETTING_KEYS.followUpStaleBusinessDays),
  ]);

  const baslangic = periodStart(period, now);
  const ownPeriod: Prisma.ActivityWhereInput = {
    AND: [
      scope,
      { authorId: viewer.id },
      // İptal ve ret sayıya girmez (§5.4, karar 03.09.2026); tanım tek yerde.
      countableActivityWhere(),
      ...(baslangic ? [{ activityDate: { gte: baslangic } }] : []),
    ],
  };
  const ownScope: Prisma.ActivityWhereInput = {
    AND: [scope, { authorId: viewer.id }],
  };

  const [activities, correctionRequested, pendingApproval, openQuestions, followUps, contributors] =
    await Promise.all([
      countVisibleActivities(db, viewer, ownPeriod),
      countVisibleActivities(db, viewer, {
        AND: [{ authorId: viewer.id }, { approvalStatus: "CHANGES_REQUESTED" }],
      }),
      countVisibleActivities(db, viewer, {
        AND: [{ authorId: viewer.id }, { approvalStatus: "PENDING_APPROVAL" }],
      }),
      countVisibleActivities(db, viewer, {
        AND: [{ authorId: viewer.id }, openQuestionActivityWhere(viewer.id)],
      }),
      db.followUpItem.findMany({
        where: { status: "OPEN", activity: ownScope },
        select: { lastMovedAt: true },
      }),
      listVisibleActivities(db, viewer, {
        where: ownPeriod,
        select: { authorId: true },
        distinct: ["authorId"],
      }),
    ]);

  return {
    activities,
    contributors: contributors.length,
    pendingApproval,
    correctionRequested,
    openQuestions,
    openFollowUps: followUps.length,
    staleFollowUps: await hareketsizSayisi(
      db,
      followUps,
      takvimAyari,
      esik,
      now,
    ),
    staleThreshold: esik,
    pendingAbsence: null,
    newFeedback: null,
  };
}

export async function dashboardMetrics(
  db: MetricsDb,
  viewer: Viewer,
  subordinates: string[],
  period: FeedFilters["period"],
  now: Date,
  options: DashboardMetricsOptions = {},
): Promise<DashboardMetrics> {
  const [scope, takvimAyari, esik, pendingAbsence, newFeedback] = await Promise.all([
    visibleActivityWhere(db, viewer, subordinates),
    readWorkCalendar(db),
    readNumericSetting(db, SETTING_KEYS.followUpStaleBusinessDays),
    options.canManageAbsences
      ? countPendingManagedAbsences(db, viewer.id, now)
      : Promise.resolve(null),
    options.canManageFeedback
      ? countManageableFeedback(db, viewer.id)
      : Promise.resolve(null),
  ]);

  const baslangic = periodStart(period, now);
  // Bu fonksiyon dashboard'un "Yönettiğim alan" bölümünü besler. Görünürlük
  // kuralı yöneticinin kendi kayıtlarını da doğal olarak açar; yönetilen alan
  // sayacında kendi kaydı görünmesin diye burada ast yazarlarla ayrıca
  // sınırlarız.
  const managedScope: Prisma.ActivityWhereInput = {
    AND: [scope, { authorId: { in: subordinates } }],
  };
  const managedAuthors: Prisma.ActivityWhereInput = {
    authorId: { in: subordinates },
  };
  const donemli: Prisma.ActivityWhereInput = {
    AND: [
      managedScope,
      countableActivityWhere(),
      ...(baslangic ? [{ activityDate: { gte: baslangic } }] : []),
    ],
  };

  const [activities, pendingApproval, correctionRequested, openQuestions, acikMaddeler, yazarlar] =
    await Promise.all([
      countVisibleActivities(db, viewer, donemli, subordinates),
      countVisibleActivities(
        db,
        viewer,
        { AND: [managedAuthors, { approvalStatus: "PENDING_APPROVAL" }] },
        subordinates,
      ),
      countVisibleActivities(
        db,
        viewer,
        { AND: [managedAuthors, { approvalStatus: "CHANGES_REQUESTED" }] },
        subordinates,
      ),
      countVisibleActivities(
        db,
        viewer,
        {
          AND: [managedAuthors, openQuestionActivityWhere(viewer.id)],
        },
        subordinates,
      ),
      db.followUpItem.findMany({
        where: { status: "OPEN", activity: managedScope },
        select: { lastMovedAt: true },
      }),
      listVisibleActivities(db, viewer, {
        where: donemli,
        select: { authorId: true },
        distinct: ["authorId"],
      }, subordinates),
    ]);

  return {
    activities,
    contributors: yazarlar.length,
    pendingApproval,
    correctionRequested,
    openQuestions,
    openFollowUps: acikMaddeler.length,
    staleFollowUps: await hareketsizSayisi(db, acikMaddeler, takvimAyari, esik, now),
    staleThreshold: esik,
    pendingAbsence,
    newFeedback,
  };
}

/** Yalnızca o anda kararı bu kullanıcı verebiliyorsa izinleri sayar. */
async function countPendingManagedAbsences(
  db: MetricsDb,
  managerId: string,
  now: Date,
): Promise<number> {
  const employeeIds = await managedAbsenceEmployeeIds(db, managerId, now);
  if (employeeIds.length === 0) return 0;

  return db.noActivityPeriod.count({
    where: {
      userId: { in: employeeIds },
      status: "PENDING",
      cancelledAt: null,
    },
  });
}

/**
 * Hareketsizlik **iş günüyle** ölçülür: hafta sonu ve resmî tatil sayılmaz.
 * Bu yüzden veritabanında tarih çıkarmasıyla hesaplanamaz; takvim yüklenip
 * her madde oradan geçirilir — takip listesindeki hesabın aynısı.
 */
async function hareketsizSayisi(
  db: MetricsDb,
  maddeler: { lastMovedAt: Date }[],
  takvimAyari: { workingDays: number[] },
  esik: number,
  now: Date,
): Promise<number> {
  if (maddeler.length === 0) return 0;

  const enEski = maddeler.reduce(
    (min, madde) => (madde.lastMovedAt < min ? madde.lastMovedAt : min),
    maddeler[0].lastMovedAt,
  );
  const takvim = await loadWorkCalendar(db, enEski, now);
  const secenekler = {
    workingDays: takvimAyari.workingDays,
    holidays: takvim.holidays,
  };

  return maddeler.filter(
    (madde) => businessDaysBetween(madde.lastMovedAt, now, secenekler) >= esik,
  ).length;
}
