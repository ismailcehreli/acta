import type { PrismaClient } from "@prisma/client";

import { renderLine } from "@/server/notifications/templates";
import {
  dropSubscription,
  listSubscriptions,
} from "@/server/push/subscriptions";
import { isExhausted, isRetryDue, MAX_ATTEMPTS } from "@/server/notifications/schedule";
import { readVapidKeys } from "@/server/settings/vapid";
import {
  gorunurlugeGoreAyir,
  type VisibleRowsDb,
} from "@/server/notifications/visible-rows";

// Push kanalının kuyruk işleyicisi (§12.3, Görev 5.3b).
//
// E-posta işleyicisiyle **aynı kuyruğu** kullanır, ayrı kanal değeriyle.
// Birleştirme yoktur: push zaten kısa ve anlıktır, birleştirilmiş bir bildirim
// "3 yeni olay" deyip kimseye ne olduğunu söylemezdi.
//
// **İçerik taşınmaz** (§12.3): bildirimde başlık ve kaydın adresi vardır,
// açıklama yoktur. Kilit ekranında görünen bir metin, telefonu eline alan
// herkesin okuyabileceği bir metindir.

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

export interface PushEndpoint {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSendOutcome =
  | { ok: true }
  /** Abonelik kalıcı olarak yok; kayıt düşürülür. */
  | { ok: false; gone: true }
  | { ok: false; gone: false; message: string };

export interface PushTransport {
  send(
    endpoint: PushEndpoint,
    message: PushMessage,
    keys: { publicKey: string; privateKey: string; subject: string },
  ): Promise<PushSendOutcome>;
}

export type PushDispatcherDb = Pick<
  PrismaClient,
  "notificationQueue" | "pushSubscription" | "systemSetting" | "auditLog" | "$transaction"
> &
  VisibleRowsDb;

export interface PushDispatchResult {
  sent: number;
  delivered: number;
  failed: number;
  givenUp: number;
  /** Kalıcı hata yüzünden düşürülen abonelik sayısı. */
  droppedSubscriptions: number;
  /** Alıcı ilgili kaydı artık göremediği için gönderilmeyen kayıt sayısı. */
  cancelled: number;
}

const BOS: PushDispatchResult = {
  sent: 0,
  delivered: 0,
  failed: 0,
  givenUp: 0,
  droppedSubscriptions: 0,
  cancelled: 0,
};

export async function dispatchPushNotifications(
  db: PushDispatcherDb,
  transport: PushTransport,
  options: { now: Date; baseUrl: string; maxItems?: number },
): Promise<PushDispatchResult> {
  const { now, baseUrl, maxItems = 200 } = options;

  const keys = await readVapidKeys(db);
  if (!keys) {
    // Anahtar yoksa push kurulmamıştır. Kuyruğa hiç yazılmaması gerekir; yine
    // de yazılmışsa burada durulur ve kayıtlar bekler.
    return BOS;
  }

  const pending = await db.notificationQueue.findMany({
    where: { status: "PENDING", channel: "PUSH" },
    orderBy: { createdAt: "asc" },
    take: maxItems,
    select: {
      id: true,
      userId: true,
      eventType: true,
      activityId: true,
      payload: true,
      attemptCount: true,
      lastAttemptAt: true,
    },
  });

  const sonuc: PushDispatchResult = { ...BOS };

  for (const item of pending) {
    if (!isRetryDue(item, now)) continue;

    // Görünürlük gönderim anında yeniden sorulur (bulgu 3). Titreşimle
    // gelen bildirim de faaliyetin başlığını taşıyor; alıcı o kaydı artık
    // göremiyorsa gönderilmez.
    const { dusenler } = await gorunurlugeGoreAyir(
      db,
      { id: item.userId, isSystemAdmin: false },
      [item],
      now,
    );

    if (dusenler.length > 0) {
      await db.notificationQueue.update({
        where: { id: item.id },
        data: {
          status: "CANCELLED",
          lastAttemptAt: now,
          lastError: "Alıcı ilgili kaydı artık göremiyor.",
        },
      });
      sonuc.cancelled += 1;
      continue;
    }

    const abonelikler = await listSubscriptions(db, item.userId);

    if (abonelikler.length === 0) {
      // Aboneliği olmayan kişiye push gönderilemez. Bu bir hata değildir:
      // kişi izni geri çekmiş olabilir. Kayıt bekletilmez, kapatılır — aksi
      // hâlde kuyrukta sonsuza kadar birikirdi.
      await db.notificationQueue.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          attemptCount: MAX_ATTEMPTS,
          lastAttemptAt: now,
          lastError: "Kişinin push aboneliği yok.",
        },
      });
      sonuc.givenUp += 1;
      continue;
    }

    const satir = renderLine(item.eventType, item.payload);
    const message: PushMessage = {
      title: "Faaliyet Raporlama",
      body: satir.summary,
      url: `${baseUrl}${satir.path}`,
    };

    let herhangiBiriGitti = false;
    let sonHata = "";

    for (const abonelik of abonelikler) {
      const cikti = await transport.send(abonelik, message, keys);
      sonuc.sent += 1;

      if (cikti.ok) {
        herhangiBiriGitti = true;
        await db.pushSubscription.updateMany({
          where: { endpoint: abonelik.endpoint },
          data: { lastSentAt: now, failureCount: 0 },
        });
        continue;
      }

      if (cikti.gone) {
        // Tarayıcı aboneliği silmiş; tutmak her turda boşuna denemek olurdu.
        await dropSubscription(db, abonelik.endpoint);
        sonuc.droppedSubscriptions += 1;
        continue;
      }

      sonHata = cikti.message;
      await db.pushSubscription.updateMany({
        where: { endpoint: abonelik.endpoint },
        data: { failureCount: { increment: 1 } },
      });
    }

    if (herhangiBiriGitti) {
      // **Bir cihaza gitmesi yeter.** Hepsini beklemek, kapalı bir eski
      // telefonu yüzünden bildirimi tekrar tekrar göndermek olurdu.
      await db.notificationQueue.update({
        where: { id: item.id },
        data: { status: "SENT", sentAt: now, lastAttemptAt: now, lastError: null },
      });
      sonuc.delivered += 1;
      continue;
    }

    const deneme = item.attemptCount + 1;
    const tukendi = isExhausted(deneme) || sonHata === "";

    await db.notificationQueue.update({
      where: { id: item.id },
      data: {
        status: tukendi ? "FAILED" : "PENDING",
        attemptCount: deneme,
        lastAttemptAt: now,
        lastError:
          sonHata === "" ? "Bütün abonelikler geçersizdi." : sonHata.slice(0, 500),
      },
    });

    if (tukendi) sonuc.givenUp += 1;
    else sonuc.failed += 1;
  }

  return sonuc;
}
