import { z } from "zod";

import { isCalendarDay } from "./iso-date";

// Çalışma takvimi ve tatil girdileri (§12.1). Takvim **şirket genelinde tek
// tanımdır**; vardiya, geceye taşan mesai ve kişi bazlı takvim v3'te kaldırıldı.

/** ISO gün numarası: 1 = Pazartesi … 7 = Pazar. */
export const isoWeekdaySchema = z.coerce.number().int().min(1).max(7);

export const workCalendarSchema = z
  .object({
    workingDays: z
      .array(isoWeekdaySchema)
      .min(1, "En az bir çalışma günü seçilmeli")
      .max(7)
      .refine((days) => new Set(days).size === days.length, {
        message: "Aynı gün iki kez seçilemez",
      }),
    // Gün başından itibaren dakika; yerel saat (Europe/Istanbul).
    workStartMinute: z.coerce.number().int().min(0).max(24 * 60 - 1),
    workEndMinute: z.coerce.number().int().min(1).max(24 * 60),
  })
  .refine((value) => value.workEndMinute > value.workStartMinute, {
    message: "Mesai bitişi başlangıçtan sonra olmalı",
    path: ["workEndMinute"],
  });

export const holidayDateSchema = z
  .string()
  .refine(isCalendarDay, "Tarih GG.AA.YYYY biçiminde seçilmeli");

export const holidaySchema = z.object({
  date: holidayDateSchema,
  description: z
    .string()
    .trim()
    .min(1, "Tatil açıklaması zorunludur")
    .max(150, "Açıklama en fazla 150 karakter olabilir"),
});

export type WorkCalendarInput = z.infer<typeof workCalendarSchema>;
export type HolidayInput = z.infer<typeof holidaySchema>;

/** Dakika değerini "HH:MM" biçiminde gösterir. */
export function minuteToTime(minute: number): string {
  const saat = Math.floor(minute / 60);
  const dakika = minute % 60;
  return `${String(saat).padStart(2, "0")}:${String(dakika).padStart(2, "0")}`;
}

/** "HH:MM" metnini gün başından itibaren dakikaya çevirir. */
export function timeToMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const saat = Number(match[1]);
  const dakika = Number(match[2]);
  if (saat > 24 || dakika > 59) return null;

  return saat * 60 + dakika;
}

export const WEEKDAY_NAMES: Record<number, string> = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};
