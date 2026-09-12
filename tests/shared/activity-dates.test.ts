import { describe, expect, it } from "vitest";

import { describeActivityDates } from "@/shared/format/activity-dates";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const baseInput = {
  activityDate: day("2026-08-21"),
  createdAt: new Date("2026-08-21T11:32:00.000Z"),
  updatedAt: new Date("2026-08-21T11:32:00.000Z"),
  revisionNo: 1,
};

describe("describeActivityDates", () => {
  it("shows the full saved timestamp when the dates differ", () => {
    const result = describeActivityDates({
      ...baseInput,
      activityDate: day("2026-08-19"),
    });

    expect(result.main).toBe("08/19/2026");
    expect(result.created).toBe("Saved: 08/21/2026 14:32");
  });

  it("shows only the time when the activity and saved dates match", () => {
    const result = describeActivityDates(baseInput);

    expect(result.main).toBe("08/21/2026");
    expect(result.created).toBe("Saved: 14:32");
  });

  it("uses the company day when creation crosses midnight", () => {
    const result = describeActivityDates({
      ...baseInput,
      createdAt: new Date("2026-08-21T21:30:00.000Z"),
      updatedAt: new Date("2026-08-21T21:30:00.000Z"),
    });

    expect(result.created).toBe("Saved: 08/22/2026 00:30");
  });

  it("does not show a revision line for the first record", () => {
    expect(describeActivityDates(baseInput).revised).toBeNull();
  });

  it("shows the latest revision and supports translated labels", () => {
    const result = describeActivityDates(
      {
        ...baseInput,
        updatedAt: new Date("2026-08-21T13:10:00.000Z"),
        revisionNo: 2,
      },
      "tr",
      { saved: "Kaydedildi", lastEdited: "Son düzeltme" },
    );

    expect(result.revised).toBe("Son düzeltme: 21.08.2026 16:10 (rev. 2)");
  });
});
