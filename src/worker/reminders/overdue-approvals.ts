import type { PrismaClient } from "@prisma/client";

import { activityMaintenanceReader } from "@/server/authz/activity-repository";
import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";

// Onay hatırlatması (§5.4). Müdür bakmazsa kayıt sessizce bekler: yazan
// "gönderdim" sanır, üst kademe hiç görmez. Bu iş o sessizliği bozar.
//
// Sayaç, işin **onaylayıcının önüne düştüğü andan** işler
// (`approvalSubmittedAt`); kaydın ilk yazıldığı andan değil. Düzeltilip
// yeniden gönderilen kayıtta baştan başlar — açık soru 13'teki ilkeyle aynı:
// hatırlatma "şu an senin sıranda ve şu kadar gündür bekliyor" demeli.
//
// **Eskalasyon yok.** Hatırlatma yalnız onaylayıcıya gider, üstüne değil;
// yukarı taşıma ve eskalasyon Sürüm 2'dedir (§18.2).

export type OverdueApprovalDb = Pick<
  PrismaClient,
  | "activity"
  | "notificationQueue"
  | "workCalendar"
  | "holiday"
  | "systemSetting"
>;

export interface OverdueApprovalOutcome {
  /** Kuyruğa yazılan hatırlatma sayısı. */
  queued: number;
  /** Eşiği aşmış kayıt sayısı. */
  overdue: number;
}

export async function sendOverdueApprovalReminders(
  db: OverdueApprovalDb,
  now: Date,
): Promise<OverdueApprovalOutcome> {
  const outcome: OverdueApprovalOutcome = { queued: 0, overdue: 0 };

  const bekleyenler = await activityMaintenanceReader(db).findMany({
    where: {
      approvalStatus: "PENDING_APPROVAL",
      approverId: { not: null },
      approvalSubmittedAt: { not: null },
    },
    select: {
      id: true,
      approverId: true,
      approvalSubmittedAt: true,
    },
  });

  if (bekleyenler.length === 0) return outcome;

  const enEski = bekleyenler.reduce(
    (min, kayit) =>
      kayit.approvalSubmittedAt! < min ? kayit.approvalSubmittedAt! : min,
    bekleyenler[0].approvalSubmittedAt!,
  );

  const [calendarSettings, companyCalendar, esik] = await Promise.all([
    readWorkCalendar(db),
    loadWorkCalendar(db, enEski, now),
    readNumericSetting(db, SETTING_KEYS.pendingApprovalBusinessDays),
  ]);

  const takvim = {
    workingDays: calendarSettings.workingDays,
    holidays: companyCalendar.holidays,
  };

  for (const kayit of bekleyenler) {
    const bekleyenAndan = kayit.approvalSubmittedAt!;
    const isGunu = businessDaysBetween(bekleyenAndan, now, takvim);

    if (isGunu < esik) continue;

    outcome.overdue += 1;

    // Anahtar bekleme anını taşır: kayıt düzeltilip yeniden gönderilirse yeni
    // bir hatırlatma gidebilir, ama **aynı bekleyiş için** ikinci kez gitmez.
    const yazildi = await enqueueNotification(db, {
      userId: kayit.approverId!,
      eventType: NOTIFICATION_EVENTS.approvalOverdue,
      payload: { activityId: kayit.id },
      idempotencyKey: `approval_overdue:${kayit.id}:${bekleyenAndan.toISOString()}`,
      now,
    });

    if (yazildi) outcome.queued += 1;
  }

  return outcome;
}
