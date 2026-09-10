import { minuteToTime } from "@/shared/schemas/calendar";

// Mesai penceresinin okunur özeti. Sunucu eylemi ve ekran aynı metni
// kullanıyor: iki taraf ayrı yazsaydı, onay ekranındaki cümle ile kaydedilen
// değer sessizce ayrışabilirdi.

const GUN_ADLARI = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export interface WorkWindowLike {
  workingDays: number[];
  workStartMinute: number;
  workEndMinute: number;
  worksOnHolidays: boolean;
  source: "unit" | "inherited" | "company";
  sourceUnitName: string | null;
}

/** "Pzt, Sal, Çar, Per, Cum" — sıralı ve kısa. */
export function formatWorkingDays(days: number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((gun) => GUN_ADLARI[gun - 1] ?? String(gun))
    .join(", ");
}

/** "07:00–17:00". */
export function formatWorkHours(pencere: WorkWindowLike): string {
  return `${minuteToTime(pencere.workStartMinute)}–${minuteToTime(pencere.workEndMinute)}`;
}

/** Değerin nereden geldiği; "kimse sürprizle karşılaşmasın" (tasarım Paket H). */
export function formatWindowSource(pencere: WorkWindowLike): string {
  if (pencere.source === "unit") return "birimin kendi tanımı";
  if (pencere.source === "company") return "şirket varsayılanı";
  return pencere.sourceUnitName
    ? `${pencere.sourceUnitName} biriminden devralındı`
    : "üst birimden devralındı";
}

export function formatHolidayRule(pencere: WorkWindowLike): string {
  return pencere.worksOnHolidays
    ? "resmî tatillerde çalışır"
    : "resmî tatillerde çalışmaz";
}
