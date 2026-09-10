import Link from "next/link";
import { redirect } from "next/navigation";

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
import { DONEM_SECENEKLERI, FilterBar } from "@/components/filters/filter-bar";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { resolvePageSize } from "@/server/preferences/page-size";
import { RecordItem, RecordList } from "@/components/ui/table";
import { ApprovalBadge } from "@/components/activities/approval-badge";
import { formatDay } from "@/shared/format/date-time";
import { describeActivityDates } from "@/shared/format/activity-dates";

// Kendi faaliyetlerim (§5, §13). Kapsam akışı ana ekrandadır; burada yalnız
// kişinin kendi yazdıkları listelenir — düzeltme ve iptal buradan yapılır.

export const metadata = { title: "Faaliyetlerim" };

/** Adres çubuğundaki dönem; tanınmayan değer "tümü" sayılır. */
function parsePeriod(value: string | undefined): OwnActivityFilters["period"] {
  return value === "today" || value === "week" || value === "all" ? value : "all";
}

// Kendi arşivinde varsayılan dönem **tümü**dür: kişi burada geçmişini arar,
// kapsam akışında ise günceli izler. İki ekranın varsayılanı bilerek farklı.
const DURUMLAR: Record<string, NonNullable<OwnActivityFilters["status"]>> = {
  onay: "PENDING_APPROVAL",
  duzeltme: "CHANGES_REQUESTED",
  reddedilen: "REJECTED",
  iptal: "CANCELLED",
};

