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
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

export async function generateMetadata() {
  return getLocalizedMetadata("activities.newActivity");
}

export default async function NewActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const t = await getTranslations();

  const params = await searchParams;

  const [options, draft, draftCount, limits, attachmentLimits] = await Promise.all([
    listTargetDepartments(prisma, user.orgUnitId),



    params.draft ? findDraft(prisma, user.id, params.draft) : Promise.resolve(null),
    countDrafts(prisma, user.id),
    readActivityTextLimits(prisma),
    readAttachmentLimits(prisma),
  ]);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          title={draft ? t("activities.continueDraft") : t("activities.newActivity")}
          description={t("activities.newActivityDescription")}
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "My activities", href: "/activities" },
            { label: t("nav.new") },
          ]}
        />

        <Card>
          <CardBody>
            <ActivityForm
              limits={limits}
              attachmentLimits={attachmentLimits}
              mode="create"


              draftKey={`activity-local-draft:new:${user.id}`}
              options={options}
              draftCount={draftCount}
              values={{
                draftId: draft?.id,
                activityDate: draft
                  ? draft.activityDate.toISOString().slice(0, 10)
                  : companyDay(new Date()),
                title: draft?.title ?? "",
                description: draft?.description ?? "",
                attachments: draft?.attachments,
                // Regular employees start with their own unit selected. Managers
                // choose related units explicitly because their records may span
                // several parts of the organization.
                targetDepartmentIds: draft
                  ? draft.targetOrgUnitIds
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
