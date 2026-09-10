import type { OperationsSummary } from "@/server/dashboard/summary";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

// Sistem yöneticisinin işletim bloğu (§12.4, §15.1).
//
// **Faaliyet içeriği yoktur ve olamaz:** sistem yöneticisinin yetkisi
// işlevseldir, içeriğe erişim vermez. Burada yalnız sistemin çalışıp
// çalışmadığı görünür — zamanlayıcı durursa sistem "çalışıyor" görünür ama
// hatırlatmalar sessizce ölür; bu blok o arızayı ana ekrana taşır.

function yedekMetni(
  hours: number | null,
  izleniyor: boolean,
): { metin: string; sorunlu: boolean } {
  if (!izleniyor) return { metin: "izleme kapalı", sorunlu: false };
  if (hours === null) return { metin: "hiç alınmadı", sorunlu: true };
  if (hours < 1) return { metin: "bir saatten yeni", sorunlu: false };
  if (hours < 48) return { metin: `${hours} saat önce`, sorunlu: false };
  return { metin: `${Math.floor(hours / 24)} gün önce`, sorunlu: true };
}

export function OperationsBlock({ summary }: { summary: OperationsSummary }) {
  const yedek = yedekMetni(summary.backupAgeHours, summary.backupMonitoring);
  const sorunVar =
    summary.jobsDelayed > 0 || summary.queueFailed > 0 || yedek.sorunlu;

  return (
    <Card data-test="sistem-durumu">
      <CardHeader
        title="Sistem durumu"
        description="Yalnız sistem yöneticisine görünür. Faaliyet içeriği içermez."
        action={
          sorunVar ? (
            <Badge tone="correction">ilgi bekliyor</Badge>
          ) : (
            <Badge tone="success">her şey yolunda</Badge>
          )
        }
      />
      <CardBody className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wide)] text-muted uppercase">
              Zamanlanmış iş
            </dt>
            <dd
              className={
                summary.jobsDelayed > 0
                  ? "text-[length:var(--text-lg)] font-semibold tabular text-correction"
                  : "text-[length:var(--text-lg)] font-semibold tabular text-ink"
              }
            >
              {summary.jobsTotal - summary.jobsDelayed}/{summary.jobsTotal}
              <span className="ml-1 text-[length:var(--text-xs)] font-normal text-muted">
                çalışıyor
              </span>
            </dd>
          </div>

          <div>
            <dt className="text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wide)] text-muted uppercase">
              Bekleyen bildirim
            </dt>
            <dd className="text-[length:var(--text-lg)] font-semibold tabular text-ink">
              {summary.queuePending}
            </dd>
          </div>

          <div>
            <dt className="text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wide)] text-muted uppercase">
              Başarısız bildirim
            </dt>
            <dd
              className={
                summary.queueFailed > 0
                  ? "text-[length:var(--text-lg)] font-semibold tabular text-danger"
                  : "text-[length:var(--text-lg)] font-semibold tabular text-ink"
              }
            >
              {summary.queueFailed}
            </dd>
          </div>

          <div>
            <dt className="text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wide)] text-muted uppercase">
              Son yedek
            </dt>
            <dd
              className={
                yedek.sorunlu
                  ? "text-[length:var(--text-lg)] font-semibold text-correction"
                  : "text-[length:var(--text-lg)] font-semibold text-ink"
              }
            >
              {yedek.metin}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/admin/jobs" size="sm">
            İşler
          </ButtonLink>
          <ButtonLink href="/admin/audit" size="sm">
            İşlem kayıtları
          </ButtonLink>
          <ButtonLink href="/admin/settings" size="sm">
            Ayarlar
          </ButtonLink>
        </div>
      </CardBody>
    </Card>
  );
}
