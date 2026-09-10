import type { PrismaClient } from "@prisma/client";

import { toDateValue } from "@/server/activities/date-rules";
import { activityMaintenanceReader } from "@/server/authz/activity-repository";
import { isNoActivityDay } from "@/server/absence/service";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import {
  loadUnitCalendarIndex,
  resolveUnitWorkWindowFrom,
  type UnitWorkWindow,
} from "@/server/calendar/unit-calendar";
import { companyDay, companyMinuteOfDay } from "@/shared/format/date-time";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";

// Mesai sonu hatırlatması (§12.1):
//
//   "Umarım her şey yolundadır — bugün faaliyet göndermedin."
//
// Hatırlatma **yalnızca kişiye** gider. Yöneticiye bildirim varsayılan olarak
// kapalıdır ve gerekçesi kültüreldir: zorunlu görünürlük, insanları "girmiş
// olmak için" içi boş faaliyet yazmaya iter (§12.1). Yöneticiye katılım özeti
// ayarı `SystemSetting`de duruyor; davranışı raporlarla birlikte Sürüm 2'de.
//
// Gönderilmeme sebepleri sessiz değildir; sayılar çağırana döner.

export type NoActivityReminderDb = Pick<
  PrismaClient,
  | "user"
  | "activity"
  | "notificationQueue"
  | "systemSetting"
  | "noActivityPeriod"
  | "workCalendar"
  | "holiday"
  | "orgUnit"
  | "orgUnitWorkCalendar"
>;

export interface ReminderOutcome {
  /** Kuyruğa yazılan hatırlatma sayısı. */
  queued: number;
  /** Bugün zaten faaliyet girmiş olduğu için atlanan kişi sayısı. */
  skippedHasActivity: number;
  /** "Faaliyet beklenmiyor" işareti taşıdığı için atlanan kişi sayısı. */
  skippedNoActivityMark: number;
  /**
   * Hiçbir birim için hatırlatma vakti gelmemiş ya da bugün çalışma günü değil.
   *
   * Pencere birim bazlı olduğu için (Görev 11.9) bu bayrak "tek bir şirket
   * saatine göre erken" demiyor; hiçbir birimin vakti gelmemiş demek.
   */
  skippedNotDue: boolean;
}

export async function sendMissingActivityReminders(
  db: NoActivityReminderDb,
  now: Date,
): Promise<ReminderOutcome> {
  const bos: ReminderOutcome = {
    queued: 0,
    skippedHasActivity: 0,
    skippedNoActivityMark: 0,
    skippedNotDue: true,
  };

  // **Mesai penceresi birim bazlı** (Görev 11.9). Şirket geneli tek pencerede
  // depo çalışanına bir saat geç hatırlatma gidiyordu: kişi 17:00'de çıkıyor,
  // hatırlatma 18:00'de yazılıyordu.
  //
  // İş günü sayacı bundan **etkilenmiyor** ve şirket geneli kalıyor; gerekçesi
  // `unit-calendar.ts` içinde yazılı.
  const companyCalendar = await loadWorkCalendar(db, now, now);
  const bugun = companyDay(now);
  const tatilMi = companyCalendar.holidays.includes(bugun);
  const suankiDakika = companyMinuteOfDay(now);

  // Faaliyet yazması beklenmeyen kişiler (§7.4 istisnası, ürün sahibi kararı
  // 19.08.2026) hatırlatma almaz. Yönetim Kurulu üyesine "bugün faaliyet
  // göndermedin" demek, beklenmeyen bir şeyi hatırlatmak olurdu.
  const users = await db.user.findMany({
    where: { isActive: true, writesActivities: true },
    select: { id: true, orgUnitId: true },
  });

  if (users.length === 0) return bos;

  const leadMinutes = await readNumericSetting(
    db,
    SETTING_KEYS.noActivityReminderLeadMinutes,
  );

  // Pencere **birim başına** bir kez çözülüyor: her kullanıcı için ayrı ağaç
  // yürüyüşü, 50 kişilik bir şirkette 50 gereksiz sorgu demekti.
  //
  // Ağaç ve takvimler de **tur başına bir kez** yükleniyor (denetim
  // 23.08.2026, bulgu 9). Birim başına bir kez çözmek yetmiyordu: her çözüm
  // bütün birimleri ve bütün birim takvimlerini yeniden okuyordu, yani on
  // birimli bir şirkette on tam tablo taraması.
  const indeks = await loadUnitCalendarIndex(db);
  const birimler = [...new Set(users.map((u) => u.orgUnitId))];
  const pencereler = new Map<string, UnitWorkWindow>();
  for (const birimId of birimler) {
    pencereler.set(birimId, resolveUnitWorkWindowFrom(indeks, birimId));
  }

  const isoGun = new Date(`${bugun}T00:00:00.000Z`).getUTCDay() || 7;

  // `skippedNotDue` artık **hiçbir birim için** hatırlatma vaktinin gelmediğini anlatıyor.
  // Pencere birim bazlı olduğundan tek bir küresel "vakti geldi mi" cevabı
  // yok: depo 17:00'de, merkez 18:00'de kapanıyor; hatırlatma mesai bitiminden
  // ayarlanan süre kadar önce tetikleniyor.
  const outcome: ReminderOutcome = { ...bos, skippedNotDue: true };
  const gun = toDateValue(bugun);

  for (const user of users) {
    const pencere = pencereler.get(user.orgUnitId);
    if (!pencere) continue;

    // Üç koşul birlikte: bugün bu birim için çalışma günü mü, resmî tatil
    // engeli var mı, ve hatırlatma vakti geldi mi.
    const calismaGunu =
      pencere.workingDays.includes(isoGun) &&
      (!tatilMi || pencere.worksOnHolidays);

    const tetiklemeDakikasi = Math.max(
      pencere.workStartMinute,
      pencere.workEndMinute - leadMinutes,
    );

    if (!calismaGunu || suankiDakika < tetiklemeDakikasi) continue;

    // En az bir birim için hatırlatma vakti geldi: koşu boşa gitmedi.
    outcome.skippedNotDue = false;

    const bugunFaaliyet = await activityMaintenanceReader(db).count({
      where: {
        authorId: user.id,
        activityDate: gun,
        // İptal edilmiş kayıt "faaliyet girdi" saymaz.
        approvalStatus: { not: "CANCELLED" },
      },
    });

    if (bugunFaaliyet > 0) {
      outcome.skippedHasActivity += 1;
      continue;
    }

    if (await isNoActivityDay(db, user.id, bugun)) {
      outcome.skippedNoActivityMark += 1;
      continue;
    }

    // Günde tek hatırlatma: anahtar günü taşıdığı için ikinci tur yazmaz.
    const yazildi = await enqueueNotification(db, {
      userId: user.id,
      eventType: NOTIFICATION_EVENTS.noActivityToday,
      payload: { day: bugun },
      idempotencyKey: `no_activity_today:${user.id}:${bugun}`,
      now,
    });

    if (yazildi) outcome.queued += 1;
  }

  return outcome;
}
