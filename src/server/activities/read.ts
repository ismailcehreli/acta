import type { Prisma, PrismaClient } from "@prisma/client";

import { openQuestionActivityWhere } from "@/server/activities/open-questions";
import {
  countVisibleActivities,
  findVisibleActivity,
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  visibleActivityWhere,
  type Viewer,
} from "@/server/authz/visibility";
import { periodStart, type FeedFilters } from "@/server/activities/scope-feed";
import {
  evaluateActivityEditPermission,
} from "@/server/activities/edit-permission";
import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";

// Faaliyet okuma. **Her okuma yolu görünürlük modülünden geçer** (§8.4):
// "Faaliyetlerim" ekranı yalnızca kişinin kendi kayıtlarını gösterse bile
// sorgu, kapsam filtresiyle birleştirilir. Böylece buradaki bir düzenleme
// hatası kapsam dışına taşamaz — filtre daraltır, genişletemez.

export type ActivityReadDb = ActivityRepositoryDb &
  Pick<PrismaClient, "systemSetting" | "readReceipt">;

export interface ActivityListItem {
  id: string;
  /** İnsan okur sıra numarası (§3.1). */
  activityNo: number;
  activityDate: Date;
  title: string;
  approvalStatus: string;
  currentRevisionNo: number;
  /** Kaydın yazıldığı an; faaliyetin gününden ayrıdır (Görev 11.1). */
  createdAt: Date;
  /** Son değişiklik anı; düzeltme satırı buradan yazılır. */
  updatedAt: Date;
  targetDepartmentNames: string[];
  /** İptal edilmişse gerekçesi; kayıt silinmediği için görünür kalır (§5.5). */
  cancellationReason: string | null;
  /** Liste düğmesinin sunucu tarafındaki güncel düzenleme kararı. */
  canEdit: boolean;
}

/**
 * "Faaliyetlerim" ekranının daraltmaları (Görev 11.3).
 *
 * Kapsam akışındakilerle **aynı adları** taşırlar: kullanıcı iki ekranda iki
 * ayrı süzgeç dili öğrenmek zorunda kalmasın. Yazan kişi süzgeci burada yok —
 * liste zaten tek kişinin.
 */
export interface OwnActivityFilters {
  period?: FeedFilters["period"];
  /** Dönem hesabı için şimdiki an; testlerde sahte saat verilir. */
  now: Date;
  status?: FeedFilters["status"];
  /** Kullanıcının kendi sormadığı açık sorusu olan kendi kayıtları. */
  openQuestions?: boolean;
  /** Muhatap gösterilen departman. Erişim vermez, yalnız süzer (§8.3). */
  targetOrgUnitId?: string;
}

/**
 * Süzgeçlerden doğan daraltma koşulları.
 *
 * Liste ve sayaç aynı listeyi kullanır; ayrı yazılsalardı biri değiştiğinde
 * diğeri sessizce geride kalır ve sayaç listeyle çelişirdi. Görünürlük ve
 * "yalnız kendi kayıtları" koşulu buraya **girmez** — onlar her zaman ayrıca
 * ve önce eklenir.
 */
function ownFilterConditions(
  filters: OwnActivityFilters,
  viewerId: string,
): Prisma.ActivityWhereInput[] {
  const conditions: Prisma.ActivityWhereInput[] = [];

  const start = periodStart(filters.period, filters.now);
  if (start) conditions.push({ activityDate: { gte: start } });
  if (filters.status) conditions.push({ approvalStatus: filters.status });
  if (filters.openQuestions) {
    conditions.push(openQuestionActivityWhere(viewerId));
  }
  if (filters.targetOrgUnitId) {
    conditions.push({
      targetDepts: { some: { orgUnitId: filters.targetOrgUnitId } },
    });
  }

  return conditions;
}

/**
 * Kişinin kendi kayıtları, sayfalı.
 *
 * Sayfalama **offset ile**: kendi arşivi canlı bir akış değil, kişinin
 * geçmişi. Araya yeni kayıt yalnız kişinin kendisi yazdığında girer ve o an
 * zaten bu ekranda değildir; numaralı sayfa burada güvenli ve kullanıcı
 * "3. sayfa"ya doğrudan gidebilir. Kapsam akışında ise durum tersi — orada
 * imleç kullanılıyor, sebebi `/feed` sayfasında yazılı.
 */
export async function listOwnActivities(
  db: ActivityReadDb,
  viewer: Viewer,
  filters: OwnActivityFilters,
  options: { limit?: number; skip?: number } = {},
): Promise<ActivityListItem[]> {
  const { limit = 50, skip = 0 } = options;
  const scope = await visibleActivityWhere(db, viewer);

  const rows = await listVisibleActivities(db, viewer, {
    where: {
      AND: [
        { authorId: viewer.id },
        scope,
        ...ownFilterConditions(filters, viewer.id),
      ],
    },
    orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
    skip,
    take: limit,
    select: {
      id: true,
      activityNo: true,
      activityDate: true,
      title: true,
      approvalStatus: true,
      currentRevisionNo: true,
      createdAt: true,
      updatedAt: true,
      targetDepts: { select: { orgUnit: { select: { name: true } } } },
      cancellation: { select: { reason: true } },
      readReceipts: {
        where: { userId: { not: viewer.id } },
        select: { activityId: true },
        take: 1,
      },
    },
  });

  const windowMinutes = await readNumericSetting(
    db,
    SETTING_KEYS.editWindowMinutes,
  );

  return rows.map(({ targetDepts, cancellation, readReceipts, ...activity }) => {
    const permission = evaluateActivityEditPermission(
      activity,
      filters.now,
      windowMinutes,
      readReceipts.length > 0,
    );

    return {
      ...activity,
      targetDepartmentNames: targetDepts.map((target) => target.orgUnit.name),
      cancellationReason: cancellation?.reason ?? null,
      canEdit: permission.allowed,
    };
  });
}

/** Kişinin toplam kayıt sayısı; sayfalama başlığı ve sayfa sayısı için. */
export async function countOwnActivities(
  db: ActivityReadDb,
  viewer: Viewer,
  filters: OwnActivityFilters,
): Promise<number> {
  return countVisibleActivities(db, viewer, {
    AND: [{ authorId: viewer.id }, ...ownFilterConditions(filters, viewer.id)],
  });
}

/** Düzenleme ekranı için kendi faaliyetini getirir; başkasınınkini getirmez. */
export async function findOwnActivity(
  db: ActivityReadDb,
  viewer: Viewer,
  activityId: string,
) {
  const scope = await visibleActivityWhere(db, viewer);

  return findVisibleActivity(db, viewer, {
    where: { AND: [{ id: activityId, authorId: viewer.id }, scope] },
    select: {
      id: true,
      activityNo: true,
      activityDate: true,
      title: true,
      description: true,
      createdAt: true,
      approvalStatus: true,
      targetDepts: { select: { orgUnitId: true } },
      attachments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, originalName: true, sizeBytes: true },
      },
    },
  });
}
