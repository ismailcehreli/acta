import type { Prisma, PrismaClient } from "@prisma/client";

import {
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import { visibleActivityWhere, type VisibilityDb } from "@/server/authz/visibility";

import { renderLine } from "./templates";
import { formatInstantShort } from "@/shared/format/date-time";

// Uygulama içi bildirim kutusu (Görev 10.4).
//
// **Kaynak yeni bir tablo değil.** Bildirim kuyruğu zaten "bu kişiye şunu
// haber verdik" kaydını tutuyor ve alıcıları iş kuralları belirliyor (yazan,
// onaylayıcı, konuşmanın tarafları). Zil kutusu bunu okur.
//
// **Neden yalnız `EMAIL` satırı:** bir olay için iki kuyruk kaydı yazılabiliyor
// (e-posta ve push). İkisini de listelemek aynı haberi zilde iki kez göstermek
// olurdu. `EMAIL` satırı **her olayda koşulsuz** yazılıyor; push ise yalnız
// aboneliği olana ve titretmeye değer olaylarda. Bu yüzden kanonik satır
// `EMAIL`. Bu değişmez, testle sabitlendi (`enqueue` her çağrıda bir e-posta
// satırı yazar).
//
// Görülme, gönderimden bağımsızdır: e-posta hiç gitmemiş olabilir ama kişi
// ekranda görmüş olabilir.

export type InboxDb = Pick<PrismaClient, "notificationQueue"> &
  ActivityRepositoryDb & VisibilityDb;

/**
 * Kutunun görünürlük koşulu (denetim 21.08.2026, bulgu 3).
 *
 * Bildirim, **olduğu anda** doğru olan bir haberdir; okunduğu anda hâlâ doğru
 * olmayabilir. Kişi başka dala taşınmış, vekâleti bitmiş, kararı başkası
 * vermiş olabilir. O andan sonra kaydın başlığını ve numarasını göstermek,
 * görünürlük katmanını atlayan bir okuma yoludur (§8, §18.4).
 *
 * Faaliyete bağlı olmayan bildirimler (parola sıfırlama, hesap açılışı, iş
 * gecikmesi) koşulsuz geçer — onların görünürlük sorusu yok.
 */
async function kutuKapsami(
  db: InboxDb,
  userId: string,
  now: Date,
): Promise<Prisma.NotificationQueueWhereInput> {
  const gorunur = await visibleActivityWhere(
    db,
    { id: userId, isSystemAdmin: false },
    undefined,
    now,
  );

  return {
    userId,
    channel: "EMAIL",
    OR: [{ activityId: null }, { activity: { is: gorunur } }],
  };
}

/** Zil kutusunda gösterilecek kadar; tamamı değil. */
export const INBOX_LIMIT = 15;

export interface InboxItem {
  id: string;
  eventType: string;
  /** Kullanıcıya görünen tek satır. */
  summary: string;
  /**
   * İlgili faaliyetin sıra numarası; yoksa `null`.
   *
   * **Neden burada, şablonda değil:** aynı şablon e-postayı ve tarayıcı
   * bildirimini de üretiyor. Zil kutusu oturumun arkasında ve kullanıcının
   * kendi kaydına bakıyor; numarayı burada ekleyip e-posta metnini olduğu
   * gibi bırakmak, iki yüzeyin kurallarını karıştırmamak demek.
   */
  activityNo: number | null;
  /** Tıklanınca gidilecek yol. */
  path: string;
  createdAt: Date;
  /**
   * "3 dk önce" gibi hazır metin. **Sunucuda üretiliyor:** istemcide
   * `Date.now()` çağırmak render'ı saf olmaktan çıkarır ve aynı girdiyle
   * farklı çıktı üretir. Kabuk her tazelemede yeniden çiziliyor, metin de
   * onunla birlikte tazeleniyor.
   */
  age: string;
  seen: boolean;
}

/** Yükteki faaliyet kimliği; yük şekli garanti değil, doğrulanmadan okunmaz. */
function faaliyetKimligi(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;

  const deger = (payload as { activityId?: unknown }).activityId;
  return typeof deger === "string" ? deger : null;
}

/** Göreli zaman; kaba ama okunur. */
export function relativeTime(when: Date, now: Date): string {
  const dakika = Math.floor((now.getTime() - when.getTime()) / 60_000);

  if (dakika < 1) return "az önce";
  if (dakika < 60) return `${dakika} dk önce`;

  const saat = Math.floor(dakika / 60);
  if (saat < 24) return `${saat} sa önce`;

  return formatInstantShort(when);
}

export async function listInbox(
  db: InboxDb,
  userId: string,
  limit = INBOX_LIMIT,
  now: Date = new Date(),
): Promise<InboxItem[]> {
  const rows = await db.notificationQueue.findMany({
    where: await kutuKapsami(db, userId, now),
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      eventType: true,
      payload: true,
      createdAt: true,
      seenAt: true,
    },
  });

  // Faaliyet numaraları tek sorguda okunur. Numarasız bir kutuda "bir
  // faaliyetiniz hakkında soru soruldu" satırı üst üste üç kez çıkabiliyor ve
  // kullanıcı hangisi olduğunu anlayamıyordu (21.08.2026'da görüldü).
  const activityIds = [
    ...new Set(
      rows
        .map((row) => faaliyetKimligi(row.payload))
        .filter((id): id is string => id !== null),
    ),
  ];

  const numaralar = new Map<string, number>();
  if (activityIds.length > 0) {
    const kayitlar = await listVisibleActivities(db, {
      id: userId,
      isSystemAdmin: false,
    }, {
      where: { id: { in: activityIds } },
      select: { id: true, activityNo: true },
    }, undefined, now);
    for (const kayit of kayitlar) numaralar.set(kayit.id, kayit.activityNo);
  }

  return rows.map((row) => {
    const satir = renderLine(row.eventType, row.payload);
    const activityId = faaliyetKimligi(row.payload);

    return {
      id: row.id,
      eventType: row.eventType,
      summary: satir.summary,
      activityNo: activityId ? (numaralar.get(activityId) ?? null) : null,
      path: satir.path,
      createdAt: row.createdAt,
      age: relativeTime(row.createdAt, now),
      seen: row.seenAt !== null,
    };
  });
}

export async function countUnseen(
  db: InboxDb,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  // Sayaç da aynı süzgeçten geçer: göremediği bir kaydın varlığını sayaçtan
  // öğrenmek de sızıntıdır (§18.4).
  return db.notificationQueue.count({
    where: { ...(await kutuKapsami(db, userId, now)), seenAt: null },
  });
}

/**
 * Görüldü işaretler. **Yalnız kendi bildirimlerini**: kimlik `where` içinde,
 * istemciden gelen bir listeye güvenilmiyor.
 */
export async function markInboxSeen(
  db: InboxDb,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const sonuc = await db.notificationQueue.updateMany({
    where: { userId, channel: "EMAIL", seenAt: null },
    data: { seenAt: now },
  });

  return sonuc.count;
}
