import { redirect } from "next/navigation";

import {
  AUDIT_ACTIONS,
  AUDIT_OBJECTS,
  listAuditEntries,
} from "@/server/audit/log";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { PermissionWarning } from "@/components/shell/permission-warning";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordItem, RecordList } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { FilterBar } from "@/components/filters/filter-bar";
import { resolvePageSize } from "@/server/preferences/page-size";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { formatInstantPrecise } from "@/shared/format/date-time";
import { getLocale } from "@/server/i18n/locale";
import { getTranslations } from "@/server/i18n/server";
import type { TranslateFunction } from "@/shared/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("screens.audit.pageTitle") };
}

const OBJECT_LABEL_KEYS: Record<string, string> = {
  activity: "screens.audit.objectActivity",
  conversation: "screens.audit.objectConversation",
  user: "screens.audit.objectUser",
  org_unit: "screens.audit.objectUnit",
  setting: "screens.audit.objectSetting",
  approval_reason: "screens.audit.objectApprovalReason",
  follow_up: "screens.audit.objectFollowUp",
  session: "screens.audit.objectSession",
  backup_request: "screens.audit.objectBackupRequest",
  system_reset: "screens.audit.objectSystemReset",
  help_article: "screens.audit.objectHelpArticle",
  feedback: "screens.audit.objectFeedback",
};

const ACTION_LABEL_KEYS: Record<string, string> = {
  activity_created: "screens.audit.actionActivityCreated",
  activity_revised: "screens.audit.actionActivityRevised",
  activity_cancelled: "screens.audit.actionActivityCancelled",
  conversation_opened: "screens.audit.actionConversationOpened",
  conversation_replied: "screens.audit.actionConversationReplied",
  conversation_closed: "screens.audit.actionConversationClosed",
  user_created: "screens.audit.actionUserCreated",
  user_updated: "screens.audit.actionUserUpdated",
  user_deactivated: "screens.audit.actionUserDeactivated",
  user_reactivated: "screens.audit.actionUserReactivated",
  user_password_set: "screens.audit.actionPasswordSet",
  user_password_changed: "screens.audit.actionPasswordChanged",
  user_password_reset: "screens.audit.actionPasswordReset",
  org_unit_created: "screens.audit.actionUnitCreated",
  org_unit_updated: "screens.audit.actionUnitUpdated",
  org_unit_moved: "screens.audit.actionUnitMoved",
  org_unit_deactivated: "screens.audit.actionUnitDeactivated",
  org_unit_reactivated: "screens.audit.actionUnitReactivated",
  settings_changed: "screens.audit.actionSettingsChanged",
  work_calendar_changed: "screens.audit.actionCalendarChanged",
  holiday_added: "screens.audit.actionHolidayAdded",
  holiday_removed: "screens.audit.actionHolidayRemoved",
  smtp_changed: "screens.audit.actionSmtpChanged",
  login_succeeded: "screens.audit.actionLoginSucceeded",
  login_failed: "screens.audit.actionLoginFailed",
  login_locked: "screens.audit.actionLoginLocked",
};

