import { describe, expect, it } from "vitest";

import { buildHealthReport, toPublicReport } from "@/server/health/report";

function fixedClock(startMs: number, stepMs = 0) {
  let current = startMs;
  return () => {
    const value = new Date(current);
    current += stepMs;
    return value;
  };
}

describe("buildHealthReport", () => {
  it("returns ok and measures latency when database responds", async () => {
    const report = await buildHealthReport({
      pingDatabase: async () => [{ "?column?": 1 }],
      now: fixedClock(Date.UTC(2026, 7, 17, 12, 0, 0), 7),
    });

    expect(report.status).toBe("ok");
    expect(report.database.status).toBe("ok");
    expect(report.database.latencyMs).toBe(7);
    expect(report.database.error).toBeNull();
    expect(report.checkedAt).toBe("2026-08-17T12:00:00.014Z");
  });

  it("returns down and propagates error when database fails", async () => {
    const report = await buildHealthReport({
      pingDatabase: async () => {
        throw new Error("connection refused");
      },
      now: fixedClock(Date.UTC(2026, 7, 17, 12, 0, 0)),
    });

    expect(report.status).toBe("down");
    expect(report.database.status).toBe("down");
    expect(report.database.latencyMs).toBeNull();
    expect(report.database.error).toBe("connection refused");
  });

  // If no metric provider is given, fields remain placeholder so monitoring does not mistake unmeasured for measured.
  it("fields remain placeholder when no metric provider is supplied", async () => {
    const report = await buildHealthReport({
      pingDatabase: async () => 1,
      now: fixedClock(Date.UTC(2026, 7, 17, 12, 0, 0)),
    });

    expect(report.notificationQueue).toEqual({
      status: "ok",
      depth: null,
      source: "placeholder",
    });
    expect(report.scheduler).toEqual({
      status: "ok",
      lagSeconds: null,
      source: "placeholder",
    });
  });
});

describe("public health report", () => {
  it("does not leak database error message externally", async () => {
    const report = await buildHealthReport({
      pingDatabase: async () => {
        throw new Error(
          "Can't reach database server at `postgres:5432` (user: activity)",
        );
      },
      now: fixedClock(Date.UTC(2026, 7, 17, 12, 0, 0)),
    });

    const publicReport = toPublicReport(report);

    expect(report.database.error).toContain("postgres:5432");
    expect(JSON.stringify(publicReport)).not.toContain("postgres:5432");
    expect(publicReport.database).not.toHaveProperty("error");
    // Status is still exposed publicly so monitoring systems detect downtime.
    expect(publicReport.status).toBe("down");
  });
});
