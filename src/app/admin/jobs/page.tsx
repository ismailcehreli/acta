import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { listBackupRequests } from "@/server/backup/requests";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { PermissionWarning } from "@/components/shell/permission-warning";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader, Stat } from "@/components/ui/page";
import { AdminTabs } from "@/components/ui/admin-tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { JOB_NAMES, listJobHealth } from "@/server/jobs/status";
import { jobLabelKey } from "@/server/jobs/labels";
import { readSmtpView } from "@/server/settings/smtp";
import { readBooleanSetting, SETTING_KEYS } from "@/server/settings/system-settings";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { getLocale } from "@/server/i18n/locale";

import { BackupCard } from "./backup-card";


export async function generateMetadata() {
  return getLocalizedMetadata("screens.jobs.pageTitle");
}
export const dynamic = "force-dynamic";

const JOB_TABS = [
  { href: "/admin/jobs", key: "status" },
  { href: "/admin/jobs?tab=backups", key: "backups" },
  { href: "/admin/jobs?tab=notifications", key: "notifications" },
] as const;

function formatJobLag(lagSeconds: number | null, t: Awaited<ReturnType<typeof getTranslations>>): string {
  if (lagSeconds === null) return t("screens.jobs.neverRan");
  if (lagSeconds < 60) return t("screens.jobs.secondsAgo", { count: lagSeconds });

  const minutes = Math.floor(lagSeconds / 60);
  if (minutes < 60) return t("screens.jobs.minutesAgo", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("screens.jobs.hoursAgo", { count: hours });

  return t("screens.jobs.daysAgo", { count: Math.floor(hours / 24) });
}

export default async function JobsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  if (!canManageOrganization(user)) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.jobs.permission")}
      />
    );
  }

  const params = await searchParams;
  const tab = JOB_TABS.some((item) => item.key === params.tab)
    ? (params.tab as (typeof JOB_TABS)[number]["key"])
    : "status";
  const activeTab = JOB_TABS.find((item) => item.key === tab) ?? JOB_TABS[0];

  const now = new Date();
  const [jobs, pending, failed, smtp, backupMonitoringEnabled, backupRequests] = await Promise.all([
    listJobHealth(prisma, now),
    prisma.notificationQueue.count({ where: { status: "PENDING" } }),
    prisma.notificationQueue.count({ where: { status: "FAILED" } }),
    readSmtpView(prisma),
    readBooleanSetting(prisma, SETTING_KEYS.backupMonitoringEnabled),
    listBackupRequests(prisma, 50),
  ]);

  const overdueVar = jobs.some(
    (job) =>
      job.delayed &&
      (job.jobName !== JOB_NAMES.backup || backupMonitoringEnabled),
  );

  return (
    <AppShell
      user={await toShellUser(user)}
    >
      <Page>
        <PageHeader
          title={t("screens.jobs.pageTitle")}
          description={t("screens.jobs.pageDescription")}
          breadcrumbs={[{ label: t("screens.jobs.administration") }, { label: t("screens.jobs.pageTitle") }]}
          action={
            <div className="flex gap-2">
              <ButtonLink href="/admin/settings" size="sm">
                {t("screens.jobs.settingsLink")}
              </ButtonLink>
              <ButtonLink href="/api/health" size="sm">
                {t("screens.jobs.healthLink")}
              </ButtonLink>
            </div>
          }
        />

        <AdminNav isRoot={user.isRoot} />

        <AdminTabs
          tabs={JOB_TABS.map(({ href, key }) => ({
            href,
            label: t(
              key === "status"
                ? "screens.jobs.tabStatus"
                : key === "backups"
                  ? "screens.jobs.tabBackups"
                  : "screens.jobs.tabNotifications",
            ),
          }))}
          activeHref={activeTab.href}
        />

        {overdueVar ? (
          <div data-test="overdue-warning">
            <Alert tone="danger" title={t("screens.jobs.overdueTitle")}>
              {t("screens.jobs.overdueDescription")}
            </Alert>
          </div>
        ) : null}

        {smtp.source === "none" ? (
          <Alert
            tone="correction"
            title={t("screens.jobs.emailNotConfiguredTitle")}
            action={<ButtonLink href="/admin/settings/delivery" size="sm">{t("screens.jobs.openSettings")}</ButtonLink>}
          >
            {t("screens.jobs.emailNotConfiguredDescription")}
          </Alert>
        ) : null}

        {tab === "status" ? (
          <Card>
            <CardHeader
              title={t("screens.jobs.statusTitle")}
              description={t("screens.jobs.statusDescription")}
            />
            <Table label={t("screens.jobs.statusTable")}>
              <THead>
                <TR>
                  <TH>{t("screens.jobs.job")}</TH>
                  <TH>{t("screens.jobs.lastSuccessfulRun")}</TH>
                  <TH align="right">{t("screens.jobs.expectedInterval")}</TH>
                  <TH>{t("screens.jobs.status")}</TH>
                </TR>
              </THead>
              <TBody>
                {jobs.map((job) => (
                  <TR key={job.jobName} data-test={`job-${job.jobName}`}>
                    <TD className="font-medium">{t(jobLabelKey(job.jobName))}</TD>
                    <TD className="text-muted">{formatJobLag(job.lagSeconds, t)}</TD>
                    <TD align="right" className="tabular">
                      {formatLocalizedJobInterval(job.expectedIntervalMinutes, t)}
                    </TD>
                    <TD>
                      {job.jobName === JOB_NAMES.backup && !backupMonitoringEnabled ? (
                        <Badge tone="waiting">{t("screens.jobs.monitoringDisabled")}</Badge>
                      ) : (
                        <Badge tone={job.delayed ? "danger" : "success"}>
                          {job.delayed ? t("screens.jobs.delayed") : t("screens.jobs.running")}
                        </Badge>
                      )}
                      {job.lastError ? (
                        <p className="mt-1 text-[length:var(--text-xs)] text-danger">
                          {job.lastError}
                        </p>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        ) : null}

        {tab === "backups" ? (
          <BackupCard
            active={
              backupRequests.find(
                (request) => request.status === "PENDING" || request.status === "RUNNING",
              ) ?? null
            }
            history={backupRequests.slice(0, 10)}
          />
        ) : null}

        {tab === "notifications" ? (
          <Card>
            <CardHeader title={t("screens.jobs.tabNotifications")} />
            <CardBody className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-6 sm:max-w-md">
                <Stat label={t("screens.jobs.pendingCount")} value={pending} />
                <Stat
                  label={t("screens.jobs.failedCount")}
                  value={failed}
                  tone={failed > 0 ? "correction" : "neutral"}
                />
              </div>
              {failed > 0 ? (
                <Alert tone="correction">{t("screens.jobs.failedDescription")}</Alert>
              ) : null}
            </CardBody>
          </Card>
        ) : null}
      </Page>
    </AppShell>
  );
}

function formatLocalizedJobInterval(
  minutes: number,
  t: Awaited<ReturnType<typeof getTranslations>>,
): string {
  const minuteCount = minutes % 60;
  const hourCount = Math.floor(minutes / 60);
  const minuteKey = minuteCount === 1 ? "minute" : "minutes";
  const hourKey = hourCount === 1 ? "hour" : "hours";

  if (minutes < 60) {
    return `${minutes} ${t(`screens.jobs.intervalUnits.${minuteKey}`)}`;
  }
  if (minuteCount === 0) {
    return `${hourCount} ${t(`screens.jobs.intervalUnits.${hourKey}`)}`;
  }
  return `${hourCount} ${t(`screens.jobs.intervalUnits.${hourKey}`)} ${minuteCount} ${t(`screens.jobs.intervalUnits.${minuteKey}`)}`;
}
