import { redirect } from "next/navigation";

import { decodeCursor, encodeCursor } from "@/server/activities/feed-cursor";
import {
  countScopeActivities,
  describeScope,
  listScopeActivities,
  listScopePeople,
  type FeedFilters,
} from "@/server/activities/scope-feed";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLocale } from "@/server/i18n/locale";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { subordinateUserIds } from "@/server/authz/visibility";
import { prisma } from "@/server/db";
import { resolvePageSize } from "@/server/preferences/page-size";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { ScopeFeed } from "@/components/dashboard/scope-feed";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Card, CardBody } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";


//



//








export async function generateMetadata() {
  return getLocalizedMetadata("screens.feed.title");
}

function parsePeriod(value: string | undefined): FeedFilters["period"] {
  return value === "today" || value === "all" || value === "week" ? value : "week";
}

const STATUS_FILTERS: Record<string, NonNullable<FeedFilters["status"]>> = {
  approval: "PENDING_APPROVAL",
  changesRequested: "CHANGES_REQUESTED",
  rejected: "REJECTED",
  cancelled: "CANCELLED",
};




const QUESTIONS_FILTER = "questions";

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    authorId?: string;
    authorOrgUnitId?: string;
    targetOrgUnitId?: string;
    status?: string;
    unread?: string;

    pageSize?: string;
    cursor?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  const params = await searchParams;
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const now = new Date();

  const filters: FeedFilters = {
    period: parsePeriod(params.period),
    authorId: params.authorId || undefined,
    authorOrgUnitId: params.authorOrgUnitId || undefined,
    targetOrgUnitId: params.targetOrgUnitId || undefined,
    status: params.status ? STATUS_FILTERS[params.status] : undefined,
    openQuestions: params.status === QUESTIONS_FILTER || undefined,
    unreadOnly: params.unread === "1",
  };

  const pageSize = await resolvePageSize(params.pageSize);
  const subordinates = await subordinateUserIds(prisma, viewer.id);

  const [shellUser, scope, feed, total, people, departments] = await Promise.all([
    toShellUser(user, subordinates),
    describeScope(prisma, viewer, subordinates),
    listScopeActivities(prisma, viewer, filters, now, {
      cursor: decodeCursor(params.cursor),
      subordinates,
      limit: pageSize,
      managedOnly: true,
      order: filters.unreadOnly ? "oldest" : "newest",
    }),
    countScopeActivities(prisma, viewer, filters, now, {
      subordinates,
      managedOnly: true,
    }),
    listScopePeople(prisma, viewer, subordinates),
    prisma.orgUnit.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);


  const address = (attachment: Record<string, string> = {}, removeKeys: string[] = []) =>
    buildQueryAddress(
      "/feed",
      {
        period: filters.period ?? "week",
        authorId: params.authorId,
        authorOrgUnitId: params.authorOrgUnitId,
        targetOrgUnitId: params.targetOrgUnitId,
        status: params.status,
        unread: params.unread === "1" ? "1" : undefined,
        pageSize: String(pageSize),
      },
      attachment,
      removeKeys,
    );

  return (
    <AppShell user={shellUser}>
      <Page marker="feed">
        <PageHeader
          marker={t("screens.feed.marker")}
          title={t("screens.feed.title")}
          description={
            scope.hasScope
              ? t("screens.feed.description")
              : undefined
          }
          breadcrumbs={[
            { label: t("screens.feed.dashboard"), href: "/" },
            { label: t("screens.feed.title") },
          ]}
        />

        {scope.hasScope ? (
          <ScopeFeed
            locale={locale}
            t={t}
            label={t(scope.label)}
            items={feed.items}
            totalCount={total}
            pageSize={pageSize}
            statusLabel={
              params.status === "approval"
                ? t("screens.feed.approval")
                : params.status === "changesRequested"
                  ? t("screens.feed.changesRequested")
                  : params.status === "rejected"
                    ? t("screens.feed.rejected")
                    : params.status === "cancelled"
                      ? t("screens.feed.cancelled")
                      : params.status === QUESTIONS_FILTER
                        ? t("screens.feed.questions")
                        : null
            }
            clearStatusHref={address({}, ["status"])}
            unreadOnly={filters.unreadOnly}
            unreadHref={address({ period: "all", unread: "1" }, ["cursor"])}
            clearUnreadHref={address({}, ["unread", "cursor"])}
            personCount={scope.personCount}
            unreadCount={shellUser.unreadCount}
            filters={{ people, departments }}
            clearHref="/feed"
            selected={{
              period: filters.period ?? "week",
              authorId: params.authorId ?? "",
              authorOrgUnitId: params.authorOrgUnitId ?? "",
              targetOrgUnitId: params.targetOrgUnitId ?? "",
            }}

            nextPageHref={
              feed.nextCursor ? address({ cursor: encodeCursor(feed.nextCursor) }) : null
            }


            firstPageHref={params.cursor ? address() : null}
          />
        ) : (
          <Card>
            <CardBody>
              <p className="text-[length:var(--text-sm)] text-muted">
                {t("screens.feed.noScope")}
              </p>
            </CardBody>
          </Card>
        )}
      </Page>
    </AppShell>
  );
}
