import { redirect } from "next/navigation";

import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { countVisibleActivities } from "@/server/authz/activity-repository";
import {
  countScopeActivities,
  describeScope,
  listScopeActivities,
  periodStart,
  type FeedFilters,
} from "@/server/activities/scope-feed";
import { getCurrentUser } from "@/server/auth/current-user";
import { subordinateUserIds } from "@/server/authz/visibility";
import { activityTrend, statusDistribution } from "@/server/dashboard/charts";
import { listWorkQueue } from "@/server/dashboard/work-queue";
import { departmentSummary } from "@/server/dashboard/department-summary";
import {
  dashboardMetrics,
  personalDashboardMetrics,
} from "@/server/dashboard/metrics";
import {
  operationsSummary,
  teamParticipationToday,
} from "@/server/dashboard/summary";
import { prisma } from "@/server/db";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { ManagerSummaryBlock } from "@/components/dashboard/manager-summary";
import { MyActivitiesBlock } from "@/components/dashboard/my-activities-block";
import { OperationsBlock } from "@/components/dashboard/operations-block";
import { WorkQueueBlock } from "@/components/dashboard/work-queue-block";
import { UnreadActivitiesBlock } from "@/components/dashboard/unread-activities-block";
import { FeedRow } from "@/components/dashboard/scope-feed";
import { FeedPreview, SummaryCharts } from "@/components/dashboard/summary-charts";
import { TeamBlock } from "@/components/dashboard/team-block";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { companyHour } from "@/shared/format/date-time";

// Ana ekran (§13.1). **Düzen her kademede aynıdır; yalnızca kapsam genişler.**
// Öğrenilecek tek bir arayüz olur.
//
// **Bu bir özet ekranıdır** (ürün sahibi kararı, 20.08.2026). Kapsam akışının
// tamamı burada duruyordu ve bin kayıtlık bir şirkette sayfa sonu gelmeyen bir
// listeye dönüşüyordu — özetin kendisi ekranın dışında kalıyordu. Akış
// `/feed` sayfasına taşındı; ana ekranda yalnız son beş kayıt duruyor.
//
// Ekranın sırası "önce iş, sonra resim":
//   1. Ölçüm şeridi — kapsamın o anki hâli, beş sayı.
//   2. Bana düşen iş — karar bekleyen her şey.
//   3. Bugünkü kaydınız — ince şerit.
//   4. Grafikler — "nasıl gidiyor" sorusunun cevabı.
//   5. Son kayıtlar — akışa açılan kapı.
//   6. Sistem yöneticisine işletim bloğu.

function parsePeriod(value: string | undefined): FeedFilters["period"] {
  return value === "today" || value === "all" || value === "week" ? value : "week";
}

/** Blok başlığında dönemin adı geçsin diye; sayı hangi aralığa ait, belli olsun. */
const DONEM_ETIKETLERI: Record<"today" | "week" | "all", string> = {
  today: "Bugün",
  week: "Bu hafta",
  all: "Tüm zamanlarda",
};

/** Ana ekrandaki önizlemede kaç kayıt gösterilir. */
const ONIZLEME = 5;

/** Grafik kaç günü gösteriyor. İki hafta, iki hafta sonu demek. */
const TREND_GUN = 14;

