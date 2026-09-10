import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { AdminTabs } from "@/components/ui/admin-tabs";
import { Page, Stat, StatStrip } from "@/components/ui/page";
import {
  UnitSummaryTable,
  type UnitSummaryColumn,
} from "@/components/reports/unit-summary-table";
import {
  REPORT_PERIODS,
  type ActivityReport,
  type AbsenceReport,
  type FeedbackReport,
  type NotificationsReport,
  type ReportPeriod,
  type ReportTab,
  type ReportView,
  type ScoresReport,
} from "@/server/reports/read";

export interface ReportTabOption {
  value: ReportTab;
  label: string;
  hint: string;
}

const NUMBER_FORMAT = new Intl.NumberFormat("tr-TR");

function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatPercentage(value: number | null): string {
  return value === null ? "—" : `%${formatNumber(value)}`;
}

function formatScore(value: number | null): string {
  return value === null ? "—" : `${formatNumber(value)} / 100`;
}

function formatDecimal(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatDuration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${formatNumber(Math.max(1, Math.round(hours * 60)))} dk`;
  if (hours < 24) return `${formatDecimal(hours)} saat`;
  return `${formatDecimal(hours / 24)} gün`;
}

function reportHref(
  tab: ReportTab,
  period: ReportPeriod,
  unitId?: string,
): string {
  const params = new URLSearchParams({ sekme: tab, donem: period });
  if (unitId && tab !== "feedback") params.set("birim", unitId);
  return `/reports?${params.toString()}`;
}

function formatUnitName(name: string, depth: number): ReactNode {
  return (
    <span
      className="block"
      style={{ paddingInlineStart: `${Math.min(depth, 6) * 1.25}rem` }}
    >
      {name}
    </span>
  );
}

function Meaning({ children }: { children: ReactNode }) {
  return (
    <p className="border-s-2 border-primary-line ps-3 text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
      <span className="font-medium text-ink">Bu ne anlatır?</span> {children}
    </p>
  );
}

function Breakdown({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: { label: string; count: number }[];
}) {
  const max = Math.max(...items.map((item) => item.count), 0);

  return (
    <Card>
      <CardHeader title={title} description={description} />
      {items.length === 0 ? (
        <EmptyState
          title="Bu aralıkta veri yok"
          description="Seçtiğiniz dönem için gösterilecek kayıt bulunmuyor."
        />
      ) : (
        <CardBody className="flex flex-col gap-4">
          {items.map((item) => (
            <div key={item.label}>
              <div className="flex items-center justify-between gap-3 text-[length:var(--text-sm)]">
                <span className="min-w-0 truncate text-ink">{item.label}</span>
                <span className="mono shrink-0 text-muted">{formatNumber(item.count)}</span>
              </div>
              <div
                aria-hidden
                className="mt-1 h-1.5 bg-inset"
              >
                <span
                  className="block h-full bg-primary"
                  style={{ width: max === 0 ? "0%" : `${(item.count / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </CardBody>
      )}
    </Card>
  );
}

