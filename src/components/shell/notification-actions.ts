"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { markInboxSeen } from "@/server/notifications/inbox";

// Zil kutusu açılınca bildirimleri görüldü işaretler (Görev 10.4).
//
// Kimi işaretleyeceği **oturumdan** gelir; istemciden gelen bir listeye
// güvenilmez. Başkasının bildirimlerini "okundu" yapan bir uç, onun zilini
// sessizce boşaltırdı.

export async function markNotificationsSeenAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  await markInboxSeen(prisma, user.id);
  revalidatePath("/", "layout");
}
