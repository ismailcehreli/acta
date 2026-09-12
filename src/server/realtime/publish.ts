import type { PrismaClient } from "@prisma/client";

import {
  REALTIME_CHANNEL,
  realtimeNotifySchema,
  type PublishableEventKind,
} from "./events";


//






export type PublishDb = Pick<PrismaClient, "$executeRawUnsafe">;


const MAX_PAYLOAD_BYTES = 7_000;

function chunkUserIds(userIds: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const userId of userIds) {
    const denenen = [...current, userId];

    const pageSize = Buffer.byteLength(JSON.stringify({ kind: "x", userIds: denenen }));

    if (current.length > 0 && pageSize > MAX_PAYLOAD_BYTES) {
      chunks.push(current);
      current = [userId];
    } else {
      current = denenen;
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}


export async function publishRealtimeEvent(
  db: PublishDb,
  event: { kind: PublishableEventKind; userIds: readonly string[] },
): Promise<void> {
  const userIds = [...new Set(event.userIds)].filter(Boolean);
  if (userIds.length === 0) return;

  for (const chunk of chunkUserIds(userIds)) {
    const payload = realtimeNotifySchema.parse({ kind: event.kind, userIds: chunk });



    await db.$executeRawUnsafe(
      "SELECT pg_notify($1, $2)",
      REALTIME_CHANNEL,
      JSON.stringify(payload),
    );
  }
}