function selamlama(now: Date): string {
  const saat = companyHour(now);

  if (saat < 12) return "Günaydın";
  if (saat < 18) return "İyi günler";
  return "İyi akşamlar";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const now = new Date();

  const filters: FeedFilters = { period: parsePeriod(params.period) };
  const donem = filters.period ?? "week";

  // Astlar bir kez hesaplanır ve her sorguya taşınır: aynı istekte tekrar
  // tekrar çalıştırmak sayfayı gereksiz yere yavaşlatıyordu.
  const subordinates = await subordinateUserIds(prisma, viewer.id);

  const [
    scope,
    onizleme,
    toplamKayit,
    todayCount,
    totalCount,
    workQueue,
    unreadPreview,
    participation,
    departmentRows,
    operations,
    personalMetrics,
    managedMetrics,
    trend,
    statuses,
  ] = await Promise.all([
    describeScope(prisma, viewer, subordinates),
    listScopeActivities(prisma, viewer, filters, now, {
      subordinates,
      limit: ONIZLEME,
      managedOnly: true,
    }),
    countScopeActivities(prisma, viewer, filters, now, {
      subordinates,
      managedOnly: true,
    }),
    countVisibleActivities(prisma, viewer, {
      authorId: user.id,
      activityDate: toDateValue(companyDay(now)),
    }),
    countVisibleActivities(prisma, viewer, { authorId: user.id }),
    // Tek iş kuyruğu: cevap bekleyen sorular, onaylar ve düzeltme talepleri
    // aynı listede (Görev 10.5). "Cevap beklediklerim" izlenenlere ayrılıyor.
    listWorkQueue(prisma, viewer, now),
    listScopeActivities(prisma, viewer, { period: "all", unreadOnly: true }, now, {
      subordinates,
      limit: ONIZLEME,
      managedOnly: true,
      order: "oldest",
    }),
    teamParticipationToday(prisma, subordinates, now),
    departmentSummary(prisma, viewer, subordinates, filters.period, now, {
      includeRoot: true,
    }),
    user.isSystemAdmin ? operationsSummary(prisma, now) : Promise.resolve(null),
    personalDashboardMetrics(prisma, viewer, filters.period, now),
    dashboardMetrics(prisma, viewer, subordinates, filters.period, now, {
      canManageAbsences: user.isUnitManager,
      canManageFeedback: user.isSystemAdmin,
    }),
    activityTrend(prisma, viewer, subordinates, TREND_GUN, now, {
      managedOnly: true,
    }),
    statusDistribution(
      prisma,
      viewer,
      subordinates,
      periodStart(filters.period, now),
      { managedOnly: true },
    ),
  ]);

  const shellUser = await toShellUser(user, subordinates);
  const bekleyen = workQueue.items.length;

  // Faaliyet yazması beklenmeyen kişide (§7.4 istisnası) "bugün yazmadınız"
  // uyarısı da, "Benim faaliyetlerim" bloğu da gösterilmez: beklenmeyen bir
  // şeyin eksikliği hatırlatılmaz.
  const faaliyetYazar = user.writesActivities;

  const akisAdresi = `/feed?${new URLSearchParams({ period: donem }).toString()}`;

  return (
    <AppShell user={shellUser}>
      <Page isaret="ana-ekran">
        <PageHeader
          marker="Bugün"
          title={`${selamlama(now)}, ${user.fullName}`}
          description={
            [
              !faaliyetYazar
                ? null
                : todayCount === 0
                  ? "Bugün henüz faaliyet girmediniz."
                  : `Bugün ${todayCount} faaliyet girdiniz.`,
              bekleyen > 0 ? `${bekleyen} iş sizi bekliyor.` : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />

        <WorkQueueBlock items={workQueue.items} watched={workQueue.watched} />

        {scope.hasScope && shellUser.unreadCount > 0 ? (
          <UnreadActivitiesBlock
            items={unreadPreview.items}
            count={shellUser.unreadCount}
            href="/feed?period=all&okunmamis=1"
          />
        ) : null}

        <section
          aria-labelledby="benim-durumum"
          data-test="kisisel-durum"
          className="flex flex-col gap-(--spacing-block)"
        >
          <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
            <div>
              <span className="section-label">KİŞİSEL ÖZET</span>
              <h2 id="benim-durumum" className="mt-1 text-[length:var(--text-xl)] font-semibold text-ink">
                Benim durumum
              </h2>
            </div>
            <p className="max-w-sm text-right text-[length:var(--text-sm)] text-muted">
              Yalnızca sizin faaliyetleriniz.
            </p>
          </div>

          <MetricStrip
            metrics={personalMetrics}
            donemEtiketi={DONEM_ETIKETLERI[donem]}
            period={donem}
            onaylayici={false}
            headingId="kisisel-olcum-basligi"
            ownOnly
            authorId={user.id}
          />

          {/* ── Bugünkü kaydınız ───────────────────────────────────────
            İnce şerit; işi gölgelemez. Faaliyet yazması beklenmeyen kişide
            (§7.4 istisnası) hiç görünmez — "0 kayıt" bile göstermez. */}
          {faaliyetYazar ? (
            <MyActivitiesBlock todayCount={todayCount} totalCount={totalCount} />
          ) : null}
        </section>

        {subordinates.length > 0 ? (
          <section
            aria-labelledby="yonettigim-alan"
            data-test="yonetilen-alan"
            className="flex flex-col gap-(--spacing-block)"
          >
            <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
              <div>
                <span className="section-label">YÖNETİLEN ALAN</span>
                <h2 id="yonettigim-alan" className="mt-1 text-[length:var(--text-xl)] font-semibold text-ink">
                  Yönettiğim alan
                </h2>
              </div>
              <p className="max-w-sm text-right text-[length:var(--text-sm)] text-muted">
                Bağlı olduğunuz birim ve alt birimlerin toplamı.
              </p>
            </div>

            <MetricStrip
              metrics={managedMetrics}
              donemEtiketi={DONEM_ETIKETLERI[donem]}
              period={donem}
            onaylayici={user.isUnitManager}
              headingId="yonetilen-olcum-basligi"
            />

            <ManagerSummaryBlock
              pendingAbsence={managedMetrics.pendingAbsence}
              newFeedback={managedMetrics.newFeedback}
            />

            {participation ? <TeamBlock participation={participation} /> : null}

            {/* ── Görsel özet ───────────────────────────────────────────
            Kapsamı olmayan kişide grafik çizilmez: tek kişilik bir dağılım
            bilgi değil süstür. */}
            {scope.hasScope ? (
              <SummaryCharts
                trend={trend}
                departments={departmentRows}
                statuses={statuses}
                period={donem}
                donemEtiketi={DONEM_ETIKETLERI[donem]}
              />
            ) : null}

            {/* ── Son kayıtlar ──────────────────────────────────────────
            Akışın tamamı ayrı sayfada; burada yalnız kapı. */}
            {scope.hasScope ? (
              <FeedPreview
                href={akisAdresi}
                count={toplamKayit}
                label={scope.label}
                previewCount={ONIZLEME}
              >
                {onizleme.items.length === 0 ? (
                  <EmptyState
                    title="Bu aralıkta kayıt yok."
                    description="Dönemi genişletmeyi deneyin ya da akış sayfasından süzgeçleri değiştirin."
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {onizleme.items.map((item) => (
                      <FeedRow key={item.id} item={item} />
                    ))}
                  </ul>
                )}
              </FeedPreview>
            ) : null}
          </section>
        ) : (
          // Kardeş bölümlerle (KİŞİSEL ÖZET / YÖNETİLEN ALAN) aynı metin
          // başlığı deseni kullanılır — ayrı bir kutu (Card) değil, çünkü
          // burada gösterilecek veri yok, yalnız kapsamın neden boş olduğunun
          // açıklaması var. Farklı bir görsel kalıp yeni bir anlam üstlenmezdi
          // (DESIGN-IS-2026-09-02, Görev 15.3).
          <section
            aria-labelledby="yonettigim-alan"
            data-test="yonetilen-alan-yok"
            className="flex flex-col gap-(--spacing-block)"
          >
            <div className="border-b border-line pb-3">
              <span className="section-label">YÖNETİLEN ALAN</span>
              <h2 id="yonettigim-alan" className="mt-1 text-[length:var(--text-xl)] font-semibold text-ink">
                Yönettiğim alan
              </h2>
            </div>
            <p className="prose-measure text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
              Bu ekranda kendi kayıtlarınızı görürsünüz. Başkalarının
              faaliyetleri, yalnızca organizasyonda sizin altınızda kalan
              kişilere aitse görünür.
            </p>
          </section>
        )}

        {operations ? <OperationsBlock summary={operations} /> : null}
      </Page>
    </AppShell>
  );
}
