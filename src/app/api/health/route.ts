import { NextResponse } from "next/server";

import { prisma } from "@/server/db";
import { buildHealthReport, toPublicReport } from "@/server/health/report";
import { JOB_NAMES, listJobHealth, worstLagSeconds } from "@/server/jobs/status";
import { readBooleanSetting, SETTING_KEYS } from "@/server/settings/system-settings";

// Sağlık kontrolü her istekte gerçekten ölçüm yapmalı, önbellekten dönmemeli.
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await buildHealthReport({
    pingDatabase: () => prisma.$queryRaw`SELECT 1`,
    now: () => new Date(),
    queueDepth: () =>
      prisma.notificationQueue.count({ where: { status: "PENDING" } }),
    schedulerLag: async () => {
      const jobs = await listJobHealth(prisma, new Date());
      const backupMonitoring = await readBooleanSetting(
        prisma,
        SETTING_KEYS.backupMonitoringEnabled,
      );
      const monitoredJobs = jobs.filter(
        (job) => job.jobName !== JOB_NAMES.backup || backupMonitoring,
      );
      return {
        lagSeconds: worstLagSeconds(monitoredJobs),
        delayed: monitoredJobs.some((job) => job.delayed),
      };
    },
  });

  if (report.database.error) {
    // Ayrıntı yalnızca sunucu günlüğüne; dış cevap durum bilgisiyle sınırlı.
    console.error(`[health] veritabanı erişilemiyor: ${report.database.error}`);
  }

  return NextResponse.json(toPublicReport(report), {
    status: report.status === "ok" ? 200 : 503,
  });
}
