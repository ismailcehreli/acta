import type { Prisma, PrismaClient } from "@prisma/client";

import { listAuthorizedActivities } from "@/server/authz/activity-repository";
import { approvalQueueWhere } from "@/server/authz/visibility";

import { companyDay } from "@/server/activities/date-rules";
import { periodStart, type FeedFilters } from "@/server/activities/scope-feed";

import { approveActivity, type ApprovalDb } from "./approval";

// Kişi + gün bazlı toplu onay (Görev 10.6, tasarım §6).
//
// Müdür günde 5–12 faaliyet için tek tek sayfa açıp geri dönüyordu. Tasarım
// onayı zaten kişi ve gün bazında gruplu gösteriyor; eksik olan ekrandı.
//
// **Toplu onay yeni bir yetki yolu açmaz.** Her kayıt tek tek `approveActivity`
// üzerinden geçiyor: aynı kilit protokolü, aynı denetim izi, aynı bildirim.
// Toplu bir `updateMany` yazmak, onayın bütün kurallarını ikinci kez —ve
// eksik— yazmak olurdu.

export type ApprovalGroupsDb = ApprovalDb;

export interface GroupedActivity {
  id: string;
  activityNo: number;
  title: string;
  description: string;
  targetDepartmentNames: string[];
}

export interface ApprovalGroup {
  authorId: string;
  authorName: string;
  authorUnitName: string;
  /** Şirket günü (`YYYY-MM-DD`). */
  day: string;
  activityDate: Date;
  items: GroupedActivity[];
}

/**
 * Onay kuyruğunun daraltmaları (Görev 11.3).
 *
 * Müdür "Kadir'in bu haftaki kayıtları" ya da "Planlama'dan gelenler" diye
 * bakabilmeli. Alanlar kuyruk koşulunun **üstüne** eklenir; hiçbiri başka
 * bir müdürün kuyruğunu açamaz.
 */
export interface ApprovalGroupFilters {
  period?: FeedFilters["period"];
  authorId?: string;
  /** Yazarın kendi birimi; kayıt hangi birimde yazıldıysa o (§4.6). */
  authorOrgUnitId?: string;
}

/** Süzgeç koşulları; kuyruk koşulu buraya girmez, o her zaman ayrıca eklenir. */
function approvalFilterWhere(
  filters: ApprovalGroupFilters,
  now: Date,
): Prisma.ActivityWhereInput[] {
  const kosullar: Prisma.ActivityWhereInput[] = [];
  const start = periodStart(filters.period, now);

  if (start) kosullar.push({ activityDate: { gte: start } });
  if (filters.authorId) kosullar.push({ authorId: filters.authorId });
  if (filters.authorOrgUnitId) {
    kosullar.push({ authorOrgUnitId: filters.authorOrgUnitId });
  }

  return kosullar;
}

/**
 * Onayı bekleyen kayıtları kişi ve güne göre gruplar.
 *
 * Sıralama en eski günden başlar: en uzun bekleyen iş en üstte olmalı.
 *
 * **Sayfalama grup bazındadır ve bellekte yapılır.** Satırları veritabanında
 * sayfalamak grupları ortadan bölerdi: müdür aynı kişinin aynı gününü iki
 * sayfada görür, "hepsini onayla" düğmesi grubun yarısına basardı. Kuyruk
 * bir müdürün önündeki iştir ve küçüktür (tasarım §6: günde 5–12 kayıt);
 * satırların tamamını okumak burada doğru takas.
 */
export async function listApprovalGroups(
  db: Pick<PrismaClient, "activity" | "noActivityPeriod">,
  approverId: string,
  now: Date = new Date(),
  filters: ApprovalGroupFilters = {},
  options: { limit?: number; skip?: number } = {},
): Promise<ApprovalGroup[]> {
  const gruplar = await gruplaKuyruk(db, approverId, now, filters);
  const { limit, skip = 0 } = options;

  return limit === undefined ? gruplar : gruplar.slice(skip, skip + limit);
}

