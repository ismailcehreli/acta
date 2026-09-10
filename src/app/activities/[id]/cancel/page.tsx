import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { canCancelActivity } from "@/server/activities/cancel";
import { activityMaintenanceReader } from "@/server/authz/activity-repository";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";

import { CancelForm } from "./cancel-form";

export const metadata = { title: "Faaliyeti iptal et" };

export default async function CancelActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const activity = await activityMaintenanceReader(prisma).findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      approvalStatus: true,
      authorId: true,
    },
  });

  // Yetkisi olmayan kişi faaliyetin varlığını da öğrenmez.
  if (
    !activity ||
    !(await canCancelActivity(prisma, activity, {
      id: user.id,
      isSystemAdmin: user.isSystemAdmin,
    }))
  ) {
    notFound();
  }

  // İptal yalnızca onaylanmış faaliyet için tanımlıdır (§5.4); diğer durumlar
  // için ekran hiç açılmaz.
  if (
    activity.approvalStatus !== "APPROVED" &&
    activity.approvalStatus !== "CANCELLED"
  ) {
    notFound();
  }

  const shellUser = await toShellUser(user);

  if (activity.approvalStatus === "CANCELLED") {
    return (
      <AppShell user={shellUser}>
        <Page>
          <PageHeader
            title="Faaliyet zaten iptal edilmiş"
            breadcrumbs={[
              { label: "Ana ekran", href: "/" },
              { label: "Faaliyetlerim", href: "/activities" },
              { label: "İptal" },
            ]}
          />
          <Alert tone="info">
            Bu kayıt daha önce iptal edilmiş. İptal geri alınamaz.
          </Alert>
          <div>
            <ButtonLink href={`/activities/${activity.id}`}>
              Faaliyete dön
            </ButtonLink>
          </div>
        </Page>
      </AppShell>
    );
  }

  return (
    <AppShell user={shellUser}>
      <Page>
        <PageHeader
          title="Faaliyeti iptal et"
          breadcrumbs={[
            { label: "Ana ekran", href: "/" },
            { label: "Faaliyetlerim", href: "/activities" },
            { label: activity.title, href: `/activities/${activity.id}` },
            { label: "İptal" },
          ]}
        />

        <Alert tone="correction" title="İptal geri alınamaz.">
          Kayıt silinmez; üstü çizili olarak kalır ve gerekçesiyle birlikte
          görünür. Faaliyetin cevap bekleyen soruları varsa kapatılır ve
          taraflara bildirilir.
        </Alert>

        <Card>
          <CardHeader title="İptal edilecek kayıt" />
          <CardBody>
            <p className="font-medium text-ink">{activity.title}</p>
            <p className="mt-1.5 whitespace-pre-line text-[length:var(--text-sm)] text-muted">
              {activity.description}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Gerekçe" />
          <CardBody>
            <CancelForm activityId={activity.id} />
          </CardBody>
        </Card>
      </Page>
    </AppShell>
  );
}
