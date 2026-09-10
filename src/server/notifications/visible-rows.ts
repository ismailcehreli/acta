import type { PrismaClient } from "@prisma/client";

import { listVisibleActivities } from "@/server/authz/activity-repository";
import type { VisibilityDb } from "@/server/authz/visibility";

// Bildirimin görünürlük süzgeci (denetim 21.08.2026, bulgu 3).
//
// Bildirim, olduğu anda doğru olan bir haberdir — ama **okunduğu ya da
// gönderildiği** anda hâlâ doğru olmayabilir. Kişi başka bir dala taşınmış,
// vekâleti bitmiş ya da kararı başkası vermiş olabilir. O andan sonra
// kaydın başlığını göstermek ya da e-postayla yollamak, görünürlük
// kurallarının dışına çıkan bir okuma yoludur (§8, §18.4).
//
// Kural: faaliyete bağlı bildirim, ancak faaliyet **şu anda** görünüyorsa
// gösterilir/gönderilir. Faaliyete bağlı olmayanlar (parola sıfırlama, hesap
// açılışı, iş gecikmesi) her zaman geçer — onların görünürlük sorusu yok.

export type VisibleRowsDb = Pick<PrismaClient, "activity"> & VisibilityDb;

/**
 * Bu kişinin **şu anda** görebildiği faaliyetlere ait kimlikler.
 *
 * Boş küme dönerse hiçbiri görünmüyor demektir. Çağıran, faaliyete bağlı
 * olmayan satırları ayrıca geçirir.
 */
export async function gorunurFaaliyetler(
  db: VisibleRowsDb,
  viewer: { id: string; isSystemAdmin: boolean },
  activityIds: string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  const benzersiz = [...new Set(activityIds)];
  if (benzersiz.length === 0) return new Set();

  const satirlar = await listVisibleActivities(db, viewer, {
    where: { id: { in: benzersiz } },
    select: { id: true },
  }, undefined, now);

  return new Set(satirlar.map((satir) => satir.id));
}

/**
 * Kuyruk satırlarını görünürlüğe göre ikiye ayırır.
 *
 * `gecenler` gösterilebilir/gönderilebilir olanlar; `dusenler` alıcının artık
 * göremediği faaliyete bağlı olanlar.
 */
export async function gorunurlugeGoreAyir<T extends { activityId: string | null }>(
  db: VisibleRowsDb,
  viewer: { id: string; isSystemAdmin: boolean },
  rows: T[],
  now: Date = new Date(),
): Promise<{ gecenler: T[]; dusenler: T[] }> {
  const kimlikler = rows
    .map((row) => row.activityId)
    .filter((id): id is string => id !== null);

  if (kimlikler.length === 0) return { gecenler: rows, dusenler: [] };

  const gorunur = await gorunurFaaliyetler(db, viewer, kimlikler, now);

  const gecenler: T[] = [];
  const dusenler: T[] = [];

  for (const row of rows) {
    if (row.activityId === null || gorunur.has(row.activityId)) gecenler.push(row);
    else dusenler.push(row);
  }

  return { gecenler, dusenler };
}
