import type { PrismaClient } from "@prisma/client";

import {
  REALTIME_CHANNEL,
  realtimeNotifySchema,
  type PublishableEventKind,
} from "./events";

// Olayın yayımı (§13, Görev 7.3).
//
// `pg_notify` **iş işleminin içinde** çağrılır ve PostgreSQL bildirimi ancak
// işlem commit edilirse gönderir. Bu, outbox ile aynı güvence: yazılmamış bir
// değişikliğin haberi çıkmaz, yazılmış bir değişikliğin haberi kaybolmaz.
// (Kaybolabileceği tek yer dinleyicinin kopuk olduğu andır; hub yeniden
// bağlandığında `reconnected` işaretiyle bunu kapatır.)

export type PublishDb = Pick<PrismaClient, "$executeRawUnsafe">;

/**
 * `pg_notify` yükü 8000 bayttan uzun olamaz; aşarsa PostgreSQL **hata verir**
 * ve işlemi düşürür. Yani sınırı aşmak, sessiz bir kayıp değil, iş işleminin
 * iptali demek. Bu yüzden alıcı listesi parçalara bölünür.
 */
const MAX_PAYLOAD_BYTES = 7_000;

function chunkUserIds(userIds: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const userId of userIds) {
    const denenen = [...current, userId];
    // Gerçek yük JSON; ölçü de JSON üzerinden alınır ki tahmin yürütmeyelim.
    const boyut = Buffer.byteLength(JSON.stringify({ kind: "x", userIds: denenen }));

    if (current.length > 0 && boyut > MAX_PAYLOAD_BYTES) {
      chunks.push(current);
      current = [userId];
    } else {
      current = denenen;
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Olayı ilgili kullanıcılara duyurur.
 *
 * Alıcı listesi boşsa hiç yayımlanmaz — "kimseye" bir haber göndermek anlamsız
 * ve `pg_notify` çağrısı boşuna. Yinelenen kimlikler tekilleştirilir.
 */
export async function publishRealtimeEvent(
  db: PublishDb,
  event: { kind: PublishableEventKind; userIds: readonly string[] },
): Promise<void> {
  const userIds = [...new Set(event.userIds)].filter(Boolean);
  if (userIds.length === 0) return;

  for (const chunk of chunkUserIds(userIds)) {
    const payload = realtimeNotifySchema.parse({ kind: event.kind, userIds: chunk });

    // Kanal adı sabit ve koda gömülü; kullanıcıdan gelen hiçbir değer kimlik
    // olarak SQL'e girmiyor. Yük parametre olarak geçiyor.
    await db.$executeRawUnsafe(
      "SELECT pg_notify($1, $2)",
      REALTIME_CHANNEL,
      JSON.stringify(payload),
    );
  }
}
