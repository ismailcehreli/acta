import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { toShellUser } from "@/components/shell/shell-user";
import { PageHeader } from "@/components/ui/page";
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

export const metadata = { title: "Raporlar" };
export const dynamic = "force-dynamic";

const REPORT_TABS: ReportTabOption[] = [
  {
    value: "activities",
    label: "Faaliyet özeti",
    hint: "iş akışı",
  },
  {
    value: "absence",
    label: "İzin özeti",
    hint: "planlama",
  },
  {
    value: "notifications",
    label: "Bildirim durumu",
    hint: "iletişim",
  },
  {
    value: "scores",
    label: "Skor ve takdir",
    hint: "gelişim",
  },
  {
    value: "feedback",
    label: "Geri bildirim özeti",
    hint: "iyileştirme",
  },
];

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

function tabOptions(user: { isSystemAdmin: boolean; canViewScoreReports: boolean }): ReportTabOption[] {
  return REPORT_TABS.filter(
    (tab) =>
      (tab.value !== "scores" || user.canViewScoreReports) &&
      (tab.value !== "feedback" || user.isSystemAdmin),
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ sekme?: string; donem?: string; birim?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const scope = await visibleReportScope(prisma, user.id);
  if (!scope) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Toplu raporları görmek için sistem yöneticisinin size raporlama yetkisi vermesi gerekir."
      />
    );
  }

  const params = await searchParams;
  const period = parsePeriod(params.donem);
  const tab = parseTab(params.sekme);
  const selectedUnitId =
    tab === "feedback" ? undefined : params.birim?.trim() || undefined;
  const tabs = tabOptions(user);

  if (tab === "scores" && !scope.canViewScoreReports) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Skor ve takdir raporlarını görmek için ayrıca skor raporu yetkisi gerekir."
      />
    );
  }

  if (tab === "feedback" && !user.isSystemAdmin) {
    redirect("/reports");
  }

  if (selectedUnitId && !narrowReportScope(scope, selectedUnitId)) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Seçtiğiniz birim sizin rapor kapsamınızda değil."
      />
    );
  }

  const report = await readReportForScope(
    prisma,
    scope,
    tab,
    period,
    selectedUnitId,
  );

  if (!report) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Bu rapor için gerekli yetki bulunmuyor."
      />
    );
  }

  return (
    <AppShell user={await toShellUser(user)}>
      <ReportPageFrame report={report}>
        <PageHeader
          marker="RAPORLAMA"
          title="Raporlar"
          description={`${report.selectedScope.rootOrgUnitName} ve alt birimleri için faaliyet, izin, bildirim ve gelişim göstergeleri. Bu sayılar yönetsel karar vermeyi kolaylaştırmak için hazırlanır.`}
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Raporlar" }]}
        />
        <ReportsView
          report={report}
          tabs={tabs}
          tab={tab}
          period={period}
          selectedUnitId={selectedUnitId}
        />
      </ReportPageFrame>
    </AppShell>
  );
}
