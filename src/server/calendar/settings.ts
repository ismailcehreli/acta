import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import { MESAI_PENCERESI_KILIDI } from "./unit-calendar";

import { toDateValue } from "@/server/activities/date-rules";
import type { HolidayInput, WorkCalendarInput } from "@/shared/schemas/calendar";

// Çalışma takvimi yönetimi (§12.1, §16.5). Takvim şirket genelinde tek
// kayıttır; veritabanı da bunu zorlar (`WorkCalendar_singleton`, id = 1).

/** Yalnız okuma yapan yollar için; işleyici denetim kaydı yazmaz. */
export type CalendarReadDb = Pick<PrismaClient, "workCalendar" | "holiday">;

/** Yazma yolları denetim kaydı da bırakır (§15.2). */
export type CalendarDb = CalendarReadDb &
  Pick<PrismaClient, "auditLog" | "$transaction" | "$executeRaw">;

/** Kayıt yoksa kullanılan başlangıç değerleri: hafta içi 08:30–17:30. */
export const DEFAULT_WORK_CALENDAR: WorkCalendarInput = {
  workingDays: [1, 2, 3, 4, 5],
  workStartMinute: 8 * 60 + 30,
  workEndMinute: 17 * 60 + 30,
};

export async function readWorkCalendar(
  db: CalendarReadDb,
): Promise<WorkCalendarInput> {
  const row = await db.workCalendar.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULT_WORK_CALENDAR;

  return {
    workingDays: [...row.workingDays].sort((a, b) => a - b),
    workStartMinute: row.workStartMinute,
    workEndMinute: row.workEndMinute,
  };
}

export async function saveWorkCalendar(
  db: CalendarDb,
  input: WorkCalendarInput,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<WorkCalendarInput> {
  const workingDays = [...new Set(input.workingDays)].sort((a, b) => a - b);

  // Şirket varsayılanı da devralınan pencerenin kaynağı olabiliyor: birim
  // taşımanın onayladığı değeri bu yazı da değiştirebilir, o yüzden aynı
  // kilide katılıyor (P4-1).
  const row = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${MESAI_PENCERESI_KILIDI}))`;

    return tx.workCalendar.upsert({
      where: { id: 1 },
      update: {
        workingDays,
        workStartMinute: input.workStartMinute,
        workEndMinute: input.workEndMinute,
      },
      create: {
        id: 1,
        workingDays,
        workStartMinute: input.workStartMinute,
        workEndMinute: input.workEndMinute,
      },
    });
  });

  await recordAudit(db, {
    userId: actorId,
    objectType: AUDIT_OBJECTS.setting,
    objectId: "work_calendar",
    action: AUDIT_ACTIONS.workCalendarChanged,
    detail: {
      workingDays: row.workingDays,
      workStartMinute: row.workStartMinute,
      workEndMinute: row.workEndMinute,
    },
    now,
  });

  return {
    workingDays: row.workingDays,
    workStartMinute: row.workStartMinute,
    workEndMinute: row.workEndMinute,
  };
}

export interface HolidayView {
  date: string;
  description: string;
}

/** Belirtilen yılın tatilleri; yıl verilmezse tamamı. */
export async function listHolidays(
  db: CalendarReadDb,
  year?: number,
): Promise<HolidayView[]> {
  const rows = await db.holiday.findMany({
    where:
      year === undefined
        ? undefined
        : {
            date: {
              gte: toDateValue(`${year}-01-01`),
              lte: toDateValue(`${year}-12-31`),
            },
          },
    orderBy: { date: "asc" },
  });

  return rows.map((row) => ({
    date: row.date.toISOString().slice(0, 10),
    description: row.description,
  }));
}

export type HolidayResult =
  | { ok: true; holiday: HolidayView }
  | { ok: false; error: "already_exists"; message: string };

export async function addHoliday(
  db: CalendarDb,
  input: HolidayInput,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<HolidayResult> {
  const date = toDateValue(input.date);

  const existing = await db.holiday.findUnique({ where: { date } });
  if (existing) {
    return {
      ok: false,
      error: "already_exists",
      message: "Bu tarih zaten tatil olarak tanımlı.",
    };
  }

  const created = await db.holiday.create({
    data: { date, description: input.description },
  });

  await recordAudit(db, {
    userId: actorId,
    objectType: AUDIT_OBJECTS.setting,
    objectId: `holiday:${input.date}`,
    action: AUDIT_ACTIONS.holidayAdded,
    detail: { date: input.date },
    now,
  });

  return {
    ok: true,
    holiday: {
      date: created.date.toISOString().slice(0, 10),
      description: created.description,
    },
  };
}

/**
 * Tatil kaydını kaldırır. Tatil bir iş kaydı değil, yapılandırmadır: yanlış
 * girilen bir tarih düzeltilebilmeli (§16.6'daki silme yasağı faaliyet,
 * kullanıcı ve birim içindir; veritabanı da bu tabloda silmeyi engellemez).
 */
export async function removeHoliday(
  db: CalendarDb,
  date: string,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<boolean> {
  const silinen = await db.holiday.deleteMany({
    where: { date: toDateValue(date) },
  });

  if (silinen.count === 0) return false;

  await recordAudit(db, {
    userId: actorId,
    objectType: AUDIT_OBJECTS.setting,
    objectId: `holiday:${date}`,
    action: AUDIT_ACTIONS.holidayRemoved,
    detail: { date },
    now,
  });

  return true;
}
