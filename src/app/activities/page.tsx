import Link from "next/link";
import { redirect } from "next/navigation";

import { getLocale } from "@/server/i18n/locale";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import {
  countOwnActivities,
  listOwnActivities,
  type OwnActivityFilters,
} from "@/server/activities/read";
import { getCurrentUser } from "@/server/auth/current-user";
import { subordinateUserIds } from "@/server/authz/visibility";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { FilterBar } from "@/components/filters/filter-bar";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { resolvePageSize } from "@/server/preferences/page-size";
import { RecordItem, RecordList } from "@/components/ui/table";
import { ApprovalBadge } from "@/components/activities/approval-badge";
import { formatDay } from "@/shared/format/date-time";
import { describeActivityDates } from "@/shared/format/activity-dates";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.activitiesPage.pageTitle");
}

function parsePeriod(value: string | undefined): OwnActivityFilters["period"] {
  return value === "today" || value === "week" || value === "all" ? value : "all";
}

const STATUS_FILTERS: Record<string, NonNullable<OwnActivityFilters["status"]>> = {
  approval: "PENDING_APPROVAL",
  changesRequested: "CHANGES_REQUESTED",
  rejected: "REJECTED",
  cancelled: "CANCELLED",
};

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{
    record?: string;
    page?: string;
    pageSize?: string;
    period?: string;
    status?: string;
    targetOrgUnitId?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);
  const params = await searchParams;
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const requested = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requested) && requested > 0 ? requested : 1;
  const pageSize = await resolvePageSize(params.pageSize);

  const filters: OwnActivityFilters = {
    period: parsePeriod(params.period),
    now: new Date(),
    status: params.status ? STATUS_FILTERS[params.status] : undefined,
    openQuestions: params.status === "questions" || undefined,
    targetOrgUnitId: params.targetOrgUnitId || undefined,
  };

  const [total, subordinates, departments] = await Promise.all([
    countOwnActivities(prisma, viewer, filters),
    subordinateUserIds(prisma, user.id),
    prisma.orgUnit.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const activities = await listOwnActivities(prisma, viewer, filters, {
    limit: pageSize,
    skip: (currentPage - 1) * pageSize,
  });

  const address = (attachment: Record<string, string> = {}) =>
    buildQueryAddress(
      "/activities",
      {
        period: params.period,
        status: params.status,
        targetOrgUnitId: params.targetOrgUnitId,
        pageSize: String(pageSize),
      },
      attachment,
    );

  const isFiltered =
    (params.period ?? "all") !== "all" ||
    Boolean(params.status) ||
    Boolean(params.targetOrgUnitId);
  const recordInfo =
    params.record === "added"
      ? t("activities.activityRecorded")
      : params.record === "cancelled"
        ? t("activities.activityCancelled")
        : params.record === "revised"
          ? t("activities.activityRevised")
          : t("activities.operationCompleted");

  return (
    <AppShell user={await toShellUser(user, subordinates)}>
      <Page marker="my-activities">
        <PageHeader
          title={t("screens.activitiesPage.pageTitle")}
          description={t("screens.activitiesPage.pageDescription")}
          breadcrumbs={[
            { label: t("screens.activitiesPage.dashboard"), href: "/" },
            { label: t("screens.activitiesPage.pageTitle") },
          ]}
          action={
            <ButtonLink href="/activities/new" variant="primary">
              {t("screens.activitiesPage.newActivity")}
            </ButtonLink>
          }
        />

        {params.record ? (
          <div id="activity-info" role="status">
            <Alert tone="success">{recordInfo}</Alert>
          </div>
        ) : null}

        <Card>
          <CardHeader
            title={t("screens.activitiesPage.recordLog")}
            description={t("screens.activitiesPage.recordLogDescription")}
            action={
              <span className="mono text-[length:var(--text-sm)] text-muted">
                {t("screens.activitiesPage.recordCount", { count: total })}
              </span>
            }
          />

          <FilterBar
            action="/activities"
            clearHref="/activities"
            filtered={isFiltered}
            pageSize={pageSize}
            fields={[
              {
                name: "period",
                label: t("screens.activitiesPage.period"),
                value: params.period ?? "all",
                width: "w-32",
                options: [
                  { value: "all", label: t("screens.activitiesPage.all") },
                  { value: "today", label: t("dashboard.periodToday") },
                  { value: "week", label: t("dashboard.periodWeek") },
                ],
              },
              {
                name: "status",
                label: t("screens.activitiesPage.status"),
                value: params.status ?? "",
                width: "w-52",
                options: [
                  { value: "", label: t("screens.activitiesPage.everyone") },
                  { value: "approval", label: t("screens.activitiesPage.awaitingApproval") },
                  { value: "changesRequested", label: t("screens.activitiesPage.changesRequested") },
                  { value: "rejected", label: t("screens.activitiesPage.rejected") },
                  { value: "cancelled", label: t("screens.activitiesPage.cancelled") },
                  { value: "questions", label: t("screens.activitiesPage.awaitingAnswers") },
                ],
              },
              {
                name: "targetOrgUnitId",
                label: t("screens.activitiesPage.relatedDepartment"),
                value: params.targetOrgUnitId ?? "",
                width: "w-52",
                options: [
                  { value: "", label: t("screens.activitiesPage.everyone") },
                  ...departments.map((unit) => ({ value: unit.id, label: unit.name })),
                ],
              },
            ]}
          />

          {activities.length === 0 ? (
            isFiltered ? (
              <EmptyState
                title={t("screens.activitiesPage.noFilterMatch")}
                description={t("screens.activitiesPage.clearFilterDescription")}
                action={
                  <ButtonLink href="/activities" variant="secondary" size="sm">
                    {t("screens.activitiesPage.clearFilter")}
                  </ButtonLink>
                }
              />
            ) : (
              <EmptyState
                title={t("screens.activitiesPage.noActivities")}
                description={t("screens.activitiesPage.noActivitiesDescription")}
                action={
                  <ButtonLink href="/activities/new" variant="primary" size="sm">
                    {t("screens.activitiesPage.writeFirst")}
                  </ButtonLink>
                }
              />
            )
          ) : (
            <RecordList>
              {activities.map((activity) => {
                const cancelled = activity.approvalStatus === "CANCELLED";

                return (
                  <RecordItem
                    key={activity.id}
                    data-test="activity-record"
                    data-unit={activity.authorOrgUnitName}
                    className="transition-colors duration-(--duration-fast) hover:bg-surface-hover sm:px-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                          <span className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
                            #{activity.activityNo}
                          </span>
                          <time className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
                            {formatDay(activity.activityDate, locale)}
                          </time>
                          <Link
                            href={`/activities/${activity.id}`}
                            className={
                              cancelled
                                ? "min-w-0 text-[length:var(--text-base)] font-medium text-faint line-through hover:underline"
                                : "min-w-0 text-[length:var(--text-base)] font-medium text-ink hover:text-primary hover:underline"
                            }
                          >
                            {activity.title}
                          </Link>
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--text-xs)] text-muted">
                          <ApprovalBadge status={activity.approvalStatus} />
                          {activity.currentRevisionNo > 1 ? (
                            <span className="mono">
                              {t("screens.activitiesPage.revisionCount", {
                                count: activity.currentRevisionNo,
                              })}
                            </span>
                          ) : null}
                          {activity.targetDepartmentNames.length > 0 ? (
                            <span className="text-faint">
                              {activity.targetDepartmentNames.join(" · ")}
                            </span>
                          ) : null}
                          <time
                            dateTime={activity.createdAt.toISOString()}
                            className="mono text-faint"
                          >
                            {describeActivityDates(
                              {
                                ...activity,
                                revisionNo: activity.currentRevisionNo,
                              },
                              locale,
                              {
                                saved: t("common.saved"),
                                lastEdited: t("activities.lastEdited"),
                              },
                            ).created}
                          </time>
                        </div>

                        {cancelled && activity.cancellationReason ? (
                          <p className="prose-measure mt-2 border-s-[3px] border-cancelled-line ps-3 text-[length:var(--text-sm)] text-muted">
                            <span className="font-medium text-ink">
                              {t("screens.activitiesPage.cancellationReason")}
                            </span>{" "}
                            {activity.cancellationReason}
                          </p>
                        ) : null}
                      </div>

                      {cancelled || !activity.canEdit ? null : (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <ButtonLink href={`/activities/${activity.id}/edit`} size="sm">
                            {t("screens.activitiesPage.revise")}
                          </ButtonLink>
                          {activity.approvalStatus === "APPROVED" ? (
                            <ButtonLink
                              href={`/activities/${activity.id}/cancel`}
                              variant="danger"
                              size="sm"
                            >
                              {t("screens.activitiesPage.cancel")}
                            </ButtonLink>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </RecordItem>
                );
              })}
            </RecordList>
          )}

          <Pagination
            page={currentPage}
            pageCount={pageCount}
            hrefFor={(targetPage) =>
              targetPage === 1 ? address() : address({ page: String(targetPage) })
            }
            totalLabel={
              total > pageSize
                ? t("screens.activitiesPage.totalRange", {
                    start: (currentPage - 1) * pageSize + 1,
                    end: (currentPage - 1) * pageSize + activities.length,
                    total,
                  })
                : undefined
            }
          />
        </Card>
      </Page>
    </AppShell>
  );
}
