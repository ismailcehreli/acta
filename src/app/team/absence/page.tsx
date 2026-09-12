import { redirect } from "next/navigation";

import { AbsenceStatusBadge } from "@/components/absence/absence-status";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordField, RecordItem, RecordList } from "@/components/ui/table";
import {
  countTeamAbsences,
  departmentEmployeeIds,
  listTeamAbsences,
  subordinateManagerIds,
  type AbsenceFilters,
  visibleAbsenceUserIds,
} from "@/server/absence/service";
import { resolvePageSize } from "@/server/preferences/page-size";
import { FilterBar } from "@/components/filters/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { getCurrentUser } from "@/server/auth/current-user";
import { subordinateUserIds } from "@/server/authz/visibility";
import { prisma } from "@/server/db";
import { getLocale } from "@/server/i18n/locale";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import {
  AbsenceDecisionActions,
  CancelAbsenceButton,
  MarkAbsenceForm,
} from "./absence-forms";
import {
  formatDay,
  formatInstantShort,
  toDateValue,
} from "@/shared/format/date-time";




export async function generateMetadata() {
  return getLocalizedMetadata("screens.teamAbsence.pageTitle");
}

function decisionRouteKey(route: string): string {
  return route === "DIRECT_ENTRY"
    ? "screens.absence.routeDirectEntry"
    : route === "DIRECT_MANAGER"
      ? "screens.absence.routeDirectManager"
      : route === "DEPUTY"
        ? "screens.absence.routeDeputy"
        : "screens.absence.routeUpperManager";
}

function dayLabel(
  date: string,
  locale: Parameters<typeof formatDay>[1],
): string {
  return formatDay(toDateValue(date), locale);
}