/** Süzgeçli kuyruktaki **grup** sayısı; sayfa sayısı buradan çıkar. */
export async function countApprovalGroups(
  db: Pick<PrismaClient, "activity" | "noActivityPeriod">,
  approverId: string,
  now: Date = new Date(),
  filters: ApprovalGroupFilters = {},
): Promise<number> {
  return (await gruplaKuyruk(db, approverId, now, filters)).length;
}

async function gruplaKuyruk(
  db: Pick<PrismaClient, "activity" | "noActivityPeriod">,
  approverId: string,
  now: Date,
  filters: ApprovalGroupFilters,
): Promise<ApprovalGroup[]> {
  const rows = await listAuthorizedActivities(db, approvalQueueWhere(approverId, now), {
    // Kuyruk koşulu görünürlük modülünden gelir; `listPendingApprovals` ile
    // **aynı** işlevi paylaşırlar. Daha önce ikisi ayrı ayrı yazılmıştı ve
    // yalnız biri güncellendiğinde gezinmedeki rozet sayıyı gösterip onay
    // ekranı boş geliyordu. Şimdi ayrışmaları imkânsız.
    // Koşullar `AND` ile birleşiyor: nesne yaymada aynı alan iki kez
    // verilirse sonuncusu kazanır ve bir süzgeç kuyruk koşulunu sessizce
    // ezebilirdi (Görev 11.4'te ekip izin listesinde bu hata bulundu).
    where: {
      AND: [{ approvalStatus: "PENDING_APPROVAL" }, ...approvalFilterWhere(filters, now)],
    },
    orderBy: [{ activityDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      activityNo: true,
      title: true,
      description: true,
      activityDate: true,
      authorId: true,
      author: { select: { fullName: true } },
      authorOrgUnit: { select: { name: true } },
      targetDepts: { select: { orgUnit: { select: { name: true } } } },
    },
  });

  const gruplar = new Map<string, ApprovalGroup>();

  for (const row of rows) {
    const day = companyDay(row.activityDate);
    const anahtar = `${row.authorId}:${day}`;

    let grup = gruplar.get(anahtar);
    if (!grup) {
      grup = {
        authorId: row.authorId,
        authorName: row.author.fullName,
        authorUnitName: row.authorOrgUnit.name,
        day,
        activityDate: row.activityDate,
        items: [],
      };
      gruplar.set(anahtar, grup);
    }

    grup.items.push({
      id: row.id,
      activityNo: row.activityNo,
      title: row.title,
      description: row.description,
      targetDepartmentNames: row.targetDepts.map((hedef) => hedef.orgUnit.name),
    });
  }

  return [...gruplar.values()];
}

export interface BulkApprovalResult {
  approved: number;
  /** Onaylanamayanlar; sayı değil **kimlik** döner ki ekranda söylenebilsin. */
  skipped: { id: string; message: string }[];
}

/**
 * Verilen kayıtları onaylar.
 *
 * **Kimlikler ekrandan gelir, sorgudan değil.** Müdür ekranı açtıktan sonra
 * yeni bir faaliyet gelirse, "hepsini onayla" onu da kapsasaydı müdür
 * **okumadığı bir kaydı** onaylamış olurdu. Bu yüzden gönderilen liste neyse
 * o işlenir; arada gelen kayıt bir sonraki turda görünür.
 *
 * Onayı düşmeyen ya da durumu değişmiş kayıtlar sessizce atlanmaz; sayısı ve
 * sebebi çağırana döner.
 */
export async function approveMany(
  db: ApprovalGroupsDb,
  actorId: string,
  activityIds: string[],
  now: Date,
): Promise<BulkApprovalResult> {
  const sonuc: BulkApprovalResult = { approved: 0, skipped: [] };

  for (const id of activityIds) {
    const karar = await approveActivity(db, actorId, id, now);
    if (karar.ok) sonuc.approved += 1;
    else sonuc.skipped.push({ id, message: karar.message });
  }

  return sonuc;
}
