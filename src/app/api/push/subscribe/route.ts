import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import { removeSubscription, saveSubscription } from "@/server/push/subscriptions";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/shared/schemas/push";


//




export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) {
    return NextResponse.json(
      { error: t("errors.api.authenticationRequired") },
      { status: 401 },
    );
  }

  const parsed = pushSubscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t("errors.api.invalidSubscription") },
      { status: 400 },
    );
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
  const t = await getTranslations();
  if (!user) {
    return NextResponse.json(
      { error: t("errors.api.authenticationRequired") },
      { status: 401 },
    );
  }

  const parsed = pushUnsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t("errors.api.invalidSubscription") },
      { status: 400 },
    );
  }

  const removed = await removeSubscription(prisma, user.id, parsed.data.endpoint);

  return NextResponse.json({ ok: removed });
}
