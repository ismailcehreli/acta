import type { Prisma, PrismaClient } from "@prisma/client";

import {
  countVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import type { Viewer } from "@/server/authz/visibility";

// Okunmamış sayısı (ister belgesi §2.3.4: "okunmayan faaliyet sayısı yazar ve
// okudukça azalır").
//
// **Sayı görünürlük modülünden geçer.** Göremediği bir kaydı sayan bir rozet,
// kaydın varlığını ele verirdi — sayı da bir bilgidir (§18.4).
//
// Kendi yazdıkları sayılmaz: insan kendi yazdığını "okumamış" olmaz. Zaten
// okundu ölçümü de yazarın kendi okumasını kaydetmiyor (§10.2 istisnası).
//
// İptal veya reddedilmiş kayıt sayılmaz: kapanmış ve okunacak bir iş değil.

export type UnreadDb = Pick<
  PrismaClient,
  | "activityApprover"
  | "noActivityPeriod"
  | "user"
  | "orgUnit"
  | "$queryRaw"
> & ActivityRepositoryDb;

/** Okunmamış sayacı ile dikkat kuyruğunun ortak daraltma koşulları. */
export function unreadActivityConditions(
  viewerId: string,
): Prisma.ActivityWhereInput[] {
  return [
    { authorId: { not: viewerId } },
    // İptal ve ret okunacak haber değildir; ikisi de kapanmış kayıt.
    { approvalStatus: { notIn: ["CANCELLED", "REJECTED"] } },
    { readReceipts: { none: { userId: viewerId } } },
  ];
}

export async function countUnreadInScope(
  db: UnreadDb,
  viewer: Viewer,
  /** Önceden hesaplanmış astlar; aynı istekte tekrar sorgulanmasın diye. */
  precomputedSubordinates?: string[],
): Promise<number> {
  return countVisibleActivities(
    db,
    viewer,
    {
      AND: unreadActivityConditions(viewer.id),
    },
    precomputedSubordinates,
  );
}
