import type { PrismaClient } from "@prisma/client";

import { listPendingApprovals } from "@/server/activities/approval";
import { listVisibleActivities } from "@/server/authz/activity-repository";
import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import {
  listOpenWorkItems,
  type ConversationReadDb,
} from "@/server/conversations/read";
import type { Viewer } from "@/server/authz/visibility";

// Tek iş kuyruğu (Görev 10.5).
//
// Kullanıcı açısından "cevap bekleyen soru" ile "onayımı bekleyen kayıt" aynı
// sorunun cevabıdır: **şimdi ne yapmalıyım?** İki ayrı kutuda durdukları sürece
// kişi ikisini de gözden geçirmek zorundaydı ve hangisinin daha çok beklediğini
// göremiyordu.
//
// Kuyruk **yeni bir yetki kaynağı değil**: her kalem kendi mevcut yolundan
// geliyor. Sorular `listOpenWorkItems` üzerinden (o da görünürlükle daraltıyor),
// onaylar aktif onaylayıcı sütunundan, düzeltmeler kişinin kendi kayıtlarından.
// Burada ikinci bir kural yazmak, iki kuralın ayrışması demekti.

export type WorkQueueDb = ConversationReadDb &
  Pick<PrismaClient, "workCalendar" | "holiday">;

export type WorkKind = "answer" | "approve" | "revise";

export interface WorkItem {
  kind: WorkKind;
  activityId: string;
  activityTitle: string;
  /** İşi önüme kim getirdi. */
  fromName: string;
  /** İş bu kişinin önüne ne zaman düştü. */
  since: Date;
  /** Kaç **iş günüdür** bekliyor; bugün düştüyse sıfır. */
  waitingBusinessDays: number;
}

/** İzlenenler: sıra bende değil, ama takip ediyorum. */
export interface WatchedItem {
  activityId: string;
  activityTitle: string;
  counterpartName: string;
  since: Date;
  waitingBusinessDays: number;
}

export interface WorkQueue {
  items: WorkItem[];
  watched: WatchedItem[];
}

const ETIKET: Record<WorkKind, string> = {
  answer: "Cevapla",
  approve: "Onayla",
  revise: "Düzelt",
};

export function workKindLabel(kind: WorkKind): string {
  return ETIKET[kind];
}

export async function listWorkQueue(
  db: WorkQueueDb,
  viewer: Viewer,
  now: Date,
): Promise<WorkQueue> {
  const [ayarlar, konusmalar, onaylar, duzeltmeler] = await Promise.all([
    readWorkCalendar(db),
    listOpenWorkItems(db, viewer),
    // Vekâlet süresince, vekâlet edilenin onay kuyruğu vekilin iş
    // kuyruğunda da görünür — `listPendingApprovals` bunu kendi içinde
    // çözüyor, buraya `now` geçmek yeterli.
    listPendingApprovals(db, viewer.id, now),
    // Düzeltme istenmiş kendi kayıtlarım. Bunlar bugüne kadar hiçbir listede
    // yoktu: müdür "şunu düzelt" diyordu ve talep yalnız faaliyet sayfasında
    // duruyordu. Kişi ana ekranına baktığında yapacak işi olduğunu görmüyordu.
    listVisibleActivities(db, viewer, {
      where: { authorId: viewer.id, approvalStatus: "CHANGES_REQUESTED" },
      orderBy: { approvalDecidedAt: "asc" },
      select: {
        id: true,
        title: true,
        approvalDecidedAt: true,
        approver: { select: { fullName: true } },
      },
    }),
  ]);

  // Tatiller yalnız gereken aralık için okunur; en eski işten bugüne.
  const enEski = [
    ...konusmalar.map((k) => k.openedAt),
    ...onaylar.map((o) => o.activityDate),
    ...duzeltmeler.map((d) => d.approvalDecidedAt ?? now),
  ].reduce((min, tarih) => (tarih < min ? tarih : min), now);

  const takvim = await loadWorkCalendar(db, enEski, now);

  const gunSecenekleri = {
    workingDays: ayarlar.workingDays,
    holidays: takvim.holidays,
  };

  const bekleme = (since: Date) =>
    businessDaysBetween(since, now, gunSecenekleri);

  const items: WorkItem[] = [
    ...konusmalar
      .filter((konusma) => konusma.waitingOnMe)
      .map((konusma) => ({
        kind: "answer" as const,
        activityId: konusma.activityId,
        activityTitle: konusma.activityTitle,
        fromName: konusma.counterpartName,
        since: konusma.openedAt,
        waitingBusinessDays: bekleme(konusma.openedAt),
      })),

    ...onaylar.map((onay) => ({
      kind: "approve" as const,
      activityId: onay.id,
      activityTitle: onay.title,
      fromName: onay.authorName,
      since: onay.activityDate,
      waitingBusinessDays: bekleme(onay.activityDate),
    })),

    ...duzeltmeler.map((kayit) => ({
      kind: "revise" as const,
      activityId: kayit.id,
      activityTitle: kayit.title,
      fromName: kayit.approver?.fullName ?? "Yöneticiniz",
      // Karar anı yoksa (eski kayıt) bekleme sıfır sayılır; uydurma bir tarih
      // koymak listeyi yanlış sıralardı.
      since: kayit.approvalDecidedAt ?? now,
      waitingBusinessDays: kayit.approvalDecidedAt
        ? bekleme(kayit.approvalDecidedAt)
        : 0,
    })),
  ];

  // **En çok bekleyen en üstte.** Tür sırasına göre dizmek, üç gündür bekleyen
  // bir soruyu bugün gelen bir onayın altına düşürürdü.
  items.sort((a, b) => a.since.getTime() - b.since.getTime());

  const watched: WatchedItem[] = konusmalar
    .filter((konusma) => !konusma.waitingOnMe)
    .map((konusma) => ({
      activityId: konusma.activityId,
      activityTitle: konusma.activityTitle,
      counterpartName: konusma.counterpartName,
      since: konusma.openedAt,
      waitingBusinessDays: bekleme(konusma.openedAt),
    }))
    .sort((a, b) => a.since.getTime() - b.since.getTime());

  return { items, watched };
}
