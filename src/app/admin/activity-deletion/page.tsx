import { redirect } from "next/navigation";

import { AdminNav } from "@/components/shell/admin-nav";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { PermissionWarning } from "@/components/shell/permission-warning";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { describeActivityForDeletion } from "@/server/activities/delete";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getLocale } from "@/server/i18n/locale";
import { getTranslations } from "@/server/i18n/server";
import { formatDay } from "@/shared/format/date-time";
import type { TranslateFunction } from "@/shared/i18n";
import { localizeServiceMessage } from "@/shared/i18n/message";

import { ActivitySearch, DeletionSteps } from "./deletion-form";
export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("screens.activityDeletion.pageTitle") };
}

const statusKeys = {
  APPROVED: "activityStatus.APPROVED",
  PENDING_APPROVAL: "activityStatus.PENDING_APPROVAL",
  CHANGES_REQUESTED: "activityStatus.CHANGES_REQUESTED",
  REJECTED: "activityStatus.REJECTED",
  CANCELLED: "activityStatus.CANCELLED",
  MANAGER_NOT_FOUND: "activityStatus.MANAGER_NOT_FOUND",
  DRAFT: "activityStatus.DRAFT",
} as const;

function getStatusLabel(status: string, t: TranslateFunction): string {
  const key = statusKeys[status as keyof typeof statusKeys];
  return key ? t(key) : status;
}

export default async function ActivityDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string }>;
}) {
  const user = await getCurrentUser();
  const locale = await getLocale();
  const t = await getTranslations(locale);
  if (!user) redirect("/login");

  if (!user.isRoot) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.activityDeletion.permission")}
      />
    );
  }

  const { record } = await searchParams;
  const result = record
    ? await describeActivityForDeletion(
        prisma,
        { id: user.id, isRoot: user.isRoot },
        record,
      )
    : null;

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          breadcrumbs={[
            { label: t("screens.activityDeletion.dashboard"), href: "/" },
            { label: t("screens.activityDeletion.pageTitle") },
          ]}
          title={t("screens.activityDeletion.pageTitle")}
          description={t("screens.activityDeletion.description")}
        />

        <AdminNav isRoot={user.isRoot} />

        <Card>
          <CardBody className="flex flex-col gap-4">
            <ActivitySearch />
          </CardBody>
        </Card>

        {result && !result.ok ? (
          <Alert tone="danger">
            {localizeServiceMessage(t, "deletion", result)}
          </Alert>
        ) : null}

        {result?.ok ? (
          <Card>
            <CardBody className="flex flex-col gap-4">
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Row label={t("screens.activityDeletion.title")} value={result.value.title} />
                <Row label={t("screens.activityDeletion.author")} value={result.value.authorName} />
                <Row label={t("screens.activityDeletion.unit")} value={result.value.authorUnitName} />
                <Row
                  label={t("screens.activityDeletion.date")}
                  value={formatDay(result.value.activityDate, locale)}
                />
                <Row
                  label={t("screens.activityDeletion.status")}
                  value={getStatusLabel(result.value.approvalStatus, t)}
                />
                <Row
                  label={t("screens.activityDeletion.attachments")}
                  value={t("screens.activityDeletion.attachmentCount", {
                    count: result.value.attachmentCount,
                  })}
                />
              </dl>

              {result.value.periodClosed ? (
                <Alert tone="danger">
                  {t("screens.activityDeletion.periodClosed", {
                    date: result.value.periodClosedAt
                      ? " on " + formatDay(result.value.periodClosedAt, locale)
                      : "",
                  })}
                </Alert>
              ) : (
                <Alert tone="waiting">
                  {t("screens.activityDeletion.periodOpen")}
                </Alert>
              )}

              <DeletionSteps
                activityId={result.value.id}
                deletionOpen={!result.value.periodClosed}
              />
            </CardBody>
          </Card>
        ) : null}
      </Page>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}
