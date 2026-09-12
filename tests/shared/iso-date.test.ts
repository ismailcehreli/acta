import { describe, expect, it } from "vitest";

import { absenceDateSchema } from "@/shared/schemas/absence";
import { activityDateSchema } from "@/shared/schemas/activity";
import { isCalendarDay } from "@/shared/schemas/iso-date";


//



//



describe("isCalendarDay", () => {
  it("accepts real calendar days", () => {
    for (const day of ["2026-01-01", "2026-08-21", "2026-12-31", "2024-02-29"]) {
      expect(isCalendarDay(day)).toBe(true);
    }
  });

  it("rejects days that do not exist in the calendar", () => {

    expect(isCalendarDay("2026-02-31")).toBe(false);

    expect(isCalendarDay("2026-02-29")).toBe(false);

    expect(isCalendarDay("2026-04-31")).toBe(false);
  });

  it("rejects invalid month and day numbers", () => {
    for (const day of ["2026-00-10", "2026-13-01", "2026-08-00", "2026-08-32"]) {
      expect(isCalendarDay(day)).toBe(false);
    }
  });

  it("rejects malformed values", () => {
    for (const day of ["2026-8-21", "21.08.2026", "2026-99-99", "", "today"]) {
      expect(isCalendarDay(day)).toBe(false);
    }
  });
});

describe("schemas with date fields use the same rule", () => {
  it("activity dates", () => {
    expect(activityDateSchema.safeParse("2026-02-31").success).toBe(false);
    expect(activityDateSchema.safeParse("2026-08-21").success).toBe(true);
  });

  it("leave dates", () => {
    expect(absenceDateSchema.safeParse("2026-04-31").success).toBe(false);
    expect(absenceDateSchema.safeParse("2026-04-30").success).toBe(true);
  });
});


describe("title and description have no higher minimum", () => {
  it("a two-character title is accepted", async () => {
    const { activityTitleSchema, activityDescriptionSchema, DEFAULT_TEXT_LIMITS } =
      await import("@/shared/schemas/activity");



    expect(activityTitleSchema(DEFAULT_TEXT_LIMITS).safeParse("HR").success).toBe(true);
    expect(
      activityDescriptionSchema(DEFAULT_TEXT_LIMITS).safeParse("OK").success,
    ).toBe(true);
  });

  it("an empty value is still rejected", async () => {
    const { activityTitleSchema, DEFAULT_TEXT_LIMITS } = await import(
      "@/shared/schemas/activity"
    );

    expect(activityTitleSchema(DEFAULT_TEXT_LIMITS).safeParse("   ").success).toBe(
      false,
    );
  });
});
