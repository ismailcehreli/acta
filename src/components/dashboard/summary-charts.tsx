import Link from "next/link";

import type { DepartmentSummaryRow } from "@/server/dashboard/department-summary";
import type { StatusSlice, TrendSummary } from "@/server/dashboard/charts";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

import { DistributionBars, type DistributionRow } from "./distribution-bars";
import { TrendChart } from "./trend-chart";

// Ana ekranın görsel özeti.
//
// Üç soru, üç görsel:
//   1. Son iki hafta kaç kayıt girildi? (sütun grafiği)
//   2. Hangi departman ne kadar yazdı? (oran çubukları)
//   3. Kayıtlar hangi aşamada? (oran çubukları)
//
// Hepsi sunucuda hesaplanıyor ve kapsam süzgecinden geçiyor: bir çubuğun
// yüksekliği de bilgidir, göremediğin kayıt ona eklenemez.

const DURUM_ADLARI: Record<StatusSlice["status"], string> = {
  APPROVED: "Onaylandı",
  PENDING_APPROVAL: "Onay bekliyor",
  CHANGES_REQUESTED: "Düzeltme istendi",
  REJECTED: "Uygun bulunmadı",
  CANCELLED: "İptal edildi",
  MANAGER_NOT_FOUND: "Yönetici bulunamadı",
  DRAFT: "Taslak",
};

const DURUM_TONLARI: Record<
  StatusSlice["status"],
  DistributionRow["tone"]
> = {
  APPROVED: "success",
  PENDING_APPROVAL: "waiting",
  CHANGES_REQUESTED: "correction",
  REJECTED: "danger",
  CANCELLED: "cancelled",
  MANAGER_NOT_FOUND: "danger",
  DRAFT: undefined,
};

/** Durumu akış süzgecine çeviren anahtar; yalnız süzülebilenler. */
const DURUM_FILTRE: Partial<Record<StatusSlice["status"], string>> = {
  PENDING_APPROVAL: "onay",
  CHANGES_REQUESTED: "duzeltme",
  REJECTED: "reddedilen",
  CANCELLED: "iptal",
};

export function SummaryCharts({
  trend,
  departments,
  statuses,
  period,
  donemEtiketi,
}: {
  trend: TrendSummary;
  departments: DepartmentSummaryRow[];
  statuses: StatusSlice[];
  period: string;
  donemEtiketi: string;
}) {
  // Departman özeti eskiden ayrı bir tabloydu; dağılım çubuklarına taşındı.
  // Kişi sayısı ve bugünkü katılım bilgisi kaybolmasın diye satır ipucunda
  // duruyor — çubuk oranı gösterir, ipucu bağlamı.
  const cokDepartman = departments.length > 1;

  const departmanSatirlari: DistributionRow[] = departments.map((row) => ({
    key: row.orgUnitId,
    label: `${row.depth > 0 ? `${"· ".repeat(row.depth)} ` : ""}${row.name}`,
    count: row.activityCount,
    hint: [
      row.isRollup
        ? `${row.people} kişi · alt birimler dahil`
        : `${row.people} kişi`,
      row.pendingApproval > 0
        ? `${row.pendingApproval} onay bekliyor`
        : null,
      row.participation
        ? `bugün ${row.participation.wrote}/${row.participation.expected} yazdı`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
    tone: "primary" as const,
    // Toplam satırları alt birimleri de kapsar. Akış filtresi tek birimi
    // gösterdiği için böyle bir satırı bağlamak kullanıcıyı eksik listeye
    // götürürdü; doğrudan birim satırları ise güvenle açılabilir.
    href: row.isRollup
      ? undefined
      : `/feed?${new URLSearchParams({
          period,
          authorOrgUnitId: row.orgUnitId,
        }).toString()}`,
  }));

  const durumSatirlari: DistributionRow[] = statuses.map((dilim) => {
    const filtre = DURUM_FILTRE[dilim.status];

    return {
      key: dilim.status,
      label: DURUM_ADLARI[dilim.status] ?? dilim.status,
      count: dilim.count,
      tone: DURUM_TONLARI[dilim.status],
      href: filtre
        ? `/feed?${new URLSearchParams({ period, durum: filtre }).toString()}`
        : `/feed?${new URLSearchParams({ period }).toString()}`,
    };
  });

  return (
    <div className="grid gap-(--spacing-block) lg:grid-cols-2">
      <Card className="min-w-0 lg:col-span-2">
        <CardHeader
          title="Günlük kayıt sayısı"
          description="Gri sütunlar hafta sonudur."
        />
        <CardBody>
          <TrendChart trend={trend} />
        </CardBody>
      </Card>

      {/* Tek departmanlı yöneticide dağılım yok: tek çubuk %100 gösterir ve
          hiçbir şey söylemez. Blok o zaman hiç çizilmiyor ve durum kartı
          satırın tamamını alıyor. */}
      {cokDepartman ? (
        <Card className="min-w-0" data-test="departman-ozeti">
          <CardHeader
            title="Hangi departman ne kadar yazdı"
            description={`${donemEtiketi}. Doğrudan birim satırına tıklayarak o birimin akışını açın.`}
          />
          <CardBody>
            <DistributionBars
              rows={departmanSatirlari}
              emptyText="Bu aralıkta hiçbir departmanda kayıt yok."
            />
          </CardBody>
        </Card>
      ) : null}

      <Card className={cokDepartman ? "min-w-0" : "min-w-0 lg:col-span-2"}>
        <CardHeader
          title="Kayıtlar hangi aşamada"
          description={`${donemEtiketi} yazılanlar.`}
        />
        <CardBody>
          <DistributionBars
            rows={durumSatirlari}
            emptyText="Bu aralıkta kayıt yok."
          />
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * Ana ekrandaki kısa akış önizlemesi; tamamı ayrı sayfada.
 *
 * Başlık **kapsamın adıdır** ("Departmanım", "Tüm şirket"): kullanıcı bu beş
 * satırın kimin kayıtları olduğunu bilmeli. Kapsam adı olmadan liste, "son
 * kayıtlar" diye adsız bir yığına dönüşür.
 */
export function FeedPreview({
  children,
  previewCount,
  href,
  count,
  label,
}: {
  children: React.ReactNode;
  /** Önizlemede kaç kayıt gösterildiği; metin bu sayıdan beslenir. */
  previewCount: number;
  href: string;
  count: number;
  label: string;
}) {
  return (
    <Card>
      <CardHeader
        title={label}
        description={`En son gelen ${previewCount} kayıt.`}
        action={
          <Link
            href={href}
            className="text-[length:var(--text-sm)] text-primary underline-offset-4 hover:underline"
          >
            {count > 0 ? `Tüm akışı gör (${count})` : "Tüm akışı gör"}
          </Link>
        }
      />
      {children}
    </Card>
  );
}
