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
import { listAbsenceDeputies, listOwnAbsences } from "@/server/absence/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { subordinateUserIds } from "@/server/authz/visibility";
import { prisma } from "@/server/db";
import { SETTING_KEYS, readNumericSetting } from "@/server/settings/system-settings";
import { formatDay, formatInstantShort, toDateValue } from "@/shared/format/date-time";

import { CancelOwnAbsenceButton, MarkOwnAbsenceForm } from "./absence-forms";

// Kişinin kendi "faaliyet beklenmiyor" günleri.
// Çalışanın talebi yöneticisi onaylayana kadar geçerli değildir; yöneticinin
// kendi kaydı ise doğrudan onaylı oluşturulur.

export const metadata = { title: "İzinlerim" };

export default async function OwnAbsencePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [donemler, enUzun, subordinates, deputyPeople] = await Promise.all([
    listOwnAbsences(prisma, user.id),
    readNumericSetting(prisma, SETTING_KEYS.selfAbsenceMaxDays),
    subordinateUserIds(prisma, user.id),
    listAbsenceDeputies(prisma, user.id),
  ]);

  return (
    <AppShell user={await toShellUser(user, subordinates)}>
      <Page>
        <PageHeader
          title="İzinlerim"
          description="İzinli, raporlu veya başka bir nedenle faaliyet giremeyeceğiniz günleri buraya yazın. Çalışanların talepleri yöneticisi onayladıktan sonra geçerli olur; yöneticiler kendi kayıtlarını doğrudan geçerli olarak oluşturur."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "İzinlerim" }]}
        />

        <Card>
          <CardHeader
            title="İzin günü ekle"
            description="Çalışansanız talebiniz yöneticinize gider. Onaylanana kadar bu günler hatırlatma ve katılım hesabından düşülmez."
          />
          <CardBody>
            <MarkOwnAbsenceForm
              maxDays={enUzun}
              deputyPeople={user.isUnitManager ? deputyPeople : []}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Girdiğim izinler"
            description="Yöneticinizin sizin için girdiği kayıtlar da burada görünür. Yanlış girdiğiniz bir kaydı gerekçe yazarak iptal edebilirsiniz; kayıt silinmez, üstü çizili kalır."
          />

          {donemler.length === 0 ? (
            <EmptyState
              title="İzin kaydı yok"
              description="İzinli ya da raporlu olacağınız günleri önceden girerseniz o günlerde faaliyet hatırlatması almazsınız."
            />
          ) : (
            <RecordList>
              {donemler.map((donem) => {
                const iptal = donem.cancelledReason !== null;

                return (
                  <RecordItem key={donem.id} data-test="kendi-donem-satiri">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p
                          className={
                            iptal
                              ? "font-medium text-faint line-through"
                              : "font-medium text-ink"
                          }
                        >
                          {formatDay(toDateValue(donem.startDate))} –{" "}
                          {formatDay(toDateValue(donem.endDate))}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {iptal ? (
                            <Badge tone="cancelled">İptal edildi</Badge>
                          ) : (
                            <AbsenceStatusBadge status={donem.status} />
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                          <RecordField label="Kaydı giren">
                            {donem.markedBySelf ? "Kendim" : "Yöneticim"}
                          </RecordField>
                          {donem.note ? (
                            <RecordField label="Not">{donem.note}</RecordField>
                          ) : null}
                          {donem.deputyName ? (
                            <RecordField label="Vekil">{donem.deputyName}</RecordField>
                          ) : null}
                          {donem.decidedByName ? (
                            <RecordField
                              label={donem.status === "REJECTED" ? "Reddeden" : "Onaylayan"}
                            >
                              {donem.decidedByName}
                              {donem.decisionRoute
                                ? ` · ${absenceDecisionRouteLabel(donem.decisionRoute)}`
                                : ""}
                            </RecordField>
                          ) : null}
                          {donem.decidedAt ? (
                            <RecordField label="Karar zamanı">
                              {formatInstantShort(donem.decidedAt)}
                            </RecordField>
                          ) : null}
                        </div>
                        {iptal ? (
                          <p className="mt-2 text-[length:var(--text-sm)] text-muted">
                            <span className="font-medium text-ink">
                              İptal gerekçesi:
                            </span>{" "}
                            {donem.cancelledReason}
                          </p>
                        ) : null}
                        {!iptal && donem.decisionReason ? (
                          <p className="mt-2 text-[length:var(--text-sm)] text-muted">
                            <span className="font-medium text-ink">
                              Yönetici açıklaması:
                            </span>{" "}
                            {donem.decisionReason}
                          </p>
                        ) : null}
                      </div>

                      {iptal || donem.status === "REJECTED" ? null : (
                        <CancelOwnAbsenceButton id={donem.id} />
                      )}
                    </div>
                  </RecordItem>
                );
              })}
            </RecordList>
          )}
        </Card>
      </Page>
    </AppShell>
  );
}
