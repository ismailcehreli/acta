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
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { prisma } from "@/server/db";

import { CancelForm } from "./cancel-form";

export async function generateMetadata() {
  return getLocalizedMetadata("activities.cancelActivity");
}

export default async function CancelActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();

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


  if (
    !activity ||
    !(await canCancelActivity(prisma, activity, {
      id: user.id,
      isSystemAdmin: user.isSystemAdmin,
    }))
  ) {
    notFound();
  }



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
            title={t("activities.alreadyCancelled")}
            breadcrumbs={[
              { label: "Dashboard", href: "/" },
              { label: "My activities", href: "/activities" },
              { label: t("common.cancel") },
            ]}
          />
          <Alert tone="info">
            {t("activities.alreadyCancelledDescription")}
          </Alert>
          <div>
            <ButtonLink href={`/activities/${activity.id}`}>
              {t("common.back")}
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
          title={t("activities.cancelActivity")}
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "My activities", href: "/activities" },
            { label: activity.title, href: `/activities/${activity.id}` },
            { label: t("common.cancel") },
          ]}
        />

        <Alert tone="correction" title={t("activities.cancellationIrreversible")}>
          {t("activities.cancellationDescription")}
        </Alert>

        <Card>
          <CardHeader title={t("activities.recordToCancel")} />
          <CardBody>
            <p className="font-medium text-ink">{activity.title}</p>
            <p className="mt-1.5 whitespace-pre-line text-[length:var(--text-sm)] text-muted">
              {activity.description}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("activities.cancelReason")} />
          <CardBody>
            <CancelForm activityId={activity.id} />
          </CardBody>
        </Card>
      </Page>
    </AppShell>
  );
}
