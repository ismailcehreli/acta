import { notFound, redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { companyDay } from "@/server/activities/date-rules";
import { checkActivityEditPermission, editPermissionMessage } from "@/server/activities/edit-permission";
import { findOwnActivity } from "@/server/activities/read";
import { listTargetDepartments } from "@/server/activities/target-options";
import { getCurrentUser } from "@/server/auth/current-user";
import { readAttachmentLimits } from "@/server/attachments/service";
import { prisma } from "@/server/db";

import { ActivityForm } from "../../activity-form";
import { readActivityTextLimits } from "@/server/settings/system-settings";

export const metadata = { title: "Faaliyeti düzelt" };

export default async function EditActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  // Yalnızca kişinin kendi faaliyeti getirilir; başkasınınki hiç aranmaz.
  const activity = await findOwnActivity(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    id,
  );

  if (!activity) notFound();

  const permission = await checkActivityEditPermission(
    prisma,
    user.id,
    activity,
    new Date(),
  );

  // Bayat bir bağlantıyı 404'e çevirmek yerine, kullanıcının kendi kaydı için
  // neden düzenleyemediğini ve faaliyete nasıl döneceğini açıkça gösteririz.
  // Sunucu eylemi aynı kararı tekrarlar; sayfa tek başına güvenlik kapısı
  // değildir.
  if (!permission.allowed) {
    const message =
      activity.approvalStatus === "CANCELLED"
        ? "İptal edilmiş faaliyet düzenlenemez."
        : activity.approvalStatus === "REJECTED"
          ? "Reddedilen faaliyet düzenlenemez. Gerekiyorsa yeni bir faaliyet yazın."
          : editPermissionMessage(permission.reason);

    return (
      <AppShell user={await toShellUser(user)}>
        <Page>
          <PageHeader
            title="Faaliyet düzenlenemiyor"
            description="Bu kaydın içeriği korunur."
            breadcrumbs={[
              { label: "Ana ekran", href: "/" },
              { label: "Faaliyetlerim", href: "/activities" },
              { label: activity.title, href: `/activities/${activity.id}` },
              { label: "Düzelt" },
            ]}
          />
          <Card>
            <CardBody className="flex flex-col items-start gap-4">
              <Alert tone="danger">{message}</Alert>
              <ButtonLink href={`/activities/${activity.id}`}>
                Faaliyete dön
              </ButtonLink>
            </CardBody>
          </Card>
        </Page>
      </AppShell>
    );
  }

  const [options, limits, attachmentLimits] = await Promise.all([
    listTargetDepartments(prisma, user.orgUnitId),
    readActivityTextLimits(prisma),
    readAttachmentLimits(prisma),
  ]);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          title="Faaliyeti düzelt"
          description={
            activity.approvalStatus === "CHANGES_REQUESTED"
              ? "Yöneticinizin talep ettiği düzeltmeleri yapıp tekrar onaya gönderin."
              : "Düzeltme kısa bir süre için mümkündür ve her kaydetme bir revizyon kaydı bırakır."
          }
          breadcrumbs={[
            { label: "Ana ekran", href: "/" },
            { label: "Faaliyetlerim", href: "/activities" },
            { label: activity.title, href: `/activities/${activity.id}` },
            { label: "Düzelt" },
          ]}
        />

        <Card>
          <CardBody>
            <ActivityForm
              limits={limits}
              attachmentLimits={attachmentLimits}
              mode="edit"
              draftKey={`faaliyet-yarim:${activity.id}:${user.id}`}
              options={options}
              values={{
                id: activity.id,
                activityDate: companyDay(activity.activityDate),
                title: activity.title,
                description: activity.description,
                targetDepartmentIds: activity.targetDepts.map((t) => t.orgUnitId),
                attachments: activity.attachments,
              }}
            />
          </CardBody>
        </Card>
      </Page>
    </AppShell>
  );
}
