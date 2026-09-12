"use server";

import { revalidatePath } from "next/cache";

import { requireSystemAdmin } from "@/server/authz/admin";
import {
  addHoliday,
  removeHoliday,
  saveWorkCalendar,
} from "@/server/calendar/settings";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import {
  holidaySchema,
  workCalendarSchema,
  timeToMinute,
} from "@/shared/schemas/calendar";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";

import type { CalendarFormState } from "./form-state";
import {
  clearUnitWorkCalendar,
  saveUnitWorkCalendar,
} from "@/server/calendar/unit-calendar";

function error(message: string): CalendarFormState {
  return { error: message, success: null };
}

export async function saveWorkCalendarAction(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const start = timeToMinute(String(formData.get("workStart") ?? ""));
  const end = timeToMinute(String(formData.get("workEnd") ?? ""));
  if (start === null || end === null) {
    return error(t("screens.calendar.invalidWorkingHours"));
  }

  const parsed = workCalendarSchema.safeParse({
    workingDays: formData.getAll("workingDays"),
    workStartMinute: start,
    workEndMinute: end,
  });

  if (!parsed.success) {
    return error(localizeValidationIssue(t, parsed.error.issues[0]));
  }

  await saveWorkCalendar(prisma, parsed.data, me.id);
  revalidatePath("/admin/calendar");

  return { error: null, success: t("screens.calendar.saved") };
}

export async function addHolidayAction(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = holidaySchema.safeParse({
    date: formData.get("date"),
    description: formData.get("description"),
  });

  if (!parsed.success) {
    return error(localizeValidationIssue(t, parsed.error.issues[0]));
  }

  const result = await addHoliday(prisma, parsed.data, me.id);
  if (!result.ok) return error(localizeServiceMessage(t, "calendar", result));

  revalidatePath("/admin/calendar");
  return {
    error: null,
    success: t("screens.calendar.holidayAdded", { date: parsed.data.date }),
  };
}

export async function removeHolidayAction(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const date = String(formData.get("date") ?? "");
  const removed = await removeHoliday(prisma, date, me.id);

  // A missing record must not be reported as a silent success.
  if (!removed) return error(t("screens.calendar.holidayNotFound"));

  revalidatePath("/admin/calendar");
  return {
    error: null,
    success: t("screens.calendar.holidayRemoved", { date }),
  };
}

/**
 * Unit-specific work window (Task 11.9).
 *
 * Only system administrators can change it (product decision, 2026-08-21).
 * The work window controls reminder timing for everyone in the unit.
 */
export async function saveUnitCalendarAction(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  await requireSystemAdmin();
  const t = await getTranslations();

  const orgUnitId = String(formData.get("orgUnitId") ?? "");
  if (!orgUnitId) return { error: t("screens.calendar.noUnitSelected"), success: null };

  // Inherit removes the unit's own definition and uses the parent's window.
  if (formData.get("inherit") === "on") {
    await clearUnitWorkCalendar(prisma, orgUnitId);
    revalidatePath("/admin/calendar");
    return {
      error: null,
      success: t("screens.calendar.unitCalendarInherited"),
    };
  }

  const days = [1, 2, 3, 4, 5, 6, 7].filter(
    (day) => formData.get(`day-${day}`) === "on",
  );
  if (days.length === 0) {
    return { error: t("screens.calendar.selectWorkingDay"), success: null };
  }

  const start = timeToMinute(String(formData.get("workStart") ?? ""));
  const bit = timeToMinute(String(formData.get("workEnd") ?? ""));
  if (start === null || bit === null) {
    return { error: t("screens.calendar.invalidWorkingHours"), success: null };
  }
  if (bit <= start) {
    return { error: t("screens.calendar.endAfterStart"), success: null };
  }

  await saveUnitWorkCalendar(prisma, orgUnitId, {
    workingDays: days,
    workStartMinute: start,
    workEndMinute: bit,
    worksOnHolidays: formData.get("worksOnHolidays") === "on",
  });

  revalidatePath("/admin/calendar");
  return { error: null, success: t("screens.calendar.unitCalendarSaved") };
}