export default async function AuditAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    objectType?: string;
    action?: string;
    page?: string;

    pageSize?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const locale = await getLocale();
  const t = await getTranslations(locale);

  if (!canManageOrganization(user)) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.audit.permission")}
      />
    );
  }

  const params = await searchParams;
  const pageSize = await resolvePageSize(params.pageSize);
  const page = Number(params.page ?? 1);

  const result = await listAuditEntries(
    prisma,
    {
      objectType: params.objectType || undefined,
      action: params.action || undefined,
    },
    Number.isFinite(page) ? page : 1,
    pageSize,
  );

  const pageAddress = (pageNumber: number) =>
    buildQueryAddress(
      "/admin/audit",
      {
        objectType: params.objectType,
        action: params.action,
        pageSize: String(pageSize),
      },
      { page: String(pageNumber) },
    );

  return (
    <AppShell
      user={await toShellUser(user)}
    >
      <Page marker="audit-log">
        <PageHeader
          title={t("screens.audit.pageTitle")}
          description={t("screens.audit.pageDescription")}
          breadcrumbs={[
            { label: t("screens.audit.administration") },
            { label: t("screens.audit.pageTitle") },
          ]}
        />

        <AdminNav isRoot={user.isRoot} />


        <Card>
          <FilterBar
            action="/admin/audit"
            clearHref="/admin/audit"
            filtered={Boolean(params.objectType) || Boolean(params.action)}
            pageSize={pageSize}
            submitLabel={t("screens.audit.filter")}
            fields={[
              {
                name: "objectType",
                label: t("screens.audit.objectType"),
                value: params.objectType ?? "",
                width: "w-52",
                options: [
                  { value: "", label: t("common.all") },
                  ...Object.values(AUDIT_OBJECTS).map((value) => ({
                    value,
                    label: t(OBJECT_LABEL_KEYS[value] ?? value),
                  })),
                ],
              },
              {
                name: "action",
                label: t("screens.audit.operation"),
                value: params.action ?? "",
                width: "w-64",
                options: [
                  { value: "", label: t("common.all") },
                  ...Object.values(AUDIT_ACTIONS).map((value) => ({
                    value,
                    label: t(ACTION_LABEL_KEYS[value] ?? value),
                  })),
                ],
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader
            title={t("screens.audit.recordsTitle")}
            description={
              result.pageCount > 1
                ? t("screens.audit.recordsPageDescription", {
                    count: result.total,
                    page: result.page,
                    pageCount: result.pageCount,
                  })
                : t("screens.audit.recordsDescription", { count: result.total })
            }
          />

          {result.entries.length === 0 ? (
            <EmptyState
              title={t("screens.audit.noRecords")}
              description={t("screens.audit.noRecordsDescription")}
            />
          ) : (

            //




            <RecordList>
              {result.entries.map((entry) => (
                <RecordItem key={entry.id} data-test="audit-record" className="sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <Badge>
                        {t(OBJECT_LABEL_KEYS[entry.objectType] ?? entry.objectType)}
                      </Badge>
                      <span className="font-medium text-ink">
                        {t(ACTION_LABEL_KEYS[entry.action] ?? entry.action)}
                      </span>
                    </p>
                    <time className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
                      {formatInstantPrecise(entry.createdAt, locale)}
                    </time>
                  </div>

                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-sm)] text-muted">
                    <span className="font-medium text-ink">
                      {entry.userName ?? t("screens.audit.unknownUser")}
                    </span>

                    {entry.actualUserName ? (
                      <span className="text-[length:var(--text-sm)] text-muted">
                        · {t("screens.audit.onBehalfOf")} {entry.actualUserName}
                      </span>
                    ) : null}
                    {entry.ipAddress ? (
                      <>
                        <span aria-hidden className="text-line-strong">·</span>
                        <span className="mono text-[length:var(--text-xs)] text-faint">
                          {entry.ipAddress}
                        </span>
                      </>
                    ) : null}
                  </p>

                  <DetailRow detail={entry.detail} t={t} />
                </RecordItem>
              ))}
            </RecordList>
          )}

          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            hrefFor={pageAddress}
            totalLabel={t("screens.audit.totalRecords", { count: result.total })}
          />
        </Card>
      </Page>
    </AppShell>
  );
}

/**
 * Renders audit details as readable field-value pairs instead of raw JSON.
 * Unknown fields remain visible by their key so no audit information is lost.
 */
const DETAIL_LABEL_KEYS: Record<string, string> = {
  revisionNo: "screens.audit.detailRevision",
  approvalStatus: "screens.audit.detailApprovalStatus",
  activityDate: "screens.audit.detailActivityDate",
  email: "screens.audit.detailEmail",
  orgUnitId: "screens.audit.detailUnit",
  isUnitManager: "screens.audit.detailUnitManager",
  isSystemAdmin: "screens.audit.detailSystemAdministrator",
  writesActivities: "screens.audit.detailWritesActivities",
  reason: "screens.audit.detailReason",
  before: "screens.audit.detailBefore",
  after: "screens.audit.detailAfter",
};

function readable(value: unknown, t: TranslateFunction): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function DetailRow({ detail, t }: { detail: unknown; t: TranslateFunction }) {
  if (detail === null || detail === undefined) return null;

  if (typeof detail !== "object") {
    return (
      <p className="mt-1.5 text-[length:var(--text-xs)] text-faint">
        {readable(detail, t)}
      </p>
    );
  }

  const inputs = Object.entries(detail as Record<string, unknown>);
  if (inputs.length === 0) return null;

  return (
    <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--text-xs)]">
      {inputs.map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-1.5">
          <dt className="text-faint">{t(DETAIL_LABEL_KEYS[key] ?? key)}:</dt>
          <dd className="mono break-all text-muted">{readable(value, t)}</dd>
        </div>
      ))}
    </dl>
  );
}
