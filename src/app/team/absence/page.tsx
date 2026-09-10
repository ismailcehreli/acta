import { redirect } from "next/navigation";

import {
  absenceDecisionRouteLabel,
  AbsenceStatusBadge,
} from "@/components/absence/absence-status";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordField, RecordItem, RecordList } from "@/components/ui/table";
import {
  countTeamAbsences,
  departmentEmployeeIds,
  listTeamAbsences,
  subordinateManagerIds,
  type AbsenceFilters,
  visibleAbsenceUserIds,
} from "@/server/absence/service";
import { resolvePageSize } from "@/server/preferences/page-size";
import { FilterBar } from "@/components/filters/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { getCurrentUser } from "@/server/auth/current-user";
import { subordinateUserIds } from "@/server/authz/visibility";
import { prisma } from "@/server/db";

import {
  AbsenceDecisionActions,
  CancelAbsenceButton,
  MarkAbsenceForm,
} from "./absence-forms";
import {
  formatDay,
  formatInstantShort,
  toDateValue,
} from "@/shared/format/date-time";

// İzin listesi, üst yöneticinin alt organizasyonunu da gösterir. Kayıt açma
// yetkisi ve onay/red yetkisi ise sunucu tarafında ayrıca daraltılır.

export const metadata = { title: "Ekip izinleri" };

function gunMetni(date: string): string {
  return formatDay(toDateValue(date));
}

