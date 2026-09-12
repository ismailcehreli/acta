import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { PermissionWarning } from "@/components/shell/permission-warning";
import { toShellUser } from "@/components/shell/shell-user";
import { PageHeader } from "@/components/ui/page";
import { getTranslations } from "@/server/i18n/server";
import { getLocale } from "@/server/i18n/locale";
import type { TranslateFunction } from "@/shared/i18n";
import { getCurrentUser } from "@/server/auth/current-user";
import { visibleReportScope } from "@/server/authz/visibility";
import { prisma } from "@/server/db";
import {
  narrowReportScope,
  readReportForScope,
  REPORT_PERIODS,
  type ReportPeriod,
  type ReportTab,
} from "@/server/reports/read";

import { ReportPageFrame, ReportsView, type ReportTabOption } from "./report-view";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await getLocale();
  const t = await getTranslations(locale);
  return { title: t("screens.reports.title") };
}

const REPORT_TABS = [
  {
    value: "activities",
    labelKey: "screens.reports.activityTab",
    hintKey: "screens.reports.activityHint",
  },
  {
    value: "absence",
    labelKey: "screens.reports.absenceTab",
    hintKey: "screens.reports.absenceHint",
  },
  {
    value: "notifications",
    labelKey: "screens.reports.notificationsTab",
    hintKey: "screens.reports.notificationsHint",
  },
  {
    value: "scores",
    labelKey: "screens.reports.scoresTab",
    hintKey: "screens.reports.scoresHint",
  },
  {
    value: "feedback",
    labelKey: "screens.reports.feedbackTab",
    hintKey: "screens.reports.feedbackHint",
  },
] as const;

function parsePeriod(value: string | undefined): ReportPeriod {
  return REPORT_PERIODS.some((item) => item.value === value)
    ? (value as ReportPeriod)
    : "month";
}

function parseTab(value: string | undefined): ReportTab {
  switch (value) {
    case "absence":
    case "notifications":
    case "scores":
    case "feedback":
      return value;
    case "activities":
    default:
      return "activities";
  }
}

function tabOptions(
  user: { isSystemAdmin: boolean; canViewScoreReports: boolean },
  t: TranslateFunction,
): ReportTabOption[] {
  return REPORT_TABS.filter(
    (tab) =>
      (tab.value !== "scores" || user.canViewScoreReports) &&
      (tab.value !== "feedback" || user.isSystemAdmin),
  ).map((tab) => ({
    value: tab.value,
    label: t(tab.labelKey),
    hint: t(tab.hintKey),
  }));
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string; unit?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const locale = await getLocale();
  const t = await getTranslations(locale);

  const scope = await visibleReportScope(prisma, user.id);
  if (!scope) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.reports.permissionReports")}
      />
    );
  }

  const params = await searchParams;
  const period = parsePeriod(params.period);
  const tab = parseTab(params.tab);
  const selectedUnitId =
    tab === "feedback" ? undefined : params.unit?.trim() || undefined;
  const tabs = tabOptions(user, t);

  if (tab === "scores" && !scope.canViewScoreReports) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.reports.permissionScores")}
      />
    );
  }

  if (tab === "feedback" && !user.isSystemAdmin) {
    redirect("/reports");
  }

  if (selectedUnitId && !narrowReportScope(scope, selectedUnitId)) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.reports.permissionScope")}
      />
    );
  }

  const report = await readReportForScope(
    prisma,
    scope,
    tab,
    period,
    selectedUnitId,
    undefined,
    locale,
  );

  if (!report) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.reports.permissionTab")}
      />
    );
  }

  return (
    <AppShell user={await toShellUser(user)}>
      <ReportPageFrame report={report}>
        <PageHeader
          marker={t("screens.reports.marker")}
          title={t("screens.reports.title")}
          description={t("screens.reports.description", { unit: report.selectedScope.rootOrgUnitName })}
          breadcrumbs={[{ label: t("screens.reports.dashboard"), href: "/" }, { label: t("screens.reports.title") }]}
        />
        <ReportsView
          report={report}
          tabs={tabs}
          tab={tab}
          period={period}
          locale={locale}
          selectedUnitId={selectedUnitId}
        />
      </ReportPageFrame>
    </AppShell>
  );
}
