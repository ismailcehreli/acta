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
  it("veritabanı yanıt verirse ok döner ve gecikmeyi ölçer", async () => {
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

  it("veritabanı hata verirse down döner ve hatayı taşır", async () => {
    const report = await buildHealthReport({
      pingDatabase: async () => {
        throw new Error("bağlantı reddedildi");
      },
      now: fixedClock(Date.UTC(2026, 7, 17, 12, 0, 0)),
    });

    expect(report.status).toBe("down");
    expect(report.database.status).toBe("down");
    expect(report.database.latencyMs).toBeNull();
    expect(report.database.error).toBe("bağlantı reddedildi");
  });

  // Ölçüm sağlayıcısı verilmezse alanlar `placeholder` kalır: izleme tarafı
  // ölçülmemiş bir değeri ölçülmüş sanmasın. Gerçek ölçümler Görev 5.6'da
  // bağlandı ve `tests/jobs/status.test.ts` içinde sınanıyor.
  it("ölçüm sağlayıcısı yoksa alanlar placeholder kalır", async () => {
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

describe("dışarıya verilen rapor", () => {
  it("veritabanı hata metnini dışarı sızdırmaz", async () => {
    const report = await buildHealthReport({
      pingDatabase: async () => {
        throw new Error(
          "Can't reach database server at `postgres:5432` (kullanıcı: faaliyet)",
        );
      },
      now: fixedClock(Date.UTC(2026, 7, 17, 12, 0, 0)),
    });

    const publicReport = toPublicReport(report);

    expect(report.database.error).toContain("postgres:5432");
    expect(JSON.stringify(publicReport)).not.toContain("postgres:5432");
    expect(publicReport.database).not.toHaveProperty("error");
    // Durum bilgisi yine dışarı verilir; izleme sistemi arızayı görebilmeli.
    expect(publicReport.status).toBe("down");
  });
});