export default async function TeamAbsencePage({
  searchParams,
}: {
  searchParams: Promise<{
    person?: string;
    status?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const now = new Date();
  const [
    subordinates,
    departmentEmployees,
    visibleUserIds,
    delegatedManagerIds,
  ] = await Promise.all([
    subordinateUserIds(prisma, viewer.id),
    departmentEmployeeIds(prisma, viewer.id),
    visibleAbsenceUserIds(prisma, viewer.id, now),
    subordinateManagerIds(prisma, viewer.id),
  ]);

  const params = await searchParams;

  const filters: AbsenceFilters = {
    userId: params.person || undefined,
    status:
      params.status === "active"
        ? "active"
        : params.status === "pending"
          ? "pending"
          : params.status === "rejected"
            ? "rejected"
            : params.status === "cancelled"
              ? "cancelled"
              : undefined,
  };

  const pageSize = await resolvePageSize(params.pageSize);
  const requested = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requested) && requested > 0 ? requested : 1;

  const [people, visiblePeople, managerPeople, total] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: departmentEmployees }, isActive: true },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    }),
    prisma.user.findMany({
      where: { id: { in: visibleUserIds }, isActive: true },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    }),
    prisma.user.findMany({
      where: {
        id: { in: delegatedManagerIds.filter((id) => id !== viewer.id) },
        isActive: true,
        isUnitManager: true,
      },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    }),
    countTeamAbsences(prisma, viewer.id, visibleUserIds, filters, now),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);

  const absences = await listTeamAbsences(
    prisma,
    viewer.id,
    visibleUserIds,
    filters,
    { limit: pageSize, skip: (currentPage - 1) * pageSize, now },
  );

  const address = (attachment: Record<string, string> = {}) =>
    buildQueryAddress(
      "/team/absence",
      { person: params.person, status: params.status, pageSize: String(pageSize) },
      attachment,
    );

  const isFiltered = Boolean(params.person) || Boolean(params.status);

  return (
    <AppShell
      user={await toShellUser(user, subordinates)}
    >
      <Page marker="team-leave">
        <PageHeader
          title={t("screens.teamAbsence.pageTitle")}
          description={t("screens.teamAbsence.pageDescription")}
          breadcrumbs={[{ label: t("screens.teamAbsence.dashboard"), href: "/" }, { label: t("screens.teamAbsence.pageTitle") }]}
        />

        {visibleUserIds.length === 0 && managerPeople.length === 0 ? (
          <Card>
            <EmptyState
              title={t("screens.teamAbsence.noTeamUsers")}
              description={t("screens.teamAbsence.noTeamUsersDescription")}
            />
          </Card>
        ) : (
          <>
            {managerPeople.length > 0 ? (
              <Card>
                <CardHeader
                  title={t("screens.teamAbsence.addManagerLeave")}
                  description={t("screens.teamAbsence.addManagerLeaveDescription")}
                />
                <CardBody>
                  <MarkAbsenceForm
                    people={managerPeople}
                    deputyPeople={managerPeople}
                    deputyRequired
                  />
                </CardBody>
              </Card>
            ) : null}

            {departmentEmployees.length > 0 ? (
              <Card>
                <CardHeader
                  title={t("screens.teamAbsence.addEmployeeLeave")}
                  description={t("screens.teamAbsence.addEmployeeLeaveDescription")}
                />
                <CardBody>
                  <MarkAbsenceForm
                    people={people}
                    personLabel={managerPeople.length > 0 ? t("screens.teamAbsence.employee") : t("screens.teamAbsence.person")}
                  />
                </CardBody>
              </Card>
            ) : null}

            <Card>
              <CardHeader
                title={t("screens.teamAbsence.listTitle")}
                description={t("screens.teamAbsence.listDescription")}
                action={
                  <span className="mono text-[length:var(--text-sm)] text-muted">
                    {t("screens.teamAbsence.recordCount", { count: total })}
                  </span>
                }
              />

              <FilterBar
                action="/team/absence"
                clearHref="/team/absence"
                filtered={isFiltered}
                pageSize={pageSize}
                fields={[
                  {
                    name: "person",
                    label: t("screens.teamAbsence.belongsTo"),
                    value: params.person ?? "",
                    options: [
                      { value: "", label: t("screens.teamAbsence.everyone") },
                      ...visiblePeople.map((k) => ({ value: k.id, label: k.fullName })),
                    ],
                  },
                  {
                    name: "status",
                    label: t("screens.teamAbsence.recordStatus"),
                    value: params.status ?? "",
                    width: "w-40",
                    options: [
                      { value: "", label: t("screens.teamAbsence.everyone") },
                      { value: "active", label: t("screens.teamAbsence.active") },
                      { value: "pending", label: t("screens.teamAbsence.pending") },
                      { value: "rejected", label: t("screens.teamAbsence.rejected") },
                      { value: "cancelled", label: t("screens.teamAbsence.cancelled") },
                    ],
                  },
                ]}
              />


              {absences.length === 0 ? (
                isFiltered ? (
                  <EmptyState
                    title={t("screens.teamAbsence.filterNoMatch")}
                    description={t("screens.teamAbsence.clearFilters")}
                  />
                ) : (
                  <EmptyState
                    title={t("screens.teamAbsence.noRecords")}
                    description={t("screens.teamAbsence.noRecordsDescription")}
                  />
                )
              ) : (
                <RecordList>
                  {absences.map((absence) => (
                    <RecordItem key={absence.id} data-test="leave-record">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <p
                            className={
                              absence.cancelledReason
                                ? "font-medium text-muted line-through"
                                : "font-medium text-ink"
                            }
                          >
                            {absence.userName}
                          </p>
                          <p className="tabular text-[length:var(--text-sm)] text-muted">
                            {dayLabel(absence.startDate, locale)} – {dayLabel(absence.endDate, locale)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {absence.cancelledReason ? (
                              <Badge tone="cancelled">{t("screens.teamAbsence.cancelled")}</Badge>
                            ) : (
                              <AbsenceStatusBadge status={absence.status} />
                            )}
                          </div>
                        </div>
                        {absence.cancelledReason ? null : (
                          <div className="flex flex-wrap items-center gap-2">
                            {absence.status === "PENDING" && absence.canDecide ? (
                              <AbsenceDecisionActions absence={absence} />
                            ) : null}
                            {absence.status === "REJECTED" || !absence.canCancel ? null : (
                              <CancelAbsenceButton absence={absence} />
                            )}
                          </div>
                        )}
                      </div>

                      {absence.cancelledReason ? (
                        <div className="mt-2.5">
                          <RecordField label={t("screens.teamAbsence.cancelledReason")}>
                            {absence.cancelledReason}
                          </RecordField>
                        </div>
                      ) : null}

                      {absence.status === "REJECTED" && absence.decisionReason ? (
                        <div className="mt-2.5">
                          <RecordField label={t("screens.teamAbsence.rejectedReason")}>
                            {absence.decisionReason}
                          </RecordField>
                        </div>
                      ) : null}

                      {absence.note || absence.deputyName || absence.decidedByName ? (
                        <div className="mt-2.5 flex flex-wrap gap-x-8 gap-y-2">
                          {absence.note ? (
                            <RecordField label={t("screens.absence.note")}>{absence.note}</RecordField>
                          ) : null}
                          {absence.deputyName ? (
                            <RecordField label={t("screens.absence.deputy")}>{absence.deputyName}</RecordField>
                          ) : null}
                          {absence.decidedByName ? (
                            <RecordField
                              label={absence.status === "REJECTED" ? t("screens.absence.rejectedBy") : t("screens.absence.approvedBy")}
                            >
                              {absence.decidedByName}
                              {absence.decisionRoute ? ` · ${t(decisionRouteKey(absence.decisionRoute))}` : ""}
                            </RecordField>
                          ) : null}
                          {absence.decidedAt ? (
                            <RecordField label={t("screens.teamAbsence.decisionTime")}>
                              {formatInstantShort(absence.decidedAt, locale)}
                            </RecordField>
                          ) : null}
                        </div>
                      ) : null}
                    </RecordItem>
                  ))}
                </RecordList>
              )}

              <Pagination
                page={currentPage}
                pageCount={pageCount}
                hrefFor={(targetPage) =>
                  targetPage === 1 ? address() : address({ page: String(targetPage) })
                }
              />
            </Card>
          </>
        )}
      </Page>
    </AppShell>
  );
}
