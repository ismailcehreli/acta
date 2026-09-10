import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { listBackupRequests } from "@/server/backup/requests";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader, Stat } from "@/components/ui/page";
import { AdminTabs } from "@/components/ui/admin-tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { JOB_NAMES, listJobHealth } from "@/server/jobs/status";
import {
  formatJobInterval,
  jobLabel,
} from "@/server/jobs/labels";
import { readSmtpView } from "@/server/settings/smtp";
import { readBooleanSetting, SETTING_KEYS } from "@/server/settings/system-settings";

import { BackupCard } from "./backup-card";

// Zamanlanmış iş izleme (§12.4). Zamanlayıcı durursa sistem çalışıyor görünür
// ama hatırlatmalar ve bildirimler sessizce ölür; bu ekran o arızayı görünür
// kılar.

export const metadata = { title: "Zamanlanmış işler" };
export const dynamic = "force-dynamic";

const IS_SEKMELERI = [
  { href: "/admin/jobs", label: "İş durumu", key: "durum" },
  { href: "/admin/jobs?sekme=yedekler", label: "Yedekler", key: "yedekler" },
  { href: "/admin/jobs?sekme=bildirimler", label: "Bildirim kuyruğu", key: "bildirimler" },
] as const;

function sureMetni(lagSeconds: number | null): string {
  if (lagSeconds === null) return "hiç çalışmadı";
  if (lagSeconds < 60) return `${lagSeconds} saniye önce`;

  const dakika = Math.floor(lagSeconds / 60);
  if (dakika < 60) return `${dakika} dakika önce`;

  const saat = Math.floor(dakika / 60);
  if (saat < 24) return `${saat} saat önce`;

  return `${Math.floor(saat / 24)} gün önce`;
}

export default async function JobsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ sekme?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!canManageOrganization(user)) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Zamanlanmış işleri yalnızca sistem yöneticisi görebilir."
      />
    );
  }

  const params = await searchParams;
  const sekme = IS_SEKMELERI.some((item) => item.key === params.sekme)
    ? (params.sekme as (typeof IS_SEKMELERI)[number]["key"])
    : "durum";
  const aktifSekme = IS_SEKMELERI.find((item) => item.key === sekme) ?? IS_SEKMELERI[0];

  const now = new Date();
  const [jobs, bekleyen, basarisiz, smtp, yedekIzleniyor, backupRequests] = await Promise.all([
    listJobHealth(prisma, now),
    prisma.notificationQueue.count({ where: { status: "PENDING" } }),
    prisma.notificationQueue.count({ where: { status: "FAILED" } }),
    readSmtpView(prisma),
    readBooleanSetting(prisma, SETTING_KEYS.backupMonitoringEnabled),
    listBackupRequests(prisma, 50),
  ]);

  const gecikenVar = jobs.some(
    (job) =>
      job.delayed &&
      (job.jobName !== JOB_NAMES.backup || yedekIzleniyor),
  );

  return (
    <AppShell
      user={await toShellUser(user)}
    >
      <Page>
        <PageHeader
          title="Zamanlanmış işler"
          description="Arka plan işleyicisi durursa sistem çalışıyor görünür ama hatırlatmalar ve bildirimler gitmez. Bu ekran o durumu görünür kılar."
          breadcrumbs={[{ label: "Yönetim" }, { label: "Zamanlanmış işler" }]}
          action={
            <div className="flex gap-2">
              <ButtonLink href="/admin/settings" size="sm">
                Sistem ayarları
              </ButtonLink>
              <ButtonLink href="/api/health" size="sm">
                Sağlık raporu
              </ButtonLink>
            </div>
          }
        />

        <AdminNav isRoot={user.isRoot} />

        <AdminTabs
          tabs={IS_SEKMELERI.map(({ href, label }) => ({ href, label }))}
          activeHref={aktifSekme.href}
        />

        {gecikenVar ? (
          <div data-test="gecikme-uyarisi">
            <Alert tone="danger" title="En az bir iş gecikti">
              Beklenen aralığın iki katından uzun süredir çalışmayan bir iş var.
              İşleyici sürecinin ayakta olduğunu kontrol edin.
            </Alert>
          </div>
        ) : null}

        {smtp.source === "none" ? (
          <Alert
            tone="correction"
            title="E-posta gönderimi yapılandırılmamış"
            action={<ButtonLink href="/admin/settings/delivery" size="sm">Ayarları aç</ButtonLink>}
          >
            Bildirim e-postaları gönderilmiyor. SMTP bilgilerini kaydedin veya
            yalnız tarayıcı bildirimlerini kullanın.
          </Alert>
        ) : null}

        {sekme === "durum" ? (
          <Card>
            <CardHeader
              title="İşler"
              description="Her iş kendi nabzını yazar; gecikme, nabzın beklenen aralığın iki katını aşmasıdır."
            />
            <Table label="Zamanlanmış işler tablosu">
              <THead>
                <TR>
                  <TH>İş</TH>
                  <TH>Son başarılı çalışma</TH>
                  <TH align="right">Beklenen aralık</TH>
                  <TH>Durum</TH>
                </TR>
              </THead>
              <TBody>
                {jobs.map((job) => (
                  <TR key={job.jobName} data-test={`is-${job.jobName}`}>
                    <TD className="font-medium">{jobLabel(job.jobName)}</TD>
                    <TD className="text-muted">{sureMetni(job.lagSeconds)}</TD>
                    <TD align="right" className="tabular">
                      {formatJobInterval(job.expectedIntervalMinutes)}
                    </TD>
                    <TD>
                      {job.jobName === JOB_NAMES.backup && !yedekIzleniyor ? (
                        <Badge tone="waiting">izleme kapalı</Badge>
                      ) : (
                        <Badge tone={job.delayed ? "danger" : "success"}>
                          {job.delayed ? "gecikti" : "çalışıyor"}
                        </Badge>
                      )}
                      {job.lastError ? (
                        <p className="mt-1 text-[length:var(--text-xs)] text-danger">
                          {job.lastError}
                        </p>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        ) : null}

        {sekme === "yedekler" ? (
          <BackupCard
            active={
              backupRequests.find(
                (request) => request.status === "PENDING" || request.status === "RUNNING",
              ) ?? null
            }
            history={backupRequests.slice(0, 10)}
          />
        ) : null}

        {sekme === "bildirimler" ? (
          <Card>
            <CardHeader title="Bildirim kuyruğu" />
            <CardBody className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-6 sm:max-w-md">
                <Stat label="Bekleyen" value={bekleyen} />
                <Stat
                  label="Başarısız"
                  value={basarisiz}
                  tone={basarisiz > 0 ? "correction" : "neutral"}
                />
              </div>
              {basarisiz > 0 ? (
                <Alert tone="correction">
                  Başarısız kayıtlar beş denemeden sonra vazgeçilenlerdir. SMTP
                  ayarlarını kontrol edip sınama e-postası gönderin.
                </Alert>
              ) : null}
            </CardBody>
          </Card>
        ) : null}
      </Page>
    </AppShell>
  );
}
