import { redirect } from "next/navigation";

import { AbsenceStatusBadge } from "@/components/absence/absence-status";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordField, RecordItem, RecordList } from "@/components/ui/table";
import { listAbsenceDeputies, listOwnAbsences } from "@/server/absence/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { subordinateUserIds } from "@/server/authz/visibility";
import { prisma } from "@/server/db";
import { getLocale } from "@/server/i18n/locale";
import { SETTING_KEYS, readNumericSetting } from "@/server/settings/system-settings";
import { formatDay, formatInstantShort, toDateValue } from "@/shared/format/date-time";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { CancelOwnAbsenceButton, MarkOwnAbsenceForm } from "./absence-forms";

function decisionRouteKey(route: string): string {
  return route === "DIRECT_ENTRY"
    ? "screens.absence.routeDirectEntry"
    : route === "DIRECT_MANAGER"
      ? "screens.absence.routeDirectManager"
      : route === "DEPUTY"
        ? "screens.absence.routeDeputy"
        : "screens.absence.routeUpperManager";
}




export async function generateMetadata() {
  return getLocalizedMetadata("screens.absence.pageTitle");
}

export default async function OwnAbsencePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  const [periods, maxSelfAbsenceDays, subordinates, deputyPeople] = await Promise.all([
    listOwnAbsences(prisma, user.id),
    readNumericSetting(prisma, SETTING_KEYS.selfAbsenceMaxDays),
    subordinateUserIds(prisma, user.id),
    listAbsenceDeputies(prisma, user.id),
  ]);

  return (
    <AppShell user={await toShellUser(user, subordinates)}>
      <Page>
        <PageHeader
          title={t("screens.absence.pageTitle")}
          description={t("screens.absence.pageDescription")}
          breadcrumbs={[{ label: t("screens.absence.dashboard"), href: "/" }, { label: t("screens.absence.pageTitle") }]}
        />

        <Card>
          <CardHeader
            title={t("screens.absence.addTitle")}
            description={t("screens.absence.addDescription")}
          />
          <CardBody>
            <MarkOwnAbsenceForm
              maxDays={maxSelfAbsenceDays}
              deputyPeople={user.isUnitManager ? deputyPeople : []}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("screens.absence.listTitle")}
            description={t("screens.absence.listDescription")}
          />

          {periods.length === 0 ? (
            <EmptyState
              title={t("screens.absence.noRecords")}
              description={t("screens.absence.noRecordsDescription")}
            />
          ) : (
            <RecordList>
              {periods.map((period) => {
                const cancelled = period.cancelledReason !== null;

                return (
                  <RecordItem key={period.id} data-test="own-period-row">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p
                          className={
                            cancelled
                              ? "font-medium text-faint line-through"
                              : "font-medium text-ink"
                          }
                        >
                          {formatDay(toDateValue(period.startDate), locale)} –{" "}
                          {formatDay(toDateValue(period.endDate), locale)}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {cancelled ? (
                            <Badge tone="cancelled">{t("screens.absence.cancelled")}</Badge>
                          ) : (
                            <AbsenceStatusBadge status={period.status} />
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                          <RecordField label={t("screens.absence.enteredBy")}>
                            {period.markedBySelf ? t("screens.absence.self") : t("screens.absence.manager")}
                          </RecordField>
                          {period.note ? (
                            <RecordField label={t("screens.absence.note")}>{period.note}</RecordField>
                          ) : null}
                          {period.deputyName ? (
                            <RecordField label={t("screens.absence.deputy")}>{period.deputyName}</RecordField>
                          ) : null}
                          {period.decidedByName ? (
                            <RecordField
                              label={period.status === "REJECTED" ? t("screens.absence.rejectedBy") : t("screens.absence.approvedBy")}
                            >
                              {period.decidedByName}
                              {period.decisionRoute ? ` · ${t(decisionRouteKey(period.decisionRoute))}` : ""}
                            </RecordField>
                          ) : null}
                          {period.decidedAt ? (
                            <RecordField label={t("screens.absence.decisionTime")}>
                              {formatInstantShort(period.decidedAt, locale)}
                            </RecordField>
                          ) : null}
                        </div>
                        {cancelled ? (
                          <p className="mt-2 text-[length:var(--text-sm)] text-muted">
                            <span className="font-medium text-ink">
                              {t("screens.absence.cancellationReasonText")}
                            </span>{" "}
                            {period.cancelledReason}
                          </p>
                        ) : null}
                        {!cancelled && period.decisionReason ? (
                          <p className="mt-2 text-[length:var(--text-sm)] text-muted">
                            <span className="font-medium text-ink">
                              {t("screens.absence.managerExplanation")}
                            </span>{" "}
                            {period.decisionReason}
                          </p>
                        ) : null}
                      </div>

                      {cancelled || period.status === "REJECTED" ? null : (
                        <CancelOwnAbsenceButton id={period.id} />
                      )}
                    </div>
                  </RecordItem>
                );
              })}
            </RecordList>
          )}
        </Card>
      </Page>
    </AppShell>
  );
}
