import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { prisma } from "@/server/db";
import {
  searchActivities,
  type SearchFilters,
} from "@/server/search/activities";
import { searchPageSchema, searchQuerySchema } from "@/shared/schemas/search";
import { subordinateUserIds } from "@/server/authz/visibility";
import { resolvePageSize } from "@/server/preferences/page-size";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { localizeValidationIssue } from "@/shared/i18n/message";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import {
  ActivityFilters,
  SearchField,
} from "@/components/filters/activity-filters";
import { listScopePeople } from "@/server/activities/scope-feed";
import { Page, PageHeader } from "@/components/ui/page";
import { SearchResults } from "@/components/search/search-results";




export async function generateMetadata() {
  return getLocalizedMetadata("screens.search.title");
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;

    pageSize?: string;
    period?: string;
    authorId?: string;
    authorOrgUnitId?: string;
    targetOrgUnitId?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();

  const params = await searchParams;
  const parsedQuery = searchQuerySchema.safeParse(params.q ?? "");
  const query = parsedQuery.success ? parsedQuery.data : "";
  const page = searchPageSchema.parse(params.page ?? 1);




  const pageSize = await resolvePageSize(params.pageSize);

  const period: SearchFilters["period"] =
    params.period === "today" || params.period === "week" ? params.period : "all";
  const selected: SearchFilters = {
    period: period,
    authorId: params.authorId ?? "",
    authorOrgUnitId: params.authorOrgUnitId ?? "",
    targetOrgUnitId: params.targetOrgUnitId ?? "",
  };

  const subordinates = await subordinateUserIds(prisma, user.id);
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };

  const [result, people, departments] = await Promise.all([
    searchActivities(prisma, viewer, query, page, pageSize, subordinates, selected),



    listScopePeople(prisma, viewer, subordinates),
    prisma.orgUnit.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <AppShell
      user={await toShellUser(user, subordinates)}
    >
      <Page marker="search">
        <PageHeader
          title={t("screens.search.title")}
          description={t("screens.search.description")}
          breadcrumbs={[
            { label: t("screens.search.dashboard"), href: "/" },
            { label: t("screens.search.title") },
          ]}
        />

        <Card>

          <ActivityFilters
            options={{ people, departments }}
            selected={selected}
            clearHref={query === "" ? "/search" : `/search?q=${encodeURIComponent(query)}`}
            defaultPeriod="all"
            extra={<SearchField value={query} />}
            pageSize={pageSize}
            submitLabel={t("screens.search.submit")}
          />

          {parsedQuery.success ? null : (
            <CardBody>
              <Alert tone="danger">
                {localizeValidationIssue(t, parsedQuery.error.issues[0])}
              </Alert>
            </CardBody>
          )}
        </Card>

        <SearchResults
          hits={result.hits}
          total={result.total}
          page={result.page}
          pageCount={result.pageCount}
          query={query}
          pageAddress={(targetPage) =>
            buildQueryAddress(
              "/search",
              {
                q: query,
                period: params.period,
                authorId: params.authorId,
                authorOrgUnitId: params.authorOrgUnitId,
                targetOrgUnitId: params.targetOrgUnitId,
                pageSize: String(pageSize),
              },
              { page: String(targetPage) },
            )
          }
        />
      </Page>
    </AppShell>
  );
}
