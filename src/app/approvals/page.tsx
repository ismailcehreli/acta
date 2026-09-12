import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Alert } from "@/components/ui/alert";
import { Card, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import {
  countApprovalGroups,
  listApprovalGroups,
  type ApprovalGroupFilters,
} from "@/server/activities/approval-groups";
import { listScopePeople } from "@/server/activities/scope-feed";
import { subordinateUserIds } from "@/server/authz/visibility";
import { resolvePageSize } from "@/server/preferences/page-size";
import { FilterBar } from "@/components/filters/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLocale } from "@/server/i18n/locale";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { prisma } from "@/server/db";

import { ApprovalGroupForm } from "./approval-group-form";
import { formatDayLong } from "@/shared/format/date-time";


//




export async function generateMetadata() {
  return getLocalizedMetadata("screens.approvalsPage.title");
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    approved?: string;
    period?: string;
    authorId?: string;
    authorOrgUnitId?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  const params = await searchParams;
  const approved = Number.parseInt(params.approved ?? "", 10);

  const now = new Date();


  const filters: ApprovalGroupFilters = {
    period:
      params.period === "today" || params.period === "week" ? params.period : "all",
    authorId: params.authorId || undefined,
    authorOrgUnitId: params.authorOrgUnitId || undefined,
  };

  const PAGE_SIZE = await resolvePageSize(params.pageSize);
  const requested = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requested) && requested > 0 ? requested : 1;




  const [totalGroups, subordinates, departments] = await Promise.all([
    countApprovalGroups(prisma, user.id, now, filters),
    subordinateUserIds(prisma, user.id),
    prisma.orgUnit.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);

  const [groups, people] = await Promise.all([
    listApprovalGroups(prisma, user.id, now, filters, {
      limit: PAGE_SIZE,
      skip: (currentPage - 1) * PAGE_SIZE,
    }),


    listScopePeople(
      prisma,
      { id: user.id, isSystemAdmin: user.isSystemAdmin },
      subordinates,
    ),
  ]);

  const address = (attachment: Record<string, string> = {}) =>
    buildQueryAddress(
      "/approvals",
      {
        period: params.period,
        authorId: params.authorId,
        authorOrgUnitId: params.authorOrgUnitId,
        pageSize: String(PAGE_SIZE),
      },
      attachment,
    );

  const isFiltered =
    (params.period ?? "all") !== "all" ||
    Boolean(params.authorId) ||
    Boolean(params.authorOrgUnitId);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page marker="approvals">
        <PageHeader
          breadcrumbs={[{ label: t("screens.approvalsPage.dashboard"), href: "/" }, { label: t("screens.approvalsPage.marker") }]}
          title={t("screens.approvalsPage.title")}
          description={t("screens.approvalsPage.description")}
        />

        {Number.isInteger(approved) && approved > 0 ? (
          <div id="approval-message" role="status">
            <Alert tone="success">
              {t("screens.approvalsPage.approvedMessage", { count: approved })}
            </Alert>
          </div>
        ) : null}

        <Card>
          <FilterBar
            action="/approvals"
            clearHref="/approvals"
            filtered={isFiltered}
            pageSize={PAGE_SIZE}
            fields={[
              {
                name: "period",
                label: t("screens.approvalsPage.period"),
                value: params.period ?? "all",
                width: "w-32",
                options: [
                  { value: "all", label: t("screens.approvalsPage.all") },
                  { value: "today", label: t("screens.approvalsPage.today") },
                  { value: "week", label: t("screens.approvalsPage.week") },
                ],
              },
              {
                name: "authorId",
                label: t("screens.approvalsPage.person"),
                value: params.authorId ?? "",
                options: [
                  { value: "", label: t("screens.approvalsPage.everyone") },
                  ...people.map((k) => ({ value: k.id, label: k.fullName })),
                ],
              },
              {
                name: "authorOrgUnitId",
                label: t("screens.approvalsPage.department"),
                value: params.authorOrgUnitId ?? "",
                width: "w-52",
                options: [
                  { value: "", label: t("screens.approvalsPage.everyone") },
                  ...departments.map((u) => ({ value: u.id, label: u.name })),
                ],
              },
            ]}
          />
        </Card>

        {groups.length === 0 ? (
          <Card>
            {isFiltered ? (
              <EmptyState
                title={t("screens.approvalsPage.noFilterMatch")}
                description={t("screens.approvalsPage.clearFilterDescription")}
              />
            ) : (
              <EmptyState
                title={t("screens.approvalsPage.noRecords")}
                description={t("screens.approvalsPage.noRecordsDescription")}
              />
            )}
          </Card>
        ) : (
          groups.map((group) => (
            <ApprovalGroupForm
              key={`${group.authorId}:${group.day}`}
              authorName={group.authorName}
              authorUnitName={group.authorUnitName}
              dayLabel={formatDayLong(group.activityDate, locale)}
              items={group.items}
            />
          ))
        )}

        <Pagination
          page={currentPage}
          pageCount={pageCount}
          hrefFor={(targetPage) =>
            targetPage === 1 ? address() : address({ page: String(targetPage) })
          }
        />
      </Page>
    </AppShell>
  );
}
