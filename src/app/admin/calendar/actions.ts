"use server";

import { revalidatePath } from "next/cache";

import { requireSystemAdmin } from "@/server/authz/admin";
import {
  addHoliday,
  removeHoliday,
  saveWorkCalendar,
} from "@/server/calendar/settings";
import { prisma } from "@/server/db";
import {
  holidaySchema,
  workCalendarSchema,
  timeToMinute,
} from "@/shared/schemas/calendar";

import type { CalendarFormState } from "./form-state";
import {
  clearUnitWorkCalendar,
  saveUnitWorkCalendar,
} from "@/server/calendar/unit-calendar";

function hata(message: string): CalendarFormState {
  return { error: message, success: null };
}

export async function saveWorkCalendarAction(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const me = await requireSystemAdmin();

  const baslangic = timeToMinute(String(formData.get("workStart") ?? ""));
  const bitis = timeToMinute(String(formData.get("workEnd") ?? ""));
  if (baslangic === null || bitis === null) {
    return hata("Mesai saatleri SS:DD biçiminde girilmeli.");
  }

  const parsed = workCalendarSchema.safeParse({
    workingDays: formData.getAll("workingDays"),
    workStartMinute: baslangic,
    workEndMinute: bitis,
  });

  if (!parsed.success) {
    return hata(parsed.error.issues[0]?.message ?? "Girdi geçersiz");
  }

  await saveWorkCalendar(prisma, parsed.data, me.id);
  revalidatePath("/admin/calendar");

  return { error: null, success: "Çalışma takvimi kaydedildi." };
}

export async function addHolidayAction(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const me = await requireSystemAdmin();

  const parsed = holidaySchema.safeParse({
    date: formData.get("date"),
    description: formData.get("description"),
  });

  if (!parsed.success) {
    return hata(parsed.error.issues[0]?.message ?? "Girdi geçersiz");
  }

  const sonuc = await addHoliday(prisma, parsed.data, me.id);
  if (!sonuc.ok) return hata(sonuc.message);

  revalidatePath("/admin/calendar");
  return { error: null, success: `${parsed.data.date} tatil olarak eklendi.` };
}

export async function removeHolidayAction(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const me = await requireSystemAdmin();

  const date = String(formData.get("date") ?? "");
  const kaldirildi = await removeHoliday(prisma, date, me.id);

  // Bulunamayan kayıt sessizce başarılı sayılmaz.
  if (!kaldirildi) return hata("Bu tarih tatil listesinde yok.");

  revalidatePath("/admin/calendar");
  return { error: null, success: `${date} tatil listesinden çıkarıldı.` };
}

/**
 * Birime özel mesai penceresi (Görev 11.9).
 *
 * Yalnız sistem yöneticisi (ürün sahibi kararı, 21.08.2026): bölüm müdürü
 * kendi biriminin takvimini değiştiremez. Mesai penceresi hatırlatma
 * zamanlamasını belirliyor ve bir birimin saatini değiştirmek o birimdeki
 * herkesin akşamını etkiliyor.
 */
export async function saveUnitCalendarAction(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  await requireSystemAdmin();

  const orgUnitId = String(formData.get("orgUnitId") ?? "");
  if (!orgUnitId) return { error: "Birim seçilmedi.", success: null };

  // "Devral" seçeneği: birimin kendi tanımı kaldırılır, üstünden devralır.
  if (formData.get("inherit") === "on") {
    await clearUnitWorkCalendar(prisma, orgUnitId);
    revalidatePath("/admin/calendar");
    return {
      error: null,
      success: "Birim artık mesai penceresini üstünden devralıyor.",
    };
  }

  const gunler = [1, 2, 3, 4, 5, 6, 7].filter(
    (gun) => formData.get(`day-${gun}`) === "on",
  );
  if (gunler.length === 0) {
    return { error: "En az bir çalışma günü seçilmeli.", success: null };
  }

  const bas = timeToMinute(String(formData.get("workStart") ?? ""));
  const bit = timeToMinute(String(formData.get("workEnd") ?? ""));
  if (bas === null || bit === null) {
    return { error: "Mesai saatleri geçersiz.", success: null };
  }
  if (bit <= bas) {
    return { error: "Mesai bitişi başlangıçtan sonra olmalı.", success: null };
  }

  await saveUnitWorkCalendar(prisma, orgUnitId, {
    workingDays: gunler,
    workStartMinute: bas,
    workEndMinute: bit,
    worksOnHolidays: formData.get("worksOnHolidays") === "on",
  });

  revalidatePath("/admin/calendar");
  return { error: null, success: "Birimin mesai penceresi kaydedildi." };
}
