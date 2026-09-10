// Faaliyet tarihi kuralları (§5.6). Gün hesabı şirketin yerel saatine göre
// yapılır (§16.6): sunucu UTC'de çalışsa da "bugün" İstanbul'daki bugündür.
//
// Gün hesabının kendisi `@/shared/format/date-time` içindedir ve buradan
// yeniden dışa verilir. İki yerde ayrı ayrı kurulmuş iki `Intl` biçimlendirici,
// birinin zaman dilimi değiştiğinde sessizce ayrışır; bu modül kuralı uygular,
// hesabı değil (Görev 11.1).

export {
  COMPANY_TIME_ZONE,
  companyDay,
  toDateValue,
} from "@/shared/format/date-time";

import { companyDay, toDateValue } from "@/shared/format/date-time";

function daysBetween(earlier: string, later: string): number {
  const diff = toDateValue(later).getTime() - toDateValue(earlier).getTime();
  return Math.round(diff / 86_400_000);
}

export type ActivityDateProblem = "future" | "too_old";

/**
 * Faaliyet tarihi bugüne veya izin verilen geçmiş pencereye düşmelidir.
 * Sınırın sebebi veri kalitesidir: ay sonunda toplu girilen faaliyetler
 * kimsenin doğru hatırlamadığı bir yığındır (§5.6).
 */
export function checkActivityDate(
  activityDay: string,
  now: Date,
  retroactiveDays: number,
): ActivityDateProblem | null {
  const today = companyDay(now);
  const distance = daysBetween(activityDay, today);

  if (distance < 0) return "future";
  if (distance > retroactiveDays) return "too_old";

  return null;
}
