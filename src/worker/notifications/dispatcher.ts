import type { PrismaClient } from "@prisma/client";

import {
  isActionRequiredEvent,
  isUrgentEvent,
} from "@/server/notifications/events";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";
import { renderEmail, renderLine } from "@/server/notifications/templates";
import {
  gorunurlugeGoreAyir,
  type VisibleRowsDb,
} from "@/server/notifications/visible-rows";
import {
  isDigestDue,
  isExhausted,
  isRetryDue,
  MAX_ATTEMPTS,
} from "@/server/notifications/schedule";

import type { EmailTransport } from "./transport";

// Kuyruk işleyicisi (§12.3). İşleyici süreci her turda çağırır.
//
// Sıra: bekleyenleri kişi bazında topla → gönderim zamanı gelenleri seç →
// tek e-postada birleştirip gönder → sonucu yaz.
//
// **Birleştirme penceresi yoktur.** Tur aralığının kendisi penceredir: bir tur
// içinde aynı kişiye biriken bildirimler tek e-postada gider. Ayrıca beklemek
// ilk bildirimi geciktirirdi; kabul ölçütü gecikmeyi beş dakikanın altında
// istiyor (§18.4).

export type DispatcherDb = Pick<
  PrismaClient,
  "notificationQueue" | "user" | "systemSetting"
> &
  VisibleRowsDb;

export interface DispatchResult {
  /** Gönderilen e-posta sayısı (kişi başına bir e-posta). */
  sent: number;
  /** Gönderilmiş sayılan kuyruk kaydı sayısı. */
  delivered: number;
  /** Bu turda hata alan kuyruk kaydı sayısı. */
  failed: number;
  /** Denemeleri tükendiği için vazgeçilen kayıt sayısı. */
  givenUp: number;
  /** Alıcı ilgili kaydı artık göremediği için gönderilmeyen kayıt sayısı. */
  cancelled: number;
}

export interface DispatchOptions {
  now: Date;
  baseUrl: string;
  /** Tek turda en fazla kaç kişiye gönderilir; kuyruk şişse de tur bitmeli. */
  maxRecipients?: number;
}

