import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import {
  listFollowUps,
  type FollowUpFilters,
  type FollowUpView,
} from "@/server/follow-ups/read";
import { listScopePeople } from "@/server/activities/scope-feed";
import { subordinateUserIds } from "@/server/authz/visibility";
import { resolvePageSize } from "@/server/preferences/page-size";
import { FilterBar } from "@/components/filters/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { formatDay } from "@/shared/format/date-time";

// Takip maddeleri ekranı (§11.2).
//
// **Sistem hiçbir maddeyi yukarı taşımaz.** Yaptığı tek şey hareketsiz olanları
// görünür kılmak; yukarı taşıma kararı her zaman insana ait.
//
// Liste **tek**tir (ürün sahibi kararı, 21.08.2026). Önce üç gruba
// bölünüyordu — hareketsizler, bende, diğerleri — ama gruplu yapı
// sayfalanamıyordu ve süzgeç uygulanınca grupların anlamı kayboluyordu.
// Öncelik kaybolmadı: sıralama en uzun bekleyeni öne alır, sahiplik ve
// hareketsizlik satırın rozetlerinde durur.
//
// Liste görünürlük modülünden geçiyor: göremediğin faaliyetin maddesi burada
// da yok — başlık ve "sonraki adım" metni de içerik taşır.

export const metadata = { title: "Takipler" };

