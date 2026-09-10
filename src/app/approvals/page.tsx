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
import { prisma } from "@/server/db";

import { ApprovalGroupForm } from "./approval-group-form";
import { formatDayLong } from "@/shared/format/date-time";

// Toplu onay ekranı (Görev 10.6, tasarım §6).
//
// Onay **kişi ve gün** bazında gruplanır: müdür bir kişinin o günkü işini bir
// bütün olarak okur. Tek tek sayfa açıp geri dönmek, günde 5–12 faaliyette
// müdürü akıştan koparıyordu.

export const metadata = { title: "Onaylar" };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    onaylandi?: string;
    period?: string;
    authorId?: string;
    authorOrgUnitId?: string;
    sayfa?: string;
    boyut?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const onaylanan = Number.parseInt(params.onaylandi ?? "", 10);

  const now = new Date();

  // Süzgeçler adres çubuğundan gelir; tanınmayan değer sessizce düşer.
  const filters: ApprovalGroupFilters = {
    period:
      params.period === "today" || params.period === "week" ? params.period : "all",
    authorId: params.authorId || undefined,
    authorOrgUnitId: params.authorOrgUnitId || undefined,
  };

  const SAYFA_BOYU = await resolvePageSize(params.boyut);
  const istenen = Number.parseInt(params.sayfa ?? "1", 10);
  const sayfa = Number.isFinite(istenen) && istenen > 0 ? istenen : 1;

  // Yetki ayrı bir kontrole gerek bırakmıyor: liste yalnız **aktif
  // onaylayıcısı bu kişi olan** kayıtları getiriyor. Onayı olmayan boş sayfa
  // görür, başkasının kaydını değil. Süzgeçler bu koşulun üstüne eklenir.
  const [toplamGrup, subordinates, departments] = await Promise.all([
    countApprovalGroups(prisma, user.id, now, filters),
    subordinateUserIds(prisma, user.id),
    prisma.orgUnit.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const sayfaSayisi = Math.max(1, Math.ceil(toplamGrup / SAYFA_BOYU));
  const gecerliSayfa = Math.min(sayfa, sayfaSayisi);

  const [gruplar, people] = await Promise.all([
    listApprovalGroups(prisma, user.id, now, filters, {
      limit: SAYFA_BOYU,
      skip: (gecerliSayfa - 1) * SAYFA_BOYU,
    }),
    // Süzgeç seçenekleri kapsamdan gelir: adres çubuğuna kimlik yazmadan
    // şirketin kişi listesi öğrenilememeli.
    listScopePeople(
      prisma,
      { id: user.id, isSystemAdmin: user.isSystemAdmin },
      subordinates,
    ),
  ]);

  const adres = (ek: Record<string, string> = {}) =>
    buildQueryAddress(
      "/approvals",
      {
        period: params.period,
        authorId: params.authorId,
        authorOrgUnitId: params.authorOrgUnitId,
        boyut: String(SAYFA_BOYU),
      },
      ek,
    );

  const suzgecliMi =
    (params.period ?? "all") !== "all" ||
    Boolean(params.authorId) ||
    Boolean(params.authorOrgUnitId);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page isaret="onaylar">
        <PageHeader
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Onaylar" }]}
          title="Onayımı bekleyenler"
          description="Kayıtlar kişi ve gün bazında gruplanır. Onaylayana kadar üst kademeler bu kayıtları görmez."
        />

        {Number.isInteger(onaylanan) && onaylanan > 0 ? (
          <div id="onay-bilgi" role="status">
            <Alert tone="success">{onaylanan} kayıt onaylandı.</Alert>
          </div>
        ) : null}

        <Card>
          <FilterBar
            action="/approvals"
            clearHref="/approvals"
            filtered={suzgecliMi}
            pageSize={SAYFA_BOYU}
            fields={[
              {
                name: "period",
                label: "Dönem",
                value: params.period ?? "all",
                width: "w-32",
                options: [
                  { value: "all", label: "Tümü" },
                  { value: "today", label: "Bugün" },
                  { value: "week", label: "Bu hafta" },
                ],
              },
              {
                name: "authorId",
                label: "Kişi",
                value: params.authorId ?? "",
                options: [
                  { value: "", label: "Herkes" },
                  ...people.map((k) => ({ value: k.id, label: k.fullName })),
                ],
              },
              {
                name: "authorOrgUnitId",
                label: "Yazan departman",
                value: params.authorOrgUnitId ?? "",
                width: "w-52",
                options: [
                  { value: "", label: "Hepsi" },
                  ...departments.map((u) => ({ value: u.id, label: u.name })),
                ],
              },
            ]}
          />
        </Card>

        {gruplar.length === 0 ? (
          <Card>
            {suzgecliMi ? (
              <EmptyState
                title="Süzgece uyan kayıt yok."
                description="Süzgeci temizleyerek onayınızı bekleyen bütün kayıtları görebilirsiniz."
              />
            ) : (
              <EmptyState
                title="Onayınızı bekleyen kayıt yok."
                description="Ekibinizden bir faaliyet geldiğinde burada görünür."
              />
            )}
          </Card>
        ) : (
          gruplar.map((grup) => (
            <ApprovalGroupForm
              key={`${grup.authorId}:${grup.day}`}
              authorName={grup.authorName}
              authorUnitName={grup.authorUnitName}
              dayLabel={formatDayLong(grup.activityDate)}
              items={grup.items}
            />
          ))
        )}

        <Pagination
          page={gecerliSayfa}
          pageCount={sayfaSayisi}
          hrefFor={(hedef) =>
            hedef === 1 ? adres() : adres({ sayfa: String(hedef) })
          }
        />
      </Page>
    </AppShell>
  );
}