const BILGI: Record<string, string> = {
  eklendi: "Faaliyet kaydedildi.",
  iptal: "Faaliyet iptal edildi. Kayıt silinmez; gerekçesiyle birlikte görünür.",
  duzeltildi: "Faaliyet düzeltildi; revizyon kaydı tutuldu.",
};

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{
    kayit?: string;
    sayfa?: string;
    boyut?: string;
    period?: string;
    durum?: string;
    targetOrgUnitId?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const { kayit } = params;
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };

  // Sayfa numarası adres çubuğundan gelir; doğrulanmadan sorguya girmez.
  const istenen = Number.parseInt(params.sayfa ?? "1", 10);
  const sayfa = Number.isFinite(istenen) && istenen > 0 ? istenen : 1;

  // Sayfa boyu tercihi: adres çubuğu → çerez → varsayılan. Kendi arşivi
  // durağan olduğu için numaralı sayfalama burada güvenli.
  const SAYFA_BOYU = await resolvePageSize(params.boyut);

  // Süzgeçler adres çubuğundan gelir ve **doğrulanmadan** sorguya girmez:
  // tanınmayan bir değer süzgeci sessizce düşürür, hataya çevirmez — eski
  // bir bağlantı bozuk sayfa açmasın (Görev 11.3).
  const filters: OwnActivityFilters = {
    period: parsePeriod(params.period),
    now: new Date(),
    status: params.durum ? DURUMLAR[params.durum] : undefined,
    openQuestions: params.durum === "soru" || undefined,
    targetOrgUnitId: params.targetOrgUnitId || undefined,
  };

  const [toplam, subordinates, departments] = await Promise.all([
    countOwnActivities(prisma, viewer, filters),
    subordinateUserIds(prisma, user.id),
    prisma.orgUnit.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const sayfaSayisi = Math.max(1, Math.ceil(toplam / SAYFA_BOYU));
  // Var olmayan sayfaya gidilirse son sayfa gösterilir: boş bir ekran yerine
  // kullanıcının aradığı yerin sonu.
  const gecerliSayfa = Math.min(sayfa, sayfaSayisi);

  const activities = await listOwnActivities(prisma, viewer, filters, {
    limit: SAYFA_BOYU,
    skip: (gecerliSayfa - 1) * SAYFA_BOYU,
  });

  /** Süzgeçleri koruyan adres; sayfalama ve boy seçimi bunu kullanır. */
  const adres = (ek: Record<string, string> = {}) =>
    buildQueryAddress(
      "/activities",
      {
        period: params.period,
        durum: params.durum,
        targetOrgUnitId: params.targetOrgUnitId,
        boyut: String(SAYFA_BOYU),
      },
      ek,
    );

  const suzgecliMi =
    (params.period ?? "all") !== "all" ||
    Boolean(params.durum) ||
    Boolean(params.targetOrgUnitId);

  return (
    <AppShell
      user={await toShellUser(user, subordinates)}
    >
      <Page isaret="faaliyetlerim">
        <PageHeader
          title="Faaliyetlerim"
          description="Yazdığınız kayıtlar. Bir kaydı, düzeltme süresi dolmadan ve onu henüz kimse okumadan düzeltebilirsiniz."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Faaliyetlerim" }]}
          action={
            <ButtonLink href="/activities/new" variant="primary">
              Yeni faaliyet
            </ButtonLink>
          }
        />

        {kayit ? (
          <div id="faaliyet-bilgi" role="status">
            <Alert tone="success">{BILGI[kayit] ?? "İşlem tamamlandı."}</Alert>
          </div>
        ) : null}

        <Card>
          <CardHeader
            title="Kayıt defteri"
            description="Yazdığınız faaliyetler, yeniden eskiye."
            action={
              <span className="mono text-[length:var(--text-sm)] text-muted">
                {toplam} kayıt
              </span>
            }
          />

          <FilterBar
            action="/activities"
            clearHref="/activities"
            filtered={suzgecliMi}
            pageSize={SAYFA_BOYU}
            fields={[
              {
                name: "period",
                label: "Dönem",
                value: params.period ?? "all",
                width: "w-32",
                options: [{ value: "all", label: "Tümü" }, ...DONEM_SECENEKLERI.filter((o) => o.value !== "all")],
              },
              {
                name: "durum",
                label: "Durum",
                value: params.durum ?? "",
                width: "w-44",
                options: [
                  { value: "", label: "Hepsi" },
                  { value: "onay", label: "Onay bekleyen" },
                  { value: "duzeltme", label: "Düzeltme istenen" },
                  { value: "reddedilen", label: "Uygun bulunmayan" },
                  { value: "iptal", label: "İptal edilen" },
                  { value: "soru", label: "Cevap bekleyen faaliyet" },
                ],
              },
              {
                name: "targetOrgUnitId",
                label: "İlgili departman",
                value: params.targetOrgUnitId ?? "",
                width: "w-52",
                options: [
                  { value: "", label: "Hepsi" },
                  ...departments.map((u) => ({ value: u.id, label: u.name })),
                ],
              },
            ]}
          />

          {activities.length === 0 ? (
            // Boşluğun sebebi ayrılır: hiç kayıt yazmamış olmakla, süzgecin
            // listeyi boşaltması aynı şey değil. İlkinde eylem çağrısı
            // doğru, ikincisinde kullanıcıyı yeni kayıt yazmaya davet etmek
            // yanlış yönlendirme olurdu (Görev 11.3).
            suzgecliMi ? (
              <EmptyState
                title="Süzgece uyan kayıt yok."
                description="Süzgeci temizleyerek bütün kayıtlarınızı görebilirsiniz."
                action={
                  <ButtonLink href="/activities" variant="secondary" size="sm">
                    Süzgeci temizle
                  </ButtonLink>
                }
              />
            ) : (
              <EmptyState
                title="Henüz faaliyet yazmadınız."
                description="Günlük işinizi kısa bir kayıtla bırakın; üst kademeler ne yapıldığını buradan görür."
                action={
                  <ButtonLink href="/activities/new" variant="primary" size="sm">
                    İlk faaliyeti yaz
                  </ButtonLink>
                }
              />
            )
          ) : (
            <RecordList>
              {activities.map((activity) => {
                const iptal = activity.approvalStatus === "CANCELLED";

                return (
                  // Uçtan uca testler görsele değil bu işarete bakar.
                  <RecordItem
                    key={activity.id}
                    data-test="faaliyet-satiri"
                    className="transition-colors duration-(--duration-fast) hover:bg-surface-hover sm:px-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                          <span className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
                            #{activity.activityNo}
                          </span>
                          <time className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
                            {formatDay(activity.activityDate)}
                          </time>
                          <Link
                            href={`/activities/${activity.id}`}
                            className={
                              iptal
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
                              {activity.currentRevisionNo}. revizyon
                            </span>
                          ) : null}
                          {activity.targetDepartmentNames.length > 0 ? (
                            <span className="text-faint">
                              {activity.targetDepartmentNames.join(" · ")}
                            </span>
                          ) : null}
                          {/* Kaydın yazıldığı an: faaliyetin gününden ayrıdır.
                              Geçmişe dönük yazılmış kayıtta ikisi ayrışır. */}
                          <time
                            dateTime={activity.createdAt.toISOString()}
                            className="mono text-faint"
                          >
                            {describeActivityDates({
                              ...activity,
                              revisionNo: activity.currentRevisionNo,
                            }).created}
                          </time>
                        </div>

                        {iptal && activity.cancellationReason ? (
                          <p className="prose-measure mt-2 border-s-[3px] border-cancelled-line ps-3 text-[length:var(--text-sm)] text-muted">
                            <span className="font-medium text-ink">İptal gerekçesi:</span>{" "}
                            {activity.cancellationReason}
                          </p>
                        ) : null}
                      </div>

                      {iptal || !activity.canEdit ? null : (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <ButtonLink href={`/activities/${activity.id}/edit`} size="sm">
                            Düzelt
                          </ButtonLink>
                          {activity.approvalStatus === "APPROVED" ? (
                            <ButtonLink
                              href={`/activities/${activity.id}/cancel`}
                              variant="danger"
                              size="sm"
                            >
                              İptal et
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
            page={gecerliSayfa}
            pageCount={sayfaSayisi}
            hrefFor={(hedef) =>
              hedef === 1 ? adres() : adres({ sayfa: String(hedef) })
            }
            totalLabel={
              toplam > SAYFA_BOYU
                ? `${(gecerliSayfa - 1) * SAYFA_BOYU + 1}–${
                    (gecerliSayfa - 1) * SAYFA_BOYU + activities.length
                  } / ${toplam} kayıt`
                : undefined
            }
          />
        </Card>
      </Page>
    </AppShell>
  );
}