export default async function TeamAbsencePage({
  searchParams,
}: {
  searchParams: Promise<{
    kisi?: string;
    durum?: string;
    sayfa?: string;
    boyut?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const now = new Date();
  const [
    subordinates,
    departmentEmployees,
    visibleUserIds,
    delegatedManagerIds,
  ] = await Promise.all([
    subordinateUserIds(prisma, viewer.id),
    departmentEmployeeIds(prisma, viewer.id),
    visibleAbsenceUserIds(prisma, viewer.id, now),
    subordinateManagerIds(prisma, viewer.id),
  ]);

  const params = await searchParams;

  const filters: AbsenceFilters = {
    userId: params.kisi || undefined,
    status:
      params.durum === "gecerli"
        ? "active"
        : params.durum === "bekliyor"
          ? "pending"
          : params.durum === "reddedildi"
            ? "rejected"
            : params.durum === "iptal"
              ? "cancelled"
              : undefined,
  };

  const SAYFA_BOYU = await resolvePageSize(params.boyut);
  const istenen = Number.parseInt(params.sayfa ?? "1", 10);
  const sayfa = Number.isFinite(istenen) && istenen > 0 ? istenen : 1;

  const [people, visiblePeople, managerPeople, toplam] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: departmentEmployees }, isActive: true },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    }),
    prisma.user.findMany({
      where: { id: { in: visibleUserIds }, isActive: true },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    }),
    prisma.user.findMany({
      where: {
        id: { in: delegatedManagerIds.filter((id) => id !== viewer.id) },
        isActive: true,
        isUnitManager: true,
      },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    }),
    countTeamAbsences(prisma, viewer.id, visibleUserIds, filters, now),
  ]);

  const sayfaSayisi = Math.max(1, Math.ceil(toplam / SAYFA_BOYU));
  const gecerliSayfa = Math.min(sayfa, sayfaSayisi);

  const absences = await listTeamAbsences(
    prisma,
    viewer.id,
    visibleUserIds,
    filters,
    { limit: SAYFA_BOYU, skip: (gecerliSayfa - 1) * SAYFA_BOYU, now },
  );

  const adres = (ek: Record<string, string> = {}) =>
    buildQueryAddress(
      "/team/absence",
      { kisi: params.kisi, durum: params.durum, boyut: String(SAYFA_BOYU) },
      ek,
    );

  const suzgecliMi = Boolean(params.kisi) || Boolean(params.durum);

  return (
    <AppShell
      user={await toShellUser(user, subordinates)}
    >
      <Page isaret="ekip-izinleri">
        <PageHeader
          title="Ekip izinleri"
          description="Departmanınızdaki çalışanların izin günlerini yönetin. Alt birimlerdeki kayıtları görebilir, yalnız size yönlendirilen talepleri karara bağlayabilirsiniz."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Ekip izinleri" }]}
        />

        {visibleUserIds.length === 0 && managerPeople.length === 0 ? (
          <Card>
            <EmptyState
              title="Ekibinizde kullanıcı yok"
              description="Size bağlı bir kullanıcı tanımlandığında bu ekrandan gün girebilirsiniz."
            />
          </Card>
        ) : (
          <>
            {managerPeople.length > 0 ? (
              <Card>
                <CardHeader
                  title="Yönetici vekâleti ekle"
                  description="İzne çıkacak yöneticiyi ve onun yerine karar verecek yöneticiyi seçin. Bu ayrı akış yalnız yöneticiler için kullanılır."
                />
                <CardBody>
                  <MarkAbsenceForm
                    people={managerPeople}
                    deputyPeople={managerPeople}
                    deputyRequired
                  />
                </CardBody>
              </Card>
            ) : null}

            {departmentEmployees.length > 0 ? (
              <Card>
                <CardHeader
                  title="İzin günü ekle"
                  description="Departmanınızdaki çalışanı ve tarih aralığını seçin. Bu ekrandan girilen kayıtlar doğrudan geçerli olur. Çalışanlar kendi izin taleplerini İzinlerim bölümünden gönderir."
                />
                <CardBody>
                  <MarkAbsenceForm
                    people={people}
                    personLabel={managerPeople.length > 0 ? "Çalışan" : "Kişi"}
                  />
                </CardBody>
              </Card>
            ) : null}

            <Card>
              <CardHeader
                title="Girilen izinler"
                description="Bekleyen talepleri karara bağlayın. Onaylanan kayıtlar geçerli olur; reddedilen veya iptal edilen kayıtlar geçmişte görünmeye devam eder."
                action={
                  <span className="mono text-[length:var(--text-sm)] text-muted">
                    {toplam} kayıt
                  </span>
                }
              />

              <FilterBar
                action="/team/absence"
                clearHref="/team/absence"
                filtered={suzgecliMi}
                pageSize={SAYFA_BOYU}
                fields={[
                  {
                    name: "kisi",
                    label: "Kime ait",
                    value: params.kisi ?? "",
                    options: [
                      { value: "", label: "Herkes" },
                      ...visiblePeople.map((k) => ({ value: k.id, label: k.fullName })),
                    ],
                  },
                  {
                    name: "durum",
                    label: "Kayıt durumu",
                    value: params.durum ?? "",
                    width: "w-40",
                    options: [
                      { value: "", label: "Hepsi" },
                      { value: "gecerli", label: "Geçerli" },
                      { value: "bekliyor", label: "Onay bekleyen" },
                      { value: "reddedildi", label: "Reddedilen" },
                      { value: "iptal", label: "İptal edilmiş" },
                    ],
                  },
                ]}
              />

              {/* Ekip işaretleri kayıt defteri olarak listelenir: bu
                  ekran telefondan da açılır ("kim izinli?") ve beş sütunlu
                   bir tabloyu sıkıştırmak yerine her işaret etiketli
                   alanlardan oluşan bir kayıt olur (brief §5 mobil). */}
              {absences.length === 0 ? (
                suzgecliMi ? (
                  <EmptyState
                    title="Süzgece uyan kayıt yok"
                    description="Süzgeci temizleyerek bütün kayıtları görebilirsiniz."
                  />
                ) : (
                  <EmptyState
                    title="Kayıt yok"
                    description="Alt organizasyonunuzdaki kişiler için izin kaydı girilmedi."
                  />
                )
              ) : (
                <RecordList>
                  {absences.map((absence) => (
                    <RecordItem key={absence.id} data-test="izin-satiri">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <p
                            className={
                              absence.cancelledReason
                                ? "font-medium text-muted line-through"
                                : "font-medium text-ink"
                            }
                          >
                            {absence.userName}
                          </p>
                          <p className="tabular text-[length:var(--text-sm)] text-muted">
                            {gunMetni(absence.startDate)} – {gunMetni(absence.endDate)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {absence.cancelledReason ? (
                              <Badge tone="cancelled">İptal edildi</Badge>
                            ) : (
                              <AbsenceStatusBadge status={absence.status} />
                            )}
                          </div>
                        </div>
                        {absence.cancelledReason ? null : (
                          <div className="flex flex-wrap items-center gap-2">
                            {absence.status === "PENDING" && absence.canDecide ? (
                              <AbsenceDecisionActions absence={absence} />
                            ) : null}
                            {absence.status === "REJECTED" || !absence.canCancel ? null : (
                              <CancelAbsenceButton absence={absence} />
                            )}
                          </div>
                        )}
                      </div>

                      {absence.cancelledReason ? (
                        <div className="mt-2.5">
                          <RecordField label="İptal edildi">
                            {absence.cancelledReason}
                          </RecordField>
                        </div>
                      ) : null}

                      {absence.status === "REJECTED" && absence.decisionReason ? (
                        <div className="mt-2.5">
                          <RecordField label="Reddetme gerekçesi">
                            {absence.decisionReason}
                          </RecordField>
                        </div>
                      ) : null}

                      {absence.note || absence.deputyName || absence.decidedByName ? (
                        <div className="mt-2.5 flex flex-wrap gap-x-8 gap-y-2">
                          {absence.note ? (
                            <RecordField label="Not">{absence.note}</RecordField>
                          ) : null}
                          {absence.deputyName ? (
                            <RecordField label="Vekil">{absence.deputyName}</RecordField>
                          ) : null}
                          {absence.decidedByName ? (
                            <RecordField
                              label={absence.status === "REJECTED" ? "Reddeden" : "Onaylayan"}
                            >
                              {absence.decidedByName}
                              {absence.decisionRoute
                                ? ` · ${absenceDecisionRouteLabel(absence.decisionRoute)}`
                                : ""}
                            </RecordField>
                          ) : null}
                          {absence.decidedAt ? (
                            <RecordField label="Karar zamanı">
                              {formatInstantShort(absence.decidedAt)}
                            </RecordField>
                          ) : null}
                        </div>
                      ) : null}
                    </RecordItem>
                  ))}
                </RecordList>
              )}

              <Pagination
                page={gecerliSayfa}
                pageCount={sayfaSayisi}
                hrefFor={(hedef) =>
                  hedef === 1 ? adres() : adres({ sayfa: String(hedef) })
                }
              />
            </Card>
          </>
        )}
      </Page>
    </AppShell>
  );
}
