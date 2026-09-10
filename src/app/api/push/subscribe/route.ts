import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { removeSubscription, saveSubscription } from "@/server/push/subscriptions";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/shared/schemas/push";

// Push aboneliği ucu (Görev 5.3b).
//
// Abonelik **oturumdaki kişiye** bağlanır; istemcinin gönderdiği bir kullanıcı
// kimliğine değil. Aksi hâlde biri başkasının adına abone olabilir ve onun
// bildirimlerini kendi cihazına yönlendirebilirdi.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Oturum yok." }, { status: 401 });

  const parsed = pushSubscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Abonelik bilgisi geçersiz." }, { status: 400 });
  }

  await saveSubscription(prisma, user.id, {
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Oturum yok." }, { status: 401 });

  const parsed = pushUnsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Abonelik bilgisi geçersiz." }, { status: 400 });
  }

  // Yalnız kendi aboneliği kaldırılır; başkasının endpoint'ini gönderen biri
  // onun bildirimlerini kapatabilirdi.
  const kaldirildi = await removeSubscription(prisma, user.id, parsed.data.endpoint);

  return NextResponse.json({ ok: kaldirildi });
}