function ActivityReportView({ data }: { data: ActivityReport }) {
  return (
    <div className="flex flex-col gap-(--spacing-block)">
      <StatStrip>
        <Stat label="Faaliyet" value={formatNumber(data.total)} />
        <Stat label="Faaliyet yazan kişi" value={formatNumber(data.people)} />
        <Stat label="Faaliyet günü" value={formatNumber(data.activityDays)} />
        <Stat
          label="Onay oranı"
          value={formatPercentage(data.approvalRate)}
          tone={data.approvalRate !== null && data.approvalRate < 70 ? "correction" : "primary"}
        />
      </StatStrip>

      <Meaning>
        Onay oranı, karar verilmiş faaliyetler içinde onaylananların payıdır.
        Bekleyen faaliyetler bu orana dahil değildir; böylece yöneticinin
        karar süresi ile içerik değerlendirmesi birbirine karışmaz.
      </Meaning>

      <Card>
        <CardHeader
          title="Karar bekleyenler"
          description="İş akışının nerede yavaşladığını görmek için durumları ayırır."
        />
        <CardBody className="flex flex-wrap gap-x-8 gap-y-3 text-[length:var(--text-sm)]">
          <span className="flex items-center gap-2">
            <Badge tone="success">Onaylanan</Badge>
            <strong className="mono font-semibold">{formatNumber(data.approved)}</strong>
          </span>
          <span className="flex items-center gap-2">
            <Badge tone="waiting">Bekleyen</Badge>
            <strong className="mono font-semibold">{formatNumber(data.pending)}</strong>
          </span>
          <span className="flex items-center gap-2">
            <Badge tone="correction">Düzeltme istenen</Badge>
            <strong className="mono font-semibold">{formatNumber(data.changesRequested)}</strong>
          </span>
          <span className="flex items-center gap-2">
            <Badge tone="danger">Uygun bulunmayan</Badge>
            <strong className="mono font-semibold">{formatNumber(data.rejected)}</strong>
          </span>
          <span className="flex items-center gap-2">
            <Badge tone="cancelled">İptal edilen</Badge>
            <strong className="mono font-semibold">{formatNumber(data.cancelled)}</strong>
          </span>
          {data.pendingOlderThanSevenDays > 0 ? (
            <span className="flex items-center gap-2">
              <Badge tone="danger">7 günden uzun bekleyen</Badge>
              <strong className="mono font-semibold">{formatNumber(data.pendingOlderThanSevenDays)}</strong>
            </span>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Birimlere göre faaliyet özeti"
          description="Üst satırlar alt birimlerin toplamını da içerir; aynı faaliyet iki kez sayılmaz."
        />
        {data.units.length === 0 ? (
          <EmptyState
            title="Bu aralıkta faaliyet yok"
            description="Seçtiğiniz dönem ve birim için henüz faaliyet bulunmuyor."
          />
        ) : (
          <UnitSummaryTable
            label="Birimlere göre faaliyet özeti"
            rows={data.units}
            columns={[
              { key: "unit", header: "Birim", className: "font-medium", render: (unit) => formatUnitName(unit.name, unit.depth) },
              { key: "activities", header: "Faaliyet", align: "right", className: "mono", render: (unit) => formatNumber(unit.activities) },
              { key: "people", header: "Kişi", align: "right", className: "mono", render: (unit) => formatNumber(unit.people) },
              { key: "approved", header: "Onaylanan", align: "right", className: "mono", render: (unit) => formatNumber(unit.approved) },
              { key: "pending", header: "Bekleyen", align: "right", className: "mono", render: (unit) => formatNumber(unit.pending) },
              { key: "approvalRate", header: "Onay oranı", align: "right", className: "mono", render: (unit) => formatPercentage(unit.approvalRate) },
            ] satisfies readonly UnitSummaryColumn<(typeof data.units)[number]>[]}
          />
        )}
      </Card>
    </div>
  );
}

function AbsenceReportView({ data }: { data: AbsenceReport }) {
  return (
    <div className="flex flex-col gap-(--spacing-block)">
      <StatStrip>
        <Stat label="İzin talebi" value={formatNumber(data.periods)} />
        <Stat label="İzin kullanan kişi" value={formatNumber(data.people)} />
        <Stat label="Onaylanan gün" value={formatNumber(data.approvedDays)} tone="primary" />
        <Stat label="Bekleyen gün" value={formatNumber(data.pendingDays)} tone={data.pendingDays > 0 ? "correction" : "neutral"} />
      </StatStrip>

      <Meaning>
        Onaylanan gün sayısı planlanan izin kullanımını, bekleyen gün sayısı
        yöneticinin hâlâ karar vermesi gereken iş yükünü gösterir. İzin
        talepleri raporda gün hesabını bozmayacak şekilde seçilen dönemle
        kesiştiği günler üzerinden sayılır.
      </Meaning>

      <Card>
        <CardHeader
          title="İzin taleplerinin durumu"
          description="Bekleyen talepler karar verilmesi gereken, reddedilenler ise planlamaya dahil olmayan taleplerdir."
        />
        <CardBody className="flex flex-wrap gap-x-8 gap-y-3 text-[length:var(--text-sm)]">
          <span className="flex items-center gap-2"><Badge tone="success">Onaylanan</Badge><strong className="mono">{formatNumber(data.approved)}</strong></span>
          <span className="flex items-center gap-2"><Badge tone="waiting">Bekleyen</Badge><strong className="mono">{formatNumber(data.pending)}</strong></span>
          <span className="flex items-center gap-2"><Badge tone="danger">Reddedilen</Badge><strong className="mono">{formatNumber(data.rejected)}</strong></span>
          <span className="flex items-center gap-2"><Badge tone="cancelled">İptal edilen</Badge><strong className="mono">{formatNumber(data.cancelled)}</strong></span>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Birimlere göre izin özeti"
          description="Kişi sayısı, aynı kişinin birden fazla izin dönemi olsa da bir kez sayılır."
        />
        {data.units.length === 0 ? (
          <EmptyState title="Bu aralıkta izin kaydı yok" description="Seçtiğiniz dönem ve birim için izin talebi bulunmuyor." />
        ) : (
          <UnitSummaryTable
            label="Birimlere göre izin özeti"
            rows={data.units}
            columns={[
              { key: "unit", header: "Birim", className: "font-medium", render: (unit) => formatUnitName(unit.name, unit.depth) },
              { key: "people", header: "Kişi", align: "right", className: "mono", render: (unit) => formatNumber(unit.people) },
              { key: "periods", header: "Talep", align: "right", className: "mono", render: (unit) => formatNumber(unit.periods) },
              { key: "approvedDays", header: "Onaylanan gün", align: "right", className: "mono", render: (unit) => formatNumber(unit.approvedDays) },
              { key: "pending", header: "Bekleyen talep", align: "right", className: "mono", render: (unit) => formatNumber(unit.pending) },
            ] satisfies readonly UnitSummaryColumn<(typeof data.units)[number]>[]}
          />
        )}
      </Card>
    </div>
  );
}

function NotificationsReportView({ data }: { data: NotificationsReport }) {
  return (
    <div className="flex flex-col gap-(--spacing-block)">
      <StatStrip>
        <Stat label="Bildirim" value={formatNumber(data.total)} />
        <Stat label="Başarı oranı" value={formatPercentage(data.successRate)} tone={data.successRate !== null && data.successRate < 90 ? "correction" : "primary"} />
        <Stat label="Gönderilen" value={formatNumber(data.sent)} tone="primary" />
        <Stat label="Başarısız" value={formatNumber(data.failed)} tone={data.failed > 0 ? "correction" : "neutral"} />
      </StatStrip>

      <Meaning>
        Başarı oranı, gönderim denemesi sonuçlanan bildirimler içinde başarıyla
        gönderilenlerin oranıdır. Bekleyenler henüz başarısız sayılmaz; bu
        rapor bildirim metnini veya kişisel içeriği göstermez.
      </Meaning>

      <div className="grid gap-(--spacing-block) lg:grid-cols-2">
        <Breakdown
          title="Kanala göre dağılım"
          description="Bildirimlerin e-posta ve tarayıcı kanallarındaki dağılımı."
          items={data.byChannel}
        />
        <Breakdown
          title="Olaylara göre dağılım"
          description="En çok bildirim üreten iş akışlarını görmenizi sağlar."
          items={data.byEvent}
        />
      </div>

      <Card>
        <CardHeader
          title="Birimlere göre bildirim özeti"
          description="Kuyruktaki bildirim sayıları kişi bağlı olduğu birime göre gruplanır."
        />
        {data.units.length === 0 ? (
          <EmptyState title="Bu aralıkta bildirim yok" description="Seçtiğiniz dönem ve birim için bildirim üretilmemiş." />
        ) : (
          <UnitSummaryTable
            label="Birimlere göre bildirim özeti"
            rows={data.units}
            columns={[
              { key: "unit", header: "Birim", className: "font-medium", render: (unit) => formatUnitName(unit.name, unit.depth) },
              { key: "total", header: "Toplam", align: "right", className: "mono", render: (unit) => formatNumber(unit.total) },
              { key: "sent", header: "Gönderilen", align: "right", className: "mono", render: (unit) => formatNumber(unit.sent) },
              { key: "pending", header: "Bekleyen", align: "right", className: "mono", render: (unit) => formatNumber(unit.pending) },
              { key: "failed", header: "Başarısız", align: "right", className: "mono", render: (unit) => formatNumber(unit.failed) },
            ] satisfies readonly UnitSummaryColumn<(typeof data.units)[number]>[]}
          />
        )}
      </Card>
    </div>
  );
}

function ScoresReportView({ data }: { data: ScoresReport }) {
  return (
    <div className="flex flex-col gap-(--spacing-block)">
      <StatStrip>
        <Stat label="Karne kaydı" value={formatNumber(data.periods)} />
        <Stat label="Puanlanan kişi" value={formatNumber(data.people)} />
        <Stat label="Ortalama genel puan" value={formatScore(data.averageTotal)} tone="primary" />
        <Stat label="Takdir puanı" value={`+${formatNumber(data.appreciationPoints)}`} tone={data.appreciationPoints > 0 ? "primary" : "neutral"} />
      </StatStrip>

      <Meaning>
        Genel puan, dönem karne kayıtlarının ortalamasıdır. Düzenli raporlama,
        kabul veya onay süresi ve takip disiplini üç temel bölüm olarak ayrı
        gösterilir; takdir puanı ise ayrıca eklenen katkıyı anlatır. Bu rapor
        yalnız kapanmış dönemleri kullanır.
      </Meaning>

      <Card>
        <CardHeader
          title="Puan bölümleri"
          description="Bir bölümün boş olması, o dönemde o ölçümün kişi için geçerli olmadığı anlamına gelir."
        />
        <CardBody className="flex flex-wrap gap-x-8 gap-y-3 text-[length:var(--text-sm)]">
          <span>Düzenli raporlama: <strong className="mono">{formatScore(data.averageRegularity)}</strong></span>
          <span>Kabul oranı: <strong className="mono">{formatScore(data.averageAcceptance)}</strong></span>
          <span>Onay süresi: <strong className="mono">{formatScore(data.averageApproval)}</strong></span>
          <span>Takip disiplini: <strong className="mono">{formatScore(data.averageFollowUp)}</strong></span>
          <span>Takdir sayısı: <strong className="mono">{formatNumber(data.appreciationCount)}</strong></span>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Birimlere göre skor özeti"
          description="Üst satırlar alt birimlerin karne kayıtlarını da içerir."
        />
        {data.units.length === 0 ? (
          <EmptyState title="Kapanmış skor dönemi yok" description="Seçtiğiniz aralıkta raporlanacak donmuş dönem bulunmuyor." />
        ) : (
          <UnitSummaryTable
            label="Birimlere göre skor özeti"
            rows={data.units}
            columns={[
              { key: "unit", header: "Birim", className: "font-medium", render: (unit) => formatUnitName(unit.name, unit.depth) },
              { key: "periods", header: "Karne", align: "right", className: "mono", render: (unit) => formatNumber(unit.periods) },
              { key: "people", header: "Kişi", align: "right", className: "mono", render: (unit) => formatNumber(unit.people) },
              { key: "averageTotal", header: "Ort. puan", align: "right", className: "mono", render: (unit) => formatScore(unit.averageTotal) },
              { key: "appreciationCount", header: "Takdir", align: "right", className: "mono", render: (unit) => formatNumber(unit.appreciationCount) },
              { key: "appreciationPoints", header: "Takdir puanı", align: "right", className: "mono", render: (unit) => `+${formatNumber(unit.appreciationPoints)}` },
            ] satisfies readonly UnitSummaryColumn<(typeof data.units)[number]>[]}
          />
        )}
      </Card>
    </div>
  );
}

function FeedbackReportView({ data }: { data: FeedbackReport }) {
  return (
    <div className="flex flex-col gap-(--spacing-block)">
      <StatStrip>
        <Stat label="Geri bildirim" value={formatNumber(data.total)} />
        <Stat label="Yeni" value={formatNumber(data.newCount)} tone={data.newCount > 0 ? "primary" : "neutral"} />
        <Stat label="İncelemede" value={formatNumber(data.inReview)} tone={data.inReview > 0 ? "correction" : "neutral"} />
        <Stat label="Çözülen" value={formatNumber(data.resolved)} tone="primary" />
      </StatStrip>

      <Meaning>
        Yeni ve incelemedeki geri bildirimler yöneticinin ele alması gereken
        iş yükünü, ilk okuma ve çözüm süreleri ise kullanıcıya ne kadar hızlı
        dönüş yapıldığını gösterir. İçerik rapora dahil edilmez; detaylar
        yalnız geri bildirim yönetimi ekranında yetkili yöneticilere açıktır.
      </Meaning>

      <div className="grid gap-(--spacing-block) lg:grid-cols-2">
        <Breakdown
          title="Türlere göre dağılım"
          description="Hata, öneri, eleştiri ve soru kayıtlarının sayısı."
          items={data.byCategory}
        />
        <Card>
          <CardHeader
            title="Yanıt süresi"
            description="Kullanıcının bekleme deneyimini takip etmek için ortalamalar."
          />
          <CardBody className="grid grid-cols-2 gap-6 sm:max-w-lg">
            <Stat label="İlk okuma" value={formatDuration(data.averageFirstReadHours)} />
            <Stat label="Çözüm" value={formatDuration(data.averageResolutionHours)} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ReportDataView({ data }: { data: ReportView["data"] }) {
  switch (data.tab) {
    case "absence":
      return <AbsenceReportView data={data} />;
    case "notifications":
      return <NotificationsReportView data={data} />;
    case "scores":
      return <ScoresReportView data={data} />;
    case "feedback":
      return <FeedbackReportView data={data} />;
    case "activities":
    default:
      return <ActivityReportView data={data} />;
  }
}

function ReportFilters({
  report,
  period,
  tab,
  selectedUnitId,
}: {
  report: ReportView;
  period: ReportPeriod;
  tab: ReportTab;
  selectedUnitId?: string;
}) {
  return (
    <Card className="bg-raised">
      <CardBody>
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="sekme" value={tab} />
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-xs">
            <span className="text-[length:var(--text-sm)] font-medium text-ink">Dönem</span>
            <Select name="donem" defaultValue={period}>
              {REPORT_PERIODS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </Select>
          </label>
          {tab !== "feedback" ? (
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[length:var(--text-sm)] font-medium text-ink">Birim kapsamı</span>
              <Select name="birim" defaultValue={selectedUnitId ?? ""}>
                <option value="">{report.scope.rootOrgUnitName} ve alt birimleri</option>
                {report.scope.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {`${"· ".repeat(Math.min(unit.depth, 6))}${unit.name}`}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <Button type="submit" size="sm">Uygula</Button>
          {selectedUnitId || period !== "month" ? (
            <Link href={reportHref(tab, "month")} className="inline-flex h-8 items-center px-2.5 text-[length:var(--text-xs)] text-muted hover:text-ink">
              Temizle
            </Link>
          ) : null}
        </form>
        <p className="mt-3 text-[length:var(--text-xs)] text-muted">
          Rapor aralığı: <span className="font-medium text-ink">{report.range.label}</span>
          {tab === "feedback" ? (
            <> · Bu özet sistem yöneticileri için tüm sistem verisini gösterir.</>
          ) : (
            <> · Kapsam: <span className="font-medium text-ink">{report.selectedScope.rootOrgUnitName}</span> ve alt birimleri</>
          )}
        </p>
      </CardBody>
    </Card>
  );
}

export function ReportsView({
  report,
  tabs,
  tab,
  period,
  selectedUnitId,
}: {
  report: ReportView;
  tabs: ReportTabOption[];
  tab: ReportTab;
  period: ReportPeriod;
  selectedUnitId?: string;
}) {
  const activeHref = reportHref(tab, period, selectedUnitId);

  return (
    <>
      <AdminTabs
        tabs={tabs.map((item) => ({
          href: reportHref(item.value, period, selectedUnitId),
          label: item.label,
          hint: item.hint,
        }))}
        activeHref={activeHref}
      />

      <ReportFilters
        report={report}
        period={period}
        tab={tab}
        selectedUnitId={selectedUnitId}
      />

      <ReportDataView data={report.data} />
    </>
  );
}

export function ReportPageFrame({
  children,
  report,
}: {
  children: ReactNode;
  report: ReportView;
}) {
  return (
    <Page isaret="raporlar">
      {children}
      <p className="text-[length:var(--text-xs)] text-faint">
        Bu ekran karar vermeyi kolaylaştıran toplu göstergeler sunar. Kayıt
        metinleri ve kişisel bildirim içerikleri raporlama kapsamına alınmaz.
      </p>
      <span className="sr-only">{report.selectedScope.rootOrgUnitName}</span>
    </Page>
  );
}
