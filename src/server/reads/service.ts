import type { PrismaClient } from "@prisma/client";

import { appSecret } from "@/server/auth/config";
import {
  findVisibleActivity,
  lockActivityForMaintenance,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";
import { READ_DWELL_MS } from "@/shared/reads";

import { verifyReadTicket } from "./ticket";

export { READ_DWELL_MS } from "@/shared/reads";

// Okundu bilgisi (§10).
//
// İki ayrı ihtiyaca hizmet eder (§10.1): yazan kişi "boşluğa mı yazıyorum?"
// diye sorar, yönetici "hangilerine baktım?" diye. İkincisi bir durum alanı
// değil, kişisel görünümdür.
//
// Toplama **otomatiktir**; manuel "okudum" butonu yoktur (İlke 4). Saklanan
// veri kullanıcı başına yalnız ilk ve son okumadır; ara okumalar tutulmaz.
// Bu bir kolaylık göstergesidir, adli nitelikte kayıt değildir (§10.3) —
// denetim izinin tam kayıt tuttuğu işlemler §15.2'de sayılıdır.

/**
 * "Okundu" ne demektir (§10.2): faaliyetin **detay görünümü** açıldığında ve
 * sistem ayarındaki süre kadar ekranda kaldığında. Liste içinde kaydırmak okundu saymaz;
 * bildirim önizlemesi de saymaz.
 */
export function countsAsRead(dwellMs: number, requiredMs = READ_DWELL_MS): boolean {
  return dwellMs >= requiredMs;
}

export type ReadsDb = Pick<
  PrismaClient,
  "readReceipt" | "$executeRaw" | "$transaction" | "systemSetting"
> & ActivityRepositoryDb;

export type MarkReadResult =
  | { ok: true; recorded: boolean }
  | { ok: false; reason: "not_visible" | "too_short" | "invalid_ticket" };

/**
 * Okuma kaydının tek giriş noktası. Süreyi bilet belirler; istemcinin beyanı
 * hiçbir yerde kullanılmaz (denetim 18.08.2026, FAZ 4 bulgu 8).
 */
export async function recordReadFromTicket(
  db: ReadsDb,
  viewer: { id: string; isSystemAdmin: boolean },
  activityId: string,
  ticket: string,
  now: Date,
  secret: string = appSecret(),
): Promise<MarkReadResult> {
  const verified = verifyReadTicket(ticket, activityId, viewer.id, now, secret);
  if (!verified.ok) return { ok: false, reason: "invalid_ticket" };

  return markActivityAsRead(db, viewer, activityId, verified.dwellMs, now);
}

export async function markActivityAsRead(
  db: ReadsDb,
  viewer: { id: string; isSystemAdmin: boolean },
  activityId: string,
  dwellMs: number,
  now: Date,
): Promise<MarkReadResult> {
  const gerekenSaniye = await readNumericSetting(db, SETTING_KEYS.readDwellSeconds);
  if (!countsAsRead(dwellMs, gerekenSaniye * 1_000)) {
    return { ok: false, reason: "too_short" };
  }

  return db.$transaction(async (tx) => {
    // Okuma ve düzenleme aynı faaliyet satırı kilidinde buluşur. Bu kilit
    // alınmadan yazmak, onaylayıcı okurken yazarın son anda içeriği
    // değiştirmesine izin verirdi.
    await lockActivityForMaintenance(tx, activityId);

    const activity = await findVisibleActivity(tx, viewer, {
      where: { id: activityId },
      select: { id: true, authorId: true, approvalStatus: true },
    });

    // Görülemeyen kayıt okunmuş sayılamaz; her okuma yolu görünürlükten geçer.
    if (!activity) return { ok: false, reason: "not_visible" };

    // Yazarın kendi kaydını açması okuma sayılmaz: "okundu" bilgisi yazana
    // başkasının baktığını gösterir. Kendi okuması, düzeltme penceresini de
    // kapatmamalıdır (§5.5, Görev 3.1).
    if (activity.authorId === viewer.id) return { ok: true, recorded: false };

    // Tek ifadelik atomik yazım. Prisma'nın `upsert` çağrısı okuma ile yazma
    // arasında açık bırakıyordu: aynı anda gelen iki okumada ilk okuma zamanı
    // ileri kayabiliyor, son okuma geri gidebiliyordu (denetim FAZ 4,
    // bulgu 10). `LEAST`/`GREATEST` değişmezi veritabanında korur.
    await tx.$executeRaw`
      INSERT INTO "ReadReceipt" ("activityId", "userId", "firstReadAt", "lastReadAt")
      VALUES (${activityId}, ${viewer.id}, ${now}, ${now})
      ON CONFLICT ("activityId", "userId") DO UPDATE
      SET "firstReadAt" = LEAST("ReadReceipt"."firstReadAt", EXCLUDED."firstReadAt"),
          "lastReadAt"  = GREATEST("ReadReceipt"."lastReadAt", EXCLUDED."lastReadAt")
    `;

    return { ok: true, recorded: true };
  });
}

export interface ReaderView {
  userId: string;
  fullName: string;
  firstReadAt: Date;
  lastReadAt: Date;
}

/**
 * Okuma bilgisini kim görür (§10.3): **yazan ve okuyanın kendisi.** Yönetici,
 * ekibinin ne okuduğunu göremez — bu bilinçli bir karardır, gözetim aracı
 * değildir. Tasarımın v2'sindeki "YK Başkanı istisnası" v3'te kaldırıldı ve
 * burada da yoktur.
 */
export async function listActivityReaders(
  db: ReadsDb,
  viewer: { id: string; isSystemAdmin: boolean },
  activityId: string,
): Promise<ReaderView[]> {
  const activity = await findVisibleActivity(db, viewer, {
    where: { id: activityId },
    select: { id: true, authorId: true, approvalStatus: true },
  });

  if (!activity) return [];

  const isAuthor = activity.authorId === viewer.id;

  const rows = await db.readReceipt.findMany({
    // Yazan bütün okuyucuları görür; diğerleri yalnız kendi kaydını.
    where: isAuthor ? { activityId } : { activityId, userId: viewer.id },
    orderBy: { firstReadAt: "asc" },
    select: {
      userId: true,
      firstReadAt: true,
      lastReadAt: true,
      user: { select: { fullName: true } },
    },
  });

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.user.fullName,
    firstReadAt: row.firstReadAt,
    lastReadAt: row.lastReadAt,
  }));
}
