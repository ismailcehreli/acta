import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addHoliday,
  DEFAULT_WORK_CALENDAR,
  listHolidays,
  readWorkCalendar,
  removeHoliday,
  saveWorkCalendar,
} from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import { minuteToTime, timeToMinute } from "@/shared/schemas/calendar";

import { resetDatabase, testDb } from "../helpers/test-db";

// Çalışma takvimi §12.1: şirket genelinde **tek** tanım. Vardiya, geceye taşan
// mesai ve kişi bazlı takvim v3'te kaldırıldı; burada da yoktur.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("çalışma takvimi", () => {
  it("kayıt yokken hafta içi varsayılanı döner", async () => {
    expect(await readWorkCalendar(testDb)).toEqual(DEFAULT_WORK_CALENDAR);
  });

  it("kaydedilir ve geri okunur", async () => {
    await saveWorkCalendar(testDb, {
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 9 * 60,
      workEndMinute: 18 * 60,
    });

    expect(await readWorkCalendar(testDb)).toEqual({
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 540,
      workEndMinute: 1080,
    });
  });

  it("ikinci kayıt yenisini eklemez, mevcudu günceller", async () => {
    await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);
    await saveWorkCalendar(testDb, {
      ...DEFAULT_WORK_CALENDAR,
      workingDays: [1, 2, 3],
    });

    expect(await testDb.workCalendar.count()).toBe(1);
    expect((await readWorkCalendar(testDb)).workingDays).toEqual([1, 2, 3]);
  });

  it("günler sıralı ve tekil saklanır", async () => {
    await saveWorkCalendar(testDb, {
      ...DEFAULT_WORK_CALENDAR,
      workingDays: [5, 1, 3, 1],
    });

    expect((await readWorkCalendar(testDb)).workingDays).toEqual([1, 3, 5]);
  });

  it("ikinci bir takvim kaydı veritabanınca reddedilir", async () => {
    await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);

    await expect(
      testDb.workCalendar.create({
        data: { id: 2, workingDays: [1], workStartMinute: 0, workEndMinute: 60 },
      }),
    ).rejects.toThrow(/WorkCalendar_singleton/);
  });
});

describe("tatil listesi", () => {
  it("eklenir ve tarihe göre sıralı döner", async () => {
    await addHoliday(testDb, { date: "2026-10-29", description: "Cumhuriyet Bayramı" });
    await addHoliday(testDb, { date: "2026-08-30", description: "Zafer Bayramı" });

    expect(await listHolidays(testDb)).toEqual([
      { date: "2026-08-30", description: "Zafer Bayramı" },
      { date: "2026-10-29", description: "Cumhuriyet Bayramı" },
    ]);
  });

  it("aynı tarih iki kez eklenemez", async () => {
    await addHoliday(testDb, { date: "2026-10-29", description: "Cumhuriyet Bayramı" });

    const sonuc = await addHoliday(testDb, {
      date: "2026-10-29",
      description: "Tekrar",
    });

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("already_exists");
    expect(await testDb.holiday.count()).toBe(1);
  });

  it("yanlış girilen tatil kaldırılabilir", async () => {
    await addHoliday(testDb, { date: "2026-10-29", description: "Yanlış" });

    expect(await removeHoliday(testDb, "2026-10-29")).toBe(true);
    expect(await listHolidays(testDb)).toEqual([]);
    // Olmayan tarihin kaldırılması sessizce başarılı sayılmaz.
    expect(await removeHoliday(testDb, "2026-10-29")).toBe(false);
  });

  it("yıla göre süzülür", async () => {
    await addHoliday(testDb, { date: "2026-10-29", description: "2026" });
    await addHoliday(testDb, { date: "2027-01-01", description: "2027" });

    expect(await listHolidays(testDb, 2026)).toHaveLength(1);
  });

  it("iş günü hesabı bu tatilleri kullanır", async () => {
    await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);
    await addHoliday(testDb, { date: "2026-08-19", description: "Deneme" });

    const takvim = await loadWorkCalendar(
      testDb,
      new Date("2026-08-17T00:00:00.000Z"),
      new Date("2026-08-21T00:00:00.000Z"),
    );

    expect(takvim.holidays).toContain("2026-08-19");
    expect(takvim.workingDays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("saat gösterimi", () => {
  it("dakika ile metin arasında gidip gelir", () => {
    expect(minuteToTime(510)).toBe("08:30");
    expect(minuteToTime(0)).toBe("00:00");
    expect(timeToMinute("08:30")).toBe(510);
    expect(timeToMinute("17:30")).toBe(1050);
  });

  it("bozuk metin sayıya çevrilmez", () => {
    for (const bozuk of ["", "8", "08:60", "25:00", "abc"]) {
      expect(timeToMinute(bozuk)).toBeNull();
    }
  });
});
