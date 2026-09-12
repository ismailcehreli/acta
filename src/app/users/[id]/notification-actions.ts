"use server";

import { z } from "zod";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";

import type { NotificationModeState } from "./form-state";
const schema = z.object({
  mode: z.enum(["INSTANT", "DAILY_DIGEST", "ACTION_ONLY"]),
});

export async function saveNotificationModeAction(
  _previous: NotificationModeState,
  formData: FormData,
): Promise<NotificationModeState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound"), success: null };

  const parsed = schema.safeParse({ mode: formData.get("mode") });
  if (!parsed.success) {
    return { error: t("screens.profile.notificationInvalid"), success: null };
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { notificationMode: parsed.data.mode },
    });

    await recordAudit(tx, {
      userId: user.id,
      objectType: AUDIT_OBJECTS.user,
      objectId: user.id,
      action: AUDIT_ACTIONS.notificationModeChanged,
      detail: { mode: parsed.data.mode },
      now,
    });
  });




  return { error: null, success: t("screens.profile.notificationSaved") };
}