function Satir({ item }: { item: FollowUpView }) {
  return (
    <li data-test="takip-satiri" data-hareketsiz={item.stale ? "evet" : "hayir"}>
      <Link
        href={`/activities/${item.activityId}`}
        className="flex flex-col gap-0.5 rounded-(--radius-sm) px-2 py-2.5 transition-colors hover:bg-inset"
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[length:var(--text-xs)] text-muted tabular">
            #{item.activityNo}
          </span>
          <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] font-medium text-ink">
            {item.activityTitle}
          </span>
          {/* Öncelik grup başlığıyla değil, satırın kendi rozetleriyle
              taşınıyor (Görev 11.3): gruplu yapı sayfalanamıyordu ve süzgeç
              uygulanınca grupların anlamı kayboluyordu. */}
          {item.stale ? (
            <Badge tone="danger">{item.idleBusinessDays} iş günüdür</Badge>
          ) : null}
          {item.mine ? <Badge tone="primary">sizde</Badge> : null}
          {item.reviewOverdue ? (
            <Badge tone="correction">gözden geçirme günü geçti</Badge>
          ) : null}
        </span>

        {item.nextStep ? (
          <span className="text-[length:var(--text-xs)] text-muted">
            Sonraki adım: {item.nextStep}
          </span>
        ) : null}

        <span className="flex flex-wrap items-center gap-1.5 text-[length:var(--text-xs)] text-muted">
          <Avatar
            user={{
              id: item.ownerId,
              fullName: item.ownerName,
              avatarExtension: item.ownerAvatarExtension,
            }}
            size={18}
          />
          {item.ownerName}
          {" · "}
          <span className={item.stale ? "text-correction" : undefined}>
            {item.idleBusinessDays === 0
              ? "bugün hareket etti"
              : `${item.idleBusinessDays} iş günüdür hareketsiz`}
          </span>
          {item.reviewDate ? ` · gözden geçirme ${formatDay(item.reviewDate)}` : ""}
        </span>
      </Link>
    </li>
  );
}

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{
    durum?: string;
    sorumlu?: string;
    hareketsiz?: string;
    period?: string;
    sayfa?: string;
    boyut?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const now = new Date();

  const filters: FollowUpFilters = {
    status: params.durum === "kapali" ? "CLOSED" : "OPEN",
    ownerId: params.sorumlu || undefined,
    staleOnly: params.hareketsiz === "evet" || undefined,
    period:
      params.period === "today" || params.period === "week" ? params.period : "all",
  };

  const SAYFA_BOYU = await resolvePageSize(params.boyut);
  const istenen = Number.parseInt(params.sayfa ?? "1", 10);
  const sayfa = Number.isFinite(istenen) && istenen > 0 ? istenen : 1;

  const subordinates = await subordinateUserIds(prisma, user.id);

  // Toplam, sayfa sayısını bilmek için önce okunuyor; hareketsizlik hesabı
  // çalışma takvimine bağlı olduğu için sorgu zaten belleğe iniyor.
  const ilk = await listFollowUps(prisma, viewer, now, filters);
  const sayfaSayisi = Math.max(1, Math.ceil(ilk.total / SAYFA_BOYU));
  const gecerliSayfa = Math.min(sayfa, sayfaSayisi);

  const items = ilk.items.slice(
    (gecerliSayfa - 1) * SAYFA_BOYU,
    gecerliSayfa * SAYFA_BOYU,
  );

  const [shellUser, people] = await Promise.all([
    toShellUser(user, subordinates),
    listScopePeople(prisma, viewer, subordinates),
  ]);

  const adres = (ek: Record<string, string> = {}) =>
    buildQueryAddress(
      "/follow-ups",
      {
        durum: params.durum,
        sorumlu: params.sorumlu,
        hareketsiz: params.hareketsiz,
        period: params.period,
        boyut: String(SAYFA_BOYU),
      },
      ek,
    );

  const suzgecliMi =
    Boolean(params.durum) ||
    Boolean(params.sorumlu) ||
    Boolean(params.hareketsiz) ||
    (params.period ?? "all") !== "all";

  const kapaliMi = filters.status === "CLOSED";

  return (
    <AppShell user={shellUser}>
      <Page isaret="takipler">
        <PageHeader
          marker="Takipler"
          title="Takip maddeleri"
          description="Kapanmamış konular. Sistem hiçbir maddeyi kendiliğinden üst kademeye taşımaz; yalnız görünür kılar."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Takipler" }]}
        />

        <Card>
          <CardHeader
            title={kapaliMi ? "Kapanmış maddeler" : "Açık maddeler"}
            description={
              kapaliMi
                ? "Kapatılmış takip maddeleri, kapanış notlarıyla birlikte kayıtta durur."
                : `En uzun süredir bekleyen madde en üstte. ${ilk.staleThreshold} iş günü ve üzeri bekleyenler işaretlenir.`
            }
            action={
              <span className="mono text-[length:var(--text-sm)] text-muted">
                {ilk.total} madde
              </span>
            }
          />

          <FilterBar
            action="/follow-ups"
            clearHref="/follow-ups"
            filtered={suzgecliMi}
            pageSize={SAYFA_BOYU}
            fields={[
              {
                name: "durum",
                label: "Durum",
                value: params.durum ?? "acik",
                width: "w-36",
                options: [
                  { value: "acik", label: "Açık" },
                  { value: "kapali", label: "Kapanmış" },
                ],
              },
              {
                name: "sorumlu",
                label: "Sorumlu",
                value: params.sorumlu ?? "",
                options: [
                  { value: "", label: "Herkes" },
                  ...people.map((k) => ({ value: k.id, label: k.fullName })),
                ],
              },
              {
                name: "hareketsiz",
                label: "Hareketsizlik",
                value: params.hareketsiz ?? "",
                width: "w-48",
                options: [
                  { value: "", label: "Hepsi" },
                  {
                    value: "evet",
                    label: `${ilk.staleThreshold} iş günü ve üzeri`,
                  },
                ],
              },
              {
                name: "period",
                label: "Açılma dönemi",
                value: params.period ?? "all",
                width: "w-36",
                options: [
                  { value: "all", label: "Tümü" },
                  { value: "today", label: "Bugün" },
                  { value: "week", label: "Bu hafta" },
                ],
              },
            ]}
          />

          {items.length === 0 ? (
            suzgecliMi ? (
              <EmptyState
                title="Süzgece uyan madde yok."
                description="Süzgeci temizleyerek bütün takip maddelerini görebilirsiniz."
              />
            ) : (
              <EmptyState
                title="Açık takip maddesi yok."
                description="Bir faaliyette “bu konu açık kalsın” dediğinizde burada görünür."
              />
            )
          ) : (
            <CardBody className="py-2">
              <ul className="flex flex-col">
                {items.map((item) => (
                  <Satir key={item.id} item={item} />
                ))}
              </ul>
            </CardBody>
          )}

          <Pagination
            page={gecerliSayfa}
            pageCount={sayfaSayisi}
            hrefFor={(hedef) =>
              hedef === 1 ? adres() : adres({ sayfa: String(hedef) })
            }
          />
        </Card>
      </Page>
    </AppShell>
  );
}