export async function dispatchNotifications(
  db: DispatcherDb,
  transport: EmailTransport,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const { now, baseUrl, maxRecipients = 100 } = options;

  const pending = await db.notificationQueue.findMany({
    where: { status: "PENDING", channel: "EMAIL" },
    orderBy: { createdAt: "asc" },
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

  const result: DispatchResult = {
    sent: 0,
    delivered: 0,
    failed: 0,
    givenUp: 0,
    cancelled: 0,
  };
  if (pending.length === 0) return result;

  // Özet saati koda gömülü değil: ekrandan değiştirilebilir (§16.5).
  const digestHour = await readNumericSetting(db, SETTING_KEYS.dailyDigestHour);

  // Kişi bazında toplama = birleştirme.
  const byUser = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  let islenenKisi = 0;

  for (const [userId, kuyrukSatirlari] of byUser) {
    let rows = kuyrukSatirlari;
    if (islenenKisi >= maxRecipients) break;

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, isActive: true, notificationMode: true },
    });

    // Pasifleştirilmiş kullanıcıya posta gitmez; kayıt da beklemede kalmaz.
    if (!user || !user.isActive) {
      await db.notificationQueue.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: {
          status: "FAILED",
          lastError: "Alıcı pasif ya da bulunamadı.",
          lastAttemptAt: now,
        },
      });
      result.givenUp += rows.length;
      continue;
    }

    // **Görünürlük, gönderim anında yeniden sorulur** (denetim
    // 21.08.2026, bulgu 3). Bildirim kuyruğa yazıldığında alıcı kaydı
    // görüyordu; gönderim anında görmüyor olabilir — başka dala taşınmış,
    // vekâleti bitmiş ya da kararı başkası vermiş olabilir. E-posta metni
    // faaliyetin **başlığını** taşıyor; onu yollamak, görünürlük katmanını
    // atlayan bir yazma yolu olurdu (§8, §18.4).
    const { gecenler, dusenler } = await gorunurlugeGoreAyir(
      db,
      { id: userId, isSystemAdmin: false },
      rows,
      now,
    );

    if (dusenler.length > 0) {
      // `FAILED` değil: ortada arıza yok, gönderilmemesi doğru karar.
      // Operasyon ekranında hata gibi görünmemeli.
      await db.notificationQueue.updateMany({
        where: { id: { in: dusenler.map((row) => row.id) } },
        data: {
          status: "CANCELLED",
          lastAttemptAt: now,
          lastError: "Alıcı ilgili kaydı artık göremiyor.",
        },
      });
      result.cancelled += dusenler.length;
    }

    if (gecenler.length === 0) continue;
    rows = gecenler;

    // Denemesi tükenmiş kayıtlar burada kapatılır: sessizce beklemede kalmaz,
    // operasyon ekranında "başarısız" olarak görünür.
    const tukenmis = rows.filter((row) => isExhausted(row.attemptCount));
    if (tukenmis.length > 0) {
      await db.notificationQueue.updateMany({
        where: { id: { in: tukenmis.map((r) => r.id) } },
        data: { status: "FAILED", lastAttemptAt: now },
      });
      result.givenUp += tukenmis.length;
    }

    const hazir = rows.filter(
      (row) => !isExhausted(row.attemptCount) && isRetryDue(row, now),
    );
    if (hazir.length === 0) continue;

    // Bekleyemeyen olaylar (parola sıfırlama) ayrı gider: ne özet moduna girer
    // ne de başka bildirimlerle birleşir. Bir saatlik ömrü olan bir bağlantının
    // akşam 18:00 özetini beklemesi, bağlantıyı işe yaramaz hâle getirirdi.
    const acil = hazir.filter((row) => isUrgentEvent(row.eventType));
    const normal = hazir.filter((row) => !isUrgentEvent(row.eventType));

    const gruplar: { rows: typeof hazir; digest: boolean }[] = acil.map((row) => ({
      rows: [row],
      digest: false,
    }));

    // "Yalnız benden işlem isteyenler" tercihi (Görev 10.8): bilgilendirmeler
    // gönderilmez. **Kuyrukta bekletilmez**, kapatılır — aksi hâlde kuyruk
    // hiç gönderilmeyecek kayıtlarla dolardı ve gecikme ölçümü bozulurdu.
    const elenenler =
      user.notificationMode === "ACTION_ONLY"
        ? normal.filter((row) => !isActionRequiredEvent(row.eventType))
        : [];

    if (elenenler.length > 0) {
      await db.notificationQueue.updateMany({
        where: { id: { in: elenenler.map((row) => row.id) } },
        data: {
          status: "SENT",
          sentAt: now,
          lastAttemptAt: now,
          lastError: "Kişinin tercihi: yalnız işlem isteyen bildirimler.",
        },
      });
    }

    const gonderilecek = normal.filter((row) => !elenenler.includes(row));

    if (gonderilecek.length > 0) {
      // Günlük özet modu: olay başına posta yerine günde tek özet (§12.3).
      if (user.notificationMode === "DAILY_DIGEST") {
        const sonGonderim = await db.notificationQueue.findFirst({
          where: { userId, status: "SENT" },
          orderBy: { sentAt: "desc" },
          select: { sentAt: true },
        });

        if (isDigestDue(now, sonGonderim?.sentAt ?? null, digestHour)) {
          gruplar.push({ rows: gonderilecek, digest: true });
        }
      } else {
        gruplar.push({ rows: gonderilecek, digest: false });
      }
    }

    if (gruplar.length === 0) continue;
    islenenKisi += 1;

    for (const grup of gruplar) {
      await gonder(grup.rows, grup.digest);
    }
  }

  return result;

  async function gonder(denenecek: typeof pending, digest: boolean): Promise<void> {
    const alici = await db.user.findUnique({
      where: { id: denenecek[0].userId },
      select: { email: true },
    });
    if (!alici) return;

    const lines = denenecek.map((row) => renderLine(row.eventType, row.payload));
    const email = renderEmail(lines, { baseUrl, digest });

    try {
      await transport.send({ to: alici.email, ...email });

      await db.notificationQueue.updateMany({
        where: { id: { in: denenecek.map((r) => r.id) } },
        data: {
          status: "SENT",
          sentAt: now,
          lastAttemptAt: now,
          attemptCount: { increment: 1 },
          lastError: null,
        },
      });

      result.sent += 1;
      result.delivered += denenecek.length;
    } catch (error) {
      const mesaj = error instanceof Error ? error.message : String(error);

      // Hata yutulmaz: deneme sayacı artar, sebep kayda geçer. Sayaç sınıra
      // ulaştıysa kayıt bir sonraki turda "başarısız" olur.
      await db.notificationQueue.updateMany({
        where: { id: { in: denenecek.map((r) => r.id) } },
        data: {
          lastAttemptAt: now,
          attemptCount: { increment: 1 },
          lastError: mesaj.slice(0, 1_000),
        },
      });

      result.failed += denenecek.length;
    }
  }
}

export { MAX_ATTEMPTS };
