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
import { subordinateUserIds } from "@/server/authz/visibility";
import { prisma } from "@/server/db";
import { resolvePageSize } from "@/server/preferences/page-size";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { ScopeFeed } from "@/components/dashboard/scope-feed";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Card, CardBody } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";

// Kayıt akışı (20.08.2026'da ana ekrandan buraya taşındı).
//
// **Neden ayrı sayfa:** ana ekran bir özet olmalı. Kapsam akışı büyüdükçe
// uzuyor ve bin kayıtlık bir şirkette ana ekran sonu gelmeyen bir listeye
// dönüşüyordu; özetin kendisi ekranın dışında kalıyordu.
//
// **Neden imleçli sayfalama, numaralı değil:** akış canlı. Numaralı
// (offset) sayfalamada araya yeni kayıt girdiğinde ikinci sayfa bir satır
// atlar ya da aynı satırı tekrar gösterir — kullanıcı bunu fark etmez.
// İmleç, "şu kayıttan sonrakiler" der ve araya kayıt girse de sıra bozulmaz.
// Bedeli: doğrudan "sayfa 7"ye atlanamaz. Bu akış için doğru takas —
// kullanıcı belli bir sayfayı değil, belli bir kaydı arıyor ve onun için
// arama ekranı var.

export const metadata = { title: "Kayıt akışı" };

function parsePeriod(value: string | undefined): FeedFilters["period"] {
  return value === "today" || value === "all" || value === "week" ? value : "week";
}

const DURUMLAR: Record<string, NonNullable<FeedFilters["status"]>> = {
  onay: "PENDING_APPROVAL",
  duzeltme: "CHANGES_REQUESTED",
  reddedilen: "REJECTED",
  iptal: "CANCELLED",
};

// "soru" bir onay durumu değil, kaydın üzerindeki konuşmalara bakan ayrı bir
// daraltma (Görev 11.2). Aynı adres parametresini paylaşırlar çünkü kullanıcı
// için ikisi de "hangi kayıtlar" sorusunun cevabıdır.
const SORU_DURUMU = "soru";

const DURUM_ETIKETLERI: Record<string, string> = {
  onay: "onay bekleyenler",
  duzeltme: "düzeltme istenenler",
  reddedilen: "uygun bulunmayanlar",
  iptal: "iptal edilenler",
  [SORU_DURUMU]: "cevap bekleyen faaliyetler",
};

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    authorId?: string;
    authorOrgUnitId?: string;
    targetOrgUnitId?: string;
    durum?: string;
    okunmamis?: string;
    /** Sayfada kaç kayıt; seçim çerezde de hatırlanır. */
    boyut?: string;
    cursor?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const now = new Date();

  const filters: FeedFilters = {
    period: parsePeriod(params.period),
    authorId: params.authorId || undefined,
    authorOrgUnitId: params.authorOrgUnitId || undefined,
    targetOrgUnitId: params.targetOrgUnitId || undefined,
    status: params.durum ? DURUMLAR[params.durum] : undefined,
    openQuestions: params.durum === SORU_DURUMU || undefined,
    unreadOnly: params.okunmamis === "1",
  };

  const sayfaBoyu = await resolvePageSize(params.boyut);
  const subordinates = await subordinateUserIds(prisma, viewer.id);

  const [shellUser, scope, feed, toplam, people, departments] = await Promise.all([
    toShellUser(user, subordinates),
    describeScope(prisma, viewer, subordinates),
    listScopeActivities(prisma, viewer, filters, now, {
      cursor: decodeCursor(params.cursor),
      subordinates,
      limit: sayfaBoyu,
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

  /**
   * Süzgeçleri koruyan adres üretici; sayfalama ve daraltma bunu kullanır.
   *
   * `cikar` ile bir süzgeç bilerek düşürülür. "Daraltmayı kaldır" bağlantısı
   * bunu kullanmıyordu ve durumu koruyan bir adres üretiyordu: tıklamak
   * hiçbir şeyi değiştirmiyordu (Görev 11.2'de bulundu).
   */
  const adres = (ek: Record<string, string> = {}, cikar: string[] = []) =>
    buildQueryAddress(
      "/feed",
      {
        period: filters.period ?? "week",
        authorId: params.authorId,
        authorOrgUnitId: params.authorOrgUnitId,
        targetOrgUnitId: params.targetOrgUnitId,
        durum: params.durum,
        okunmamis: params.okunmamis === "1" ? "1" : undefined,
        boyut: String(sayfaBoyu),
      },
      ek,
      cikar,
    );

  return (
    <AppShell user={shellUser}>
      <Page isaret="akis">
        <PageHeader
          marker="Akış"
          title="Kayıt akışı"
          description={
            scope.hasScope
              ? "Kapsamınızdaki kayıtlar, tarihine göre. Süzgeçler yalnızca daraltır; kimseye erişim açmaz."
              : undefined
          }
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Kayıt akışı" }]}
        />

        {scope.hasScope ? (
          <ScopeFeed
            label={scope.label}
            items={feed.items}
            totalCount={toplam}
            pageSize={sayfaBoyu}
            statusLabel={params.durum ? DURUM_ETIKETLERI[params.durum] : null}
            clearStatusHref={adres({}, ["durum"])}
            unreadOnly={filters.unreadOnly}
            unreadHref={adres({ period: "all", okunmamis: "1" }, ["cursor"])}
            clearUnreadHref={adres({}, ["okunmamis", "cursor"])}
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
            // Devamı varsa adresi verilir; liste sessizce kesilmez.
            nextPageHref={
              feed.nextCursor ? adres({ cursor: encodeCursor(feed.nextCursor) }) : null
            }
            // İmleçli sayfalamada "önceki" yoktur; başa dönüş vardır.
            // Tarayıcının geri düğmesi bir önceki sayfayı zaten getiriyor.
            firstPageHref={params.cursor ? adres() : null}
          />
        ) : (
          <Card>
            <CardBody>
              <p className="text-[length:var(--text-sm)] text-muted">
                Bu ekranda kendi kayıtlarınızı görürsünüz. Başkalarının
                faaliyetleri, yalnızca organizasyonda sizin altınızda kalan
                kişilere aitse görünür.
              </p>
            </CardBody>
          </Card>
        )}
      </Page>
    </AppShell>
  );
}
