import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { listHolidays, readWorkCalendar } from "@/server/calendar/settings";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader } from "@/components/ui/page";
import { AdminTabs } from "@/components/ui/admin-tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDay, toDateValue } from "@/shared/format/date-time";
import { loadOrgTree, type OrgUnitNode } from "@/server/org/tree";
import {
  loadUnitCalendarIndex,
  resolveUnitWorkWindowFrom,
} from "@/server/calendar/unit-calendar";
import { minuteToTime } from "@/shared/schemas/calendar";

import {
  UnitCalendarForm,
  type UnitCalendarRow,
} from "./unit-calendar-form";

import {
  AddHolidayForm,
  RemoveHolidayButton,
  WorkCalendarForm,
} from "./calendar-forms";

// Çalışma takvimi yönetimi (§12.1). Takvim ve tatiller iş günü hesabının tek
// kaynağıdır: "10 iş günü" (§9.3) ve mesai sonu hatırlatması buradan beslenir.

export const metadata = { title: "Çalışma takvimi" };

function gunMetni(date: string): string {
  return formatDay(toDateValue(date));
}

const TAKVIM_SEKMELERI = [
  { href: "/admin/calendar", label: "Genel takvim", key: "genel" },
  { href: "/admin/calendar?sekme=birimler", label: "Birim takvimleri", key: "birimler" },
  { href: "/admin/calendar?sekme=tatiller", label: "Resmî tatiller", key: "tatiller" },
] as const;

export default async function CalendarAdminPage({
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
        mesaj="Çalışma takvimini yalnızca sistem yöneticisi düzenleyebilir."
      />
    );
  }

  const yil = new Date().getUTCFullYear();
  const params = await searchParams;
  const sekme = TAKVIM_SEKMELERI.some((item) => item.key === params.sekme)
    ? (params.sekme as (typeof TAKVIM_SEKMELERI)[number]["key"])
    : "genel";
  const aktifSekme = TAKVIM_SEKMELERI.find((item) => item.key === sekme) ?? TAKVIM_SEKMELERI[0];
  const [calendar, holidays, birimAgaci] = await Promise.all([
    readWorkCalendar(prisma),
    listHolidays(prisma),
    loadOrgTree(prisma),
  ]);

  // Her birim için geçerli pencere çözülüyor: ekranda "kendi tanımı" ile
  // "devralındı" ayrımı görünmeli (Görev 11.9).
  const duzBirimler: { id: string; label: string; depth: number }[] = [];
  const yaz = (nodes: OrgUnitNode[], depth = 0) => {
    for (const node of nodes) {
      if (node.isActive) {
        duzBirimler.push({ id: node.id, label: `${"— ".repeat(depth)}${node.name}`, depth });
      }
      yaz(node.children, depth + 1);
    }
  };
  yaz(birimAgaci);

  // Ağaç ve takvimler **bir kez** yükleniyor (denetim 23.08.2026,
  // bulgu 9). Satır başına çözüm, her satırda bütün birimleri ve bütün birim
  // takvimlerini yeniden okuyordu.
  const takvimIndeksi = await loadUnitCalendarIndex(prisma);

  const birimSatirlari: UnitCalendarRow[] = duzBirimler.map((birim) => {
      const pencere = resolveUnitWorkWindowFrom(takvimIndeksi, birim.id);
      return {
        id: birim.id,
        label: birim.label,
        workingDays: pencere.workingDays,
        workStart: minuteToTime(pencere.workStartMinute),
        workEnd: minuteToTime(pencere.workEndMinute),
        worksOnHolidays: pencere.worksOnHolidays,
        source: pencere.source,
        sourceUnitName: pencere.sourceUnitName,
      };
  });

  return (
    <AppShell
      user={await toShellUser(user)}
    >
      <Page isaret="calisma-takvimi">
        <PageHeader
          title="Çalışma takvimi"
          description="Şirketin çalışma günleri, mesai saatleri ve resmî tatilleri. Sistemdeki bütün “kaç iş günü” hesapları bu takvime bakar: hatırlatmalar, onay süreleri ve takip maddelerinin gecikme sayacı hafta sonlarını ve tatilleri saymaz."
          breadcrumbs={[{ label: "Yönetim" }, { label: "Çalışma takvimi" }]}
        />

        <AdminNav isRoot={user.isRoot} />

        <AdminTabs
          tabs={TAKVIM_SEKMELERI.map(({ href, label }) => ({ href, label }))}
          activeHref={aktifSekme.href}
        />

        {sekme === "genel" ? (
          <Card>
            <CardHeader
              title="Şirket varsayılanı"
              description="Kendi tanımı olmayan birimler bu pencereyi devralır. İş günü sayacı — “3 iş günüdür bekliyor” gibi hesaplar — her zaman bu takvimi kullanır ve birim tanımlarından etkilenmez: sayaç iki kişi arasındaki ortak ölçüdür."
            />
            <CardBody>
              <WorkCalendarForm calendar={calendar} />
            </CardBody>
          </Card>
        ) : null}

        {sekme === "birimler" ? (
          <Card>
            <CardHeader
              title="Birime özel mesai penceresi"
              description="Bir depo 07:00–17:00, diğeri 08:00–18:00 çalışabilir; üretim resmî tatilde açıkken satış kapalı olabilir. Tanımlamayan birim üstünden devralır. Bu pencere yalnız mesai sonu hatırlatmasını etkiler."
            />
            <CardBody>
              <UnitCalendarForm units={birimSatirlari} />
            </CardBody>
          </Card>
        ) : null}

        {sekme === "tatiller" ? (
          <Card>
            <CardHeader
              title="Resmî tatiller"
              description="Bu günlerde hatırlatma gitmez ve iş günü sayacı işlemez."
            />
            <CardBody>
              <AddHolidayForm />
            </CardBody>

            {holidays.length === 0 ? (
              <EmptyState
                title="Tatil tanımlanmadı"
                description={`${yil} yılının resmî tatillerini yukarıdaki formla girin.`}
              />
            ) : (
              <Table label="Çalışma takvimi tablosu">
                <THead>
                  <TR>
                    <TH>Tarih</TH>
                    <TH>Açıklama</TH>
                    <TH align="right">İşlem</TH>
                  </TR>
                </THead>
                <TBody>
                  {holidays.map((holiday) => (
                    <TR key={holiday.date}>
                      <TD className="whitespace-nowrap font-medium tabular">
                        {gunMetni(holiday.date)}
                      </TD>
                      <TD>{holiday.description}</TD>
                      <TD align="right">
                        <RemoveHolidayButton date={holiday.date} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        ) : null}
      </Page>
    </AppShell>
  );
}
