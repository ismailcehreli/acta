import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import {
  searchActivities,
  type SearchFilters,
} from "@/server/search/activities";
import { searchPageSchema, searchQuerySchema } from "@/shared/schemas/search";
import { subordinateUserIds } from "@/server/authz/visibility";
import { resolvePageSize } from "@/server/preferences/page-size";
import { buildQueryAddress } from "@/shared/filters/query-address";
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

// Arama ekranı (§16.2). Sonuçlar görünürlük kapsamıyla sınırlıdır; kapsam
// süzgeci sorgunun içindedir (`src/server/search/activities.ts`).

export const metadata = { title: "Arama" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    /** Sayfada kaç sonuç; seçim çerezde de hatırlanır. */
    boyut?: string;
    period?: string;
    authorId?: string;
    authorOrgUnitId?: string;
    targetOrgUnitId?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const parsedQuery = searchQuerySchema.safeParse(params.q ?? "");
  const query = parsedQuery.success ? parsedQuery.data : "";
  const page = searchPageSchema.parse(params.page ?? 1);

  // Sayfa boyu tercihi diğer listelerle **aynı** yerden geliyor: kullanıcı
  // "sayfada 50" dediğinde bu arama sonuçlarında da geçerli olmalı, ekran
  // başına ayrı bir tercih öğretilmemeli (Görev 11.3).
  const sayfaBoyu = await resolvePageSize(params.boyut);

  const donem: SearchFilters["period"] =
    params.period === "today" || params.period === "week" ? params.period : "all";
  const secilen: SearchFilters = {
    period: donem,
    authorId: params.authorId ?? "",
    authorOrgUnitId: params.authorOrgUnitId ?? "",
    targetOrgUnitId: params.targetOrgUnitId ?? "",
  };

  const subordinates = await subordinateUserIds(prisma, user.id);
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };

  const [result, people, departments] = await Promise.all([
    searchActivities(prisma, viewer, query, page, sayfaBoyu, subordinates, secilen),
    // Süzgeç seçenekleri **kapsamdan** geliyor: kişi listesi görünürlükle
    // sınırlı, aksi hâlde adres çubuğuna kimlik yazmadan da şirketin kişi
    // listesi öğrenilebilirdi.
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
      <Page isaret="arama">
        <PageHeader
          title="Arama"
          description="Faaliyet başlıklarının ve açıklamalarının içinde arar. Arama yetki vermez: sonuçlarda yalnızca zaten görme hakkınız olan kayıtlar çıkar."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Arama" }]}
        />

        <Card>
          {/* Süzgeç satırı kapsam akışıyla **aynı bileşen** (Görev 10.9):
              iki ayrı süzgeç mantığı, biri bozulduğunda diğerinin fark
              edilmemesi demekti. */}
          <ActivityFilters
            options={{ people, departments }}
            selected={secilen}
            clearHref={query === "" ? "/search" : `/search?q=${encodeURIComponent(query)}`}
            defaultPeriod="all"
            extra={<SearchField value={query} />}
            pageSize={sayfaBoyu}
            submitLabel="Ara"
          />

          {parsedQuery.success ? null : (
            <CardBody>
              <Alert tone="danger">{parsedQuery.error.issues[0]?.message}</Alert>
            </CardBody>
          )}
        </Card>

        <SearchResults
          hits={result.hits}
          total={result.total}
          page={result.page}
          pageCount={result.pageCount}
          query={query}
          sayfaAdresi={(hedef) =>
            buildQueryAddress(
              "/search",
              {
                q: query,
                period: params.period,
                authorId: params.authorId,
                authorOrgUnitId: params.authorOrgUnitId,
                targetOrgUnitId: params.targetOrgUnitId,
                boyut: String(sayfaBoyu),
              },
              { page: String(hedef) },
            )
          }
        />
      </Page>
    </AppShell>
  );
}
