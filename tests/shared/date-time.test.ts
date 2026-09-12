import { describe, expect, it } from "vitest";

import {
  companyHour,
  companyMinuteOfDay,
  formatDay,
  formatDayLong,
  formatDayShort,
  formatInstant,
  formatInstantPrecise,
  formatInstantShort,
  formatRelativeDay,
  formatTime,
  formatWeekday,
} from "@/shared/format/date-time";

const dateValue = (day: string) => new Date(`${day}T00:00:00.000Z`);

describe("formatDay", () => {
  it("formats a date-only value in the default locale", () => {
    expect(formatDay(dateValue("2026-08-21"))).toBe("08/21/2026");
  });

  it("zero-pads a single-digit day and month", () => {
    expect(formatDay(dateValue("2026-01-05"))).toBe("01/05/2026");
  });

  it("does not shift a date-only value at the start of the year", () => {
    expect(formatDay(dateValue("2026-01-01"))).toBe("01/01/2026");
  });

  it("uses the requested secondary locale", () => {
    expect(formatDay(dateValue("2026-08-21"), "tr")).toBe("21.08.2026");
  });
});

describe("formatDayLong", () => {
  it("includes the weekday, month, and year", () => {
    expect(formatDayLong(dateValue("2026-08-21"))).toBe(
      "Friday, August 21, 2026",
    );
  });

  it("uses the requested secondary locale", () => {
    expect(formatDayLong(dateValue("2026-08-21"), "tr")).toBe(
      "21 Ağustos 2026 Cuma",
    );
  });
});

describe("formatDayShort", () => {
  it("formats a compact date", () => {
    expect(formatDayShort(dateValue("2026-08-21"))).toBe("Aug 21");
    expect(formatDayShort(dateValue("2026-08-21"), "tr")).toBe("21 Ağu");
  });
});

describe("formatInstant", () => {
  it("formats a timestamp in the company time zone", () => {
    expect(formatInstant(new Date("2026-08-21T11:32:00.000Z"))).toBe(
      "08/21/2026 14:32",
    );
  });

  it("moves a timestamp after midnight to the next local day", () => {
    expect(formatInstant(new Date("2026-08-21T21:30:00.000Z"))).toBe(
      "08/22/2026 00:30",
    );
  });
});

describe("formatTime", () => {
  it("formats the local time in 24-hour notation", () => {
    expect(formatTime(new Date("2026-08-21T11:32:00.000Z"))).toBe("14:32");
    expect(formatTime(new Date("2026-08-21T17:05:00.000Z"))).toBe("20:05");
  });
});

describe("formatRelativeDay", () => {
  const now = new Date("2026-08-21T09:00:00.000Z");

  it("uses English relative-day labels by default", () => {
    expect(formatRelativeDay(dateValue("2026-08-21"), now)).toBe("Today");
    expect(formatRelativeDay(dateValue("2026-08-20"), now)).toBe("Yesterday");
    expect(formatRelativeDay(dateValue("2026-08-19"), now)).toBe("08/19/2026");
  });

  it("supports translated relative-day labels", () => {
    expect(
      formatRelativeDay(dateValue("2026-08-21"), now, "tr", {
        today: "Bugün",
        yesterday: "Dün",
      }),
    ).toBe("Bugün");
    expect(
      formatRelativeDay(dateValue("2026-08-20"), now, "tr", {
        today: "Bugün",
        yesterday: "Dün",
      }),
    ).toBe("Dün");
  });

  it("uses the company day when the server is still on the previous UTC day", () => {
    const afterMidnight = new Date("2026-08-21T21:30:00.000Z");
    expect(formatRelativeDay(dateValue("2026-08-22"), afterMidnight)).toBe("Today");
  });
});

describe("formatInstantShort", () => {
  it("formats a compact timestamp", () => {
    expect(formatInstantShort(new Date("2026-08-21T11:32:00.000Z"))).toBe(
      "Aug 21 14:32",
    );
    expect(formatInstantShort(new Date("2026-08-21T21:30:00.000Z"))).toBe(
      "Aug 22 00:30",
    );
  });
});

describe("formatInstantPrecise", () => {
  it("includes seconds for audit records", () => {
    expect(formatInstantPrecise(new Date("2026-08-21T11:32:07.000Z"))).toBe(
      "08/21/2026 14:32:07",
    );
  });
});

describe("companyHour", () => {
  it("returns the hour in the company time zone", () => {
    expect(companyHour(new Date("2026-08-21T11:32:00.000Z"))).toBe(14);
    expect(companyHour(new Date("2026-08-21T21:30:00.000Z"))).toBe(0);
    expect(companyHour(new Date("2026-08-21T06:15:00.000Z"))).toBe(9);
  });
});

describe("formatWeekday", () => {
  it("formats weekdays in the default and secondary locales", () => {
    expect(formatWeekday(dateValue("2026-08-21"))).toBe("Friday");
    expect(formatWeekday(dateValue("2026-08-21"), "tr")).toBe("Cuma");
    expect(formatWeekday(dateValue("2026-08-23"))).toBe("Sunday");
    expect(formatWeekday(dateValue("2026-08-23"), "tr")).toBe("Pazar");
  });
});

describe("companyMinuteOfDay", () => {
  it("returns minutes since midnight in the company time zone", () => {
    expect(companyMinuteOfDay(new Date("2026-08-21T11:32:00.000Z"))).toBe(872);
    expect(companyMinuteOfDay(new Date("2026-08-21T21:00:00.000Z"))).toBe(0);
  });
});
