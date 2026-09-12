import type { OperationsSummary } from "@/server/dashboard/summary";
import { getTranslations } from "@/server/i18n/server";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";


//





function formatBackupAge(
  hours: number | null,
  monitoringEnabled: boolean,
  t: Awaited<ReturnType<typeof getTranslations>>,
): { text: string; isProblematic: boolean } {
  if (!monitoringEnabled) return { text: t("dashboard.monitoringDisabled"), isProblematic: false };
  if (hours === null) return { text: t("dashboard.noBackupYet"), isProblematic: true };
  if (hours < 1) return { text: t("dashboard.lessThanHourAgo"), isProblematic: false };
  if (hours < 48) return { text: t("dashboard.hoursAgo", { count: hours }), isProblematic: false };
  return { text: t("dashboard.daysAgo", { count: Math.floor(hours / 24) }), isProblematic: true };
}

export async function OperationsBlock({ summary }: { summary: OperationsSummary }) {
  const t = await getTranslations();
  const backup = formatBackupAge(summary.backupAgeHours, summary.backupMonitoring, t);
  const hasIssue =
    summary.jobsDelayed > 0 || summary.queueFailed > 0 || backup.isProblematic;

  return (
    <Card data-test="system-status">
      <CardHeader
        title={t("dashboard.systemStatus")}
        description={t("dashboard.systemStatusDescription")}
        action={
          hasIssue ? (
            <Badge tone="correction">{t("dashboard.needsAttention")}</Badge>
          ) : (
            <Badge tone="success">{t("dashboard.everythingHealthy")}</Badge>
          )
        }
      />
      <CardBody className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wide)] text-muted uppercase">
              {t("dashboard.scheduledJob")}
            </dt>
            <dd
              className={
                summary.jobsDelayed > 0
                  ? "text-[length:var(--text-lg)] font-semibold tabular text-correction"
                  : "text-[length:var(--text-lg)] font-semibold tabular text-ink"
              }
            >
              {summary.jobsTotal - summary.jobsDelayed}/{summary.jobsTotal}
              <span className="ml-1 text-[length:var(--text-xs)] font-normal text-muted">
                {t("dashboard.running")}
              </span>
            </dd>
          </div>

          <div>
            <dt className="text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wide)] text-muted uppercase">
              {t("dashboard.pendingNotifications")}
            </dt>
            <dd className="text-[length:var(--text-lg)] font-semibold tabular text-ink">
              {summary.queuePending}
            </dd>
          </div>

          <div>
            <dt className="text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wide)] text-muted uppercase">
              {t("dashboard.failedNotifications")}
            </dt>
            <dd
              className={
                summary.queueFailed > 0
                  ? "text-[length:var(--text-lg)] font-semibold tabular text-danger"
                  : "text-[length:var(--text-lg)] font-semibold tabular text-ink"
              }
            >
              {summary.queueFailed}
            </dd>
          </div>

          <div>
            <dt className="text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wide)] text-muted uppercase">
              {t("dashboard.latestBackup")}
            </dt>
            <dd
              className={
                backup.isProblematic
                  ? "text-[length:var(--text-lg)] font-semibold text-correction"
                  : "text-[length:var(--text-lg)] font-semibold text-ink"
              }
            >
              {backup.text}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/admin/jobs" size="sm">
            {t("nav.jobs")}
          </ButtonLink>
          <ButtonLink href="/admin/audit" size="sm">
            {t("nav.audit")}
          </ButtonLink>
          <ButtonLink href="/admin/settings" size="sm">
            {t("nav.settings")}
          </ButtonLink>
        </div>
      </CardBody>
    </Card>
  );
}
