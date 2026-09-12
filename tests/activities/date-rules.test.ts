import { describe, expect, it } from "vitest";

import {
  checkActivityDate,
  companyDay,
  toDateValue,
} from "@/server/activities/date-rules";

// Day calculations are based on the company's local time (§16.6). Since the
// server runs in UTC, this distinction is a real source of errors: 02:00 in
// Istanbul is still the previous day in UTC.

describe("company day", () => {
  it("advances local day in hours after UTC midnight", () => {
    // August 16 22:00 UTC = August 17 01:00 Istanbul.
    expect(companyDay(new Date("2026-08-16T22:00:00.000Z"))).toBe("2026-08-17");
  });

  it("stores start of day in UTC", () => {
    expect(toDateValue("2026-08-17").toISOString()).toBe(
      "2026-08-17T00:00:00.000Z",
    );
  });
});

describe("activity date boundary", () => {
  const now = new Date("2026-08-17T09:00:00.000Z");

  it("accepts today", () => {
    expect(checkActivityDate("2026-08-17", now, 1)).toBeNull();
  });

  it("accepts past day within allowed window", () => {
    expect(checkActivityDate("2026-08-16", now, 1)).toBeNull();
  });

  it("rejects past day outside window", () => {
    expect(checkActivityDate("2026-08-15", now, 1)).toBe("too_old");
  });

  it("rejects future date", () => {
    expect(checkActivityDate("2026-08-18", now, 1)).toBe("future");
  });

  it("shifts boundary back when window is enlarged", () => {
    // In a 7-day window, August 10 is on boundary, August 9 is outside.
    expect(checkActivityDate("2026-08-10", now, 7)).toBeNull();
    expect(checkActivityDate("2026-08-09", now, 7)).toBe("too_old");
  });

  it("determines by local day even close to midnight", () => {
    // August 17 21:30 UTC = August 18 00:30 Istanbul; at that moment "today" is 18.
    const midnight = new Date("2026-08-17T21:30:00.000Z");
    expect(checkActivityDate("2026-08-18", midnight, 1)).toBeNull();
    expect(checkActivityDate("2026-08-16", midnight, 1)).toBe("too_old");
  });
});
