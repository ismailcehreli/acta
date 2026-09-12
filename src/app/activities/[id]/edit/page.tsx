import { notFound, redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { companyDay } from "@/server/activities/date-rules";
import { checkActivityEditPermission } from "@/server/activities/edit-permission";
import { findOwnActivity } from "@/server/activities/read";
import { listTargetDepartments } from "@/server/activities/target-options";
import { getCurrentUser } from "@/server/auth/current-user";
import { readAttachmentLimits } from "@/server/attachments/service";
import { prisma } from "@/server/db";

import { ActivityForm } from "../../activity-form";
import { readActivityTextLimits } from "@/server/settings/system-settings";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

export async function generateMetadata() {
  return getLocalizedMetadata("activities.editActivity");
}

export default async function EditActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const t = await getTranslations();

  const { id } = await params;

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

  if (!permission.allowed) {
    const message =
      activity.approvalStatus === "CANCELLED"
        ? t("activities.cancelledCannotBeRevised")
        : activity.approvalStatus === "REJECTED"
          ? t("activities.rejectedCannotBeRevised")
          : permission.reason === "already_read"
            ? t("errors.activity.alreadyRead")
            : permission.reason === "window_closed"
              ? t("errors.activity.windowClosed")
              : t("errors.activity.notEditable");

    return (
      <AppShell user={await toShellUser(user)}>
        <Page>
          <PageHeader
            title={t("activities.cannotRevise")}
            description={t("activities.recordPreserved")}
            breadcrumbs={[
              { label: "Dashboard", href: "/" },
              { label: "My activities", href: "/activities" },
              { label: activity.title, href: `/activities/${activity.id}` },
              { label: t("activities.revise") },
            ]}
          />
          <Card>
            <CardBody className="flex flex-col items-start gap-4">
              <Alert tone="danger">{message}</Alert>
              <ButtonLink href={`/activities/${activity.id}`}>
                {t("common.back")}
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
          title={t("activities.editActivity")}
          description={
            activity.approvalStatus === "CHANGES_REQUESTED"
              ? t("activities.changesRequestedDescription")
              : t("activities.revisionDescription")
          }
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "My activities", href: "/activities" },
            { label: activity.title, href: `/activities/${activity.id}` },
            { label: t("activities.revise") },
          ]}
        />

        <Card>
          <CardBody>
            <ActivityForm
              limits={limits}
              attachmentLimits={attachmentLimits}
              mode="edit"
              draftKey={`activity-local-draft:${activity.id}:${user.id}`}
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
