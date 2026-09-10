import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Card, CardBody } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { companyDay } from "@/server/activities/date-rules";
import { countDrafts, findDraft } from "@/server/activities/drafts";
import { listTargetDepartments } from "@/server/activities/target-options";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";

import { readAttachmentLimits } from "@/server/attachments/service";

import { ActivityForm } from "../activity-form";
import { readActivityTextLimits } from "@/server/settings/system-settings";

export const metadata = { title: "Yeni faaliyet" };

export default async function NewActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ taslak?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;

  const [options, taslak, taslakSayisi, limits, ekSinirlari] = await Promise.all([
    listTargetDepartments(prisma, user.orgUnitId),
    // Taslaktan devam ediliyorsa içeriği yüklenir. Bulunamazsa (başkasının
    // taslağı ya da silinmiş) form boş açılır — hata vermek yerine
    // kullanıcıyı yazmaya bırakmak doğru davranış.
    params.taslak ? findDraft(prisma, user.id, params.taslak) : Promise.resolve(null),
    countDrafts(prisma, user.id),
    readActivityTextLimits(prisma),
    readAttachmentLimits(prisma),
  ]);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          title={taslak ? "Taslağa devam et" : "Yeni faaliyet"}
          description="Gün içindeki çalışmalarınız, yaptığınız tespitler, karşılaşılan sorunlar ve nasıl çözüldüğü. Üst yönetimin karar vermesi gereken bir konu varsa onu da buraya yazın. Kaydettikten sonra kısa bir süre düzeltebilirsiniz; kaydı bir başkası okuduktan sonra değiştirilemez."
          breadcrumbs={[
            { label: "Ana ekran", href: "/" },
            { label: "Faaliyetlerim", href: "/activities" },
            { label: "Yeni" },
          ]}
        />

        <Card>
          <CardBody>
            <ActivityForm
              limits={limits}
              attachmentLimits={ekSinirlari}
              mode="create"
              // Anahtar kullanıcıya özel: ortak bir tarayıcıda birinin yarım
              // metni diğerine teklif edilmemeli.
              draftKey={`faaliyet-yarim:yeni:${user.id}`}
              options={options}
              draftCount={taslakSayisi}
              values={{
                draftId: taslak?.id,
                activityDate: taslak
                  ? taslak.activityDate.toISOString().slice(0, 10)
                  : companyDay(new Date()),
                title: taslak?.title ?? "",
                description: taslak?.description ?? "",
                attachments: taslak?.attachments,
                // Departman çalışanına kendi birimi önseçili gelir (§5.3); onaya
                // tabi olmayan kademelerde önseçim yapılmaz, çünkü etiketlenen
                // departman çoğunlukla başkasıdır.
                // §5.4: departman çalışanına kendi birimi **önceden seçili**
                // gelir; müdür ve koordinatör kendisi seçer. Koordinatörün
                // altındaki bütün birimleri işaretlemek yanlış olurdu — IT ile
                // ilgili bir kayda Lojistik de iliştirilmiş olurdu.
                //
                // Eskiden bu, onaya tabi olma bayrağına bağlıydı; ikisinin
                // birbiriyle ilgisi yok.
                targetDepartmentIds: taslak
                  ? taslak.targetOrgUnitIds
                  : user.isUnitManager
                    ? []
                    : [user.orgUnitId],
              }}
            />
          </CardBody>
        </Card>
      </Page>
    </AppShell>
  );
}
