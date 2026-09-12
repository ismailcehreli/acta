import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { getLocale } from "@/server/i18n/locale";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { activityMaintenanceReader } from "@/server/authz/activity-repository";
import { canViewActivity } from "@/server/authz/visibility";
import { canAskQuestion } from "@/server/conversations/service";
import { listActivityConversations } from "@/server/conversations/read";
import { prisma } from "@/server/db";
import { listActivityAttachments } from "@/server/attachments/service";
import { appSecret } from "@/server/auth/config";
import { listActivityReaders } from "@/server/reads/service";
import { issueReadTicket } from "@/server/reads/ticket";
import { listActiveReasons } from "@/server/approval-reasons/service";
import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import {
  findLatestClosedFollowUp,
  findOpenFollowUp,
} from "@/server/follow-ups/read";
import { isInManagementChain } from "@/server/org/chain";

import { subordinateUserIds } from "@/server/authz/visibility";
import { AttachmentGallery } from "@/components/activities/attachment-gallery";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";

import { canDecideOnActivity } from "@/server/activities/approval";

import { ApprovalPanel } from "./approval-panel";
import { FollowUpPanel } from "./follow-up-panel";
import { AskQuestionForm, ConversationList } from "./conversation-panel";
import { ReadTracker } from "./read-tracker";
import { formatDay, formatInstant } from "@/shared/format/date-time";
import { describeActivityDates } from "@/shared/format/activity-dates";
import { countAppreciations } from "@/server/scoring/appreciation";
import {
  readBooleanSetting,
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";

import { AppreciateButton } from "./appreciate-button";

export async function generateMetadata() {
  return getLocalizedMetadata("activities.title");
}

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  const { id } = await params;
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };

  const activity = await activityMaintenanceReader(prisma).findUnique({
    where: { id },
    select: {
      id: true,
      activityNo: true,
      authorId: true,
      approvalStatus: true,
      activityDate: true,
      createdAt: true,
      updatedAt: true,
      currentRevisionNo: true,
      title: true,
      description: true,
      author: { select: { fullName: true, title: true, avatarExtension: true } },
      authorOrgUnit: { select: { name: true } },
      targetDepts: { select: { orgUnit: { select: { name: true } } } },
      cancellation: { select: { reason: true } },
      approverId: true,
      approvalReasonNote: true,
      approvalReason: { select: { label: true } },
      approver: { select: { fullName: true } },
    },
  });


  const level = activity
    ? await canViewActivity(prisma, viewer, activity)
    : "none";


  if (!activity || level === "none") notFound();

  const isCancelled = activity.approvalStatus === "CANCELLED";




  const [appreciationOpen, appreciationCount, ownAppreciation] = await Promise.all([
    readBooleanSetting(prisma, SETTING_KEYS.appreciationEnabled),
    countAppreciations(prisma, activity.id),
    prisma.activityAppreciation.findUnique({
      where: { activityId_userId: { activityId: activity.id, userId: user.id } },
      select: { userId: true },
    }),
  ]);

  const activityDates = describeActivityDates(
    {
    ...activity,
    revisionNo: activity.currentRevisionNo,
    },
    locale,
    {
      saved: t("activities.saved"),
      lastEdited: t("activities.lastEdited"),
    },
  );


  if (level === "metadata") {
    return (
      <AppShell
        user={await toShellUser(user)}
      >
        <Page>
          <PageHeader
            title={activity.title}
            description={`${activity.author.fullName} · ${formatDay(activity.activityDate, locale)}`}
            breadcrumbs={[{ label: t("screens.activitiesPage.dashboard"), href: "/" }, { label: t("activities.title") }]}
          />
          <Card>
            <CardBody>
              <p className="text-sm text-muted">
                {t("activityDetail.metadataDescription")}
              </p>
            </CardBody>
          </Card>
        </Page>
      </AppShell>
    );
  }

  const [
    conversations,
    canAsk,
    readers,
    attachments,
    subordinates,
    readDwellSeconds,
  ] = await Promise.all([
    listActivityConversations(prisma, viewer, activity.id),
    canAskQuestion(prisma, viewer, activity),
    listActivityReaders(prisma, viewer, activity.id),
    listActivityAttachments(prisma, viewer, activity.id),
    subordinateUserIds(prisma, user.id),
    readNumericSetting(prisma, SETTING_KEYS.readDwellSeconds),
  ]);

  const isAuthor = activity.authorId === user.id;
  // The panel mirrors the same authorization check used by the server action.
  // Keeping both paths on one function prevents hidden-action mismatches.
  const canDecide = await canDecideOnActivity(prisma, user.id, activity.id);
  const approvalPending = activity.approvalStatus === "PENDING_APPROVAL";
  const changesRequested = activity.approvalStatus === "CHANGES_REQUESTED";
  const isRejected = activity.approvalStatus === "REJECTED";
  // A pending decision shows the panel. A changes-requested record has no
  // approval action, but rejection remains available so it cannot stay open forever.
  const decisionPending = approvalPending || changesRequested;

  // Follow-up details are shown only after full-content visibility is confirmed.
  const [openFollowUp, closedFollowUp, calendarSettings] = await Promise.all([
    findOpenFollowUp(prisma, activity.id),
    findLatestClosedFollowUp(prisma, activity.id),
    readWorkCalendar(prisma),
  ]);

  const now = new Date();
  const followUpInactivity = openFollowUp
    ? businessDaysBetween(openFollowUp.lastMovedAt, now, {
        workingDays: calendarSettings.workingDays,
      })
    : 0;

  const canManageFollowUp = openFollowUp
    ? openFollowUp.ownerId === user.id ||
      openFollowUp.openedById === user.id ||
      (await isInManagementChain(prisma, openFollowUp.ownerId, user.id))
    : closedFollowUp
      ? closedFollowUp.ownerId === user.id ||
        closedFollowUp.openedById === user.id ||
        (await isInManagementChain(prisma, closedFollowUp.ownerId, user.id))
      : false;

  // Load reason catalogs only for a person who can make the decision.
  const [changesReasons, rejectReasons] =
    decisionPending && canDecide
      ? await Promise.all([
          listActiveReasons(prisma, "CHANGES_REQUESTED"),
          listActiveReasons(prisma, "REJECTED"),
        ])
      : [[], []];

  return (
    <AppShell
      user={await toShellUser(user, subordinates)}
    >
      <Page>
        <PageHeader
          title={
            <span className={isCancelled ? "text-muted line-through" : undefined}>
              {activity.title}
            </span>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* Short identifier used when referring to a record in conversation
                  and documentation (§3.1). */}
              <span className="tabular text-muted">#{activity.activityNo}</span>
              <span aria-hidden>·</span>
              {/* The profile link is useful for the author's unit context; the
                  profile page performs its own visibility check. */}
              <Avatar
                user={{
                  id: activity.authorId,
                  fullName: activity.author.fullName,
                  avatarExtension: activity.author.avatarExtension,
                }}
                size={24}
                locale={locale}
              />
              <Link
                href={`/users/${activity.authorId}`}
                className="font-medium text-ink hover:underline"
              >
                {activity.author.fullName}
              </Link>
              {/* A title describes the person but grants no permission. */}
              {activity.author.title ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{activity.author.title}</span>
                </>
              ) : null}
              <span aria-hidden>·</span>
              <span>{activity.authorOrgUnit.name}</span>
              <span aria-hidden>·</span>
              <time dateTime={activity.activityDate.toISOString().slice(0, 10)}>
                {activityDates.main}
              </time>
              {isCancelled ? (
                <Badge tone="danger">{t("activityStatus.CANCELLED")}</Badge>
              ) : null}
              {approvalPending ? (
                <Badge tone="waiting">{t("activityStatus.PENDING_APPROVAL")}</Badge>
              ) : null}
              {changesRequested ? (
                <Badge tone="correction">{t("activityStatus.CHANGES_REQUESTED")}</Badge>
              ) : null}
              {isRejected ? (
                <Badge tone="danger">{t("activityStatus.REJECTED")}</Badge>
              ) : null}
              {activity.approvalStatus === "MANAGER_NOT_FOUND" ? (
                <Badge tone="danger">{t("activityStatus.MANAGER_NOT_FOUND")}</Badge>
              ) : null}
              {activity.currentRevisionNo > 1 ? (
                <Badge tone="neutral">
                  {t("activities.revisionLabel", {
                    count: activity.currentRevisionNo,
                  })}
                </Badge>
              ) : null}
            </span>
          }
          breadcrumbs={[
            { label: t("screens.activitiesPage.dashboard"), href: "/" },
            isAuthor
              ? { label: t("screens.activitiesPage.pageTitle"), href: "/activities" }
              : { label: t("activities.title") },
            ...(isAuthor ? [{ label: t("activityDetail.record") }] : []),
          ]}
        />

        {/* The current decision state should be visible before the record content. */}

        {/* The record occupies the main column; decision controls use a narrow
            side rail on wide screens and move below the record on small screens. */}
        <div className="grid gap-(--spacing-section) xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start xl:gap-8">
          <div className="flex min-w-0 flex-col gap-(--spacing-block)">
        <Card>
          <CardBody className="flex flex-col gap-4">
            {activity.targetDepts.length > 0 ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span className="text-muted">{t("activityDetail.relatedDepartments")}</span>
                {activity.targetDepts.map((t) => (
                  <Badge key={t.orgUnit.name}>{t.orgUnit.name}</Badge>
                ))}
              </p>
            ) : null}

            <p className="whitespace-pre-line leading-relaxed text-ink">
              {activity.description}
            </p>

            {appreciationOpen && user.canAppreciate ? (
              <div className="border-t border-line pt-3">
                <AppreciateButton
                  activityId={activity.id}
                  count={appreciationCount}
                  already={ownAppreciation !== null}
                />
              </div>
            ) : appreciationOpen && appreciationCount > 0 ? (
              <p className="border-t border-line pt-3 text-[length:var(--text-sm)] text-muted">
                {t("activities.appreciationCount", { count: appreciationCount })}
              </p>
            ) : null}

            {/* The activity date is shown in the header; this line records when
                the entry itself was saved and revised. */}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[length:var(--text-xs)] text-muted">
              <time dateTime={activity.createdAt.toISOString()}>
                {activityDates.created}
              </time>
              {activityDates.revised ? (
                <>
                  <span aria-hidden>·</span>
                  <time
                    dateTime={activity.updatedAt.toISOString()}
                    className="font-medium text-ink"
                  >
                    {activityDates.revised}
                  </time>
                </>
              ) : null}
            </p>

            {isCancelled && activity.cancellation ? (
              <div className="rounded-(--radius-sm) border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm">
                <span className="font-medium">{t("activityDetail.cancellationReason")}</span>{" "}
                {activity.cancellation.reason}
              </div>
            ) : null}

            {/* Images, PDFs, and videos open without leaving the page; other
                types are downloaded as before (§15.4). */}
            <AttachmentGallery attachments={attachments} />

            {readers.length > 0 ? (
              <p
                id="readers"
                className="border-t border-line pt-4 text-sm text-muted"
              >
                {isAuthor
                  ? t("activities.readByUsers", {
                      readers: readers
                      .map(
                        (reader) =>
                          `${reader.fullName} · ${formatInstant(reader.firstReadAt, locale)}`,
                      )
                      .join(", "),
                    })
                  : t("activities.readYourselfAt", {
                      date: formatInstant(readers[0].firstReadAt, locale),
                    })}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("conversations.title")}
            description={t("conversations.questionDescription")}
          />
          <CardBody>
            <ConversationList
              conversations={conversations}
              viewerId={user.id}
              viewerIsSystemAdmin={user.isSystemAdmin}
            />
            {canAsk && !isCancelled ? (
              <div className="mt-4 border-t border-line pt-4">
                <AskQuestionForm activityId={activity.id} />
              </div>
            ) : null}
          </CardBody>
        </Card>

          </div>

          <aside aria-label={t("activityDetail.decisionAndFollowUp")} className="flex min-w-0 flex-col gap-(--spacing-block)">
        {decisionPending && canDecide ? (
          <Card>
            <CardHeader
              title={t("approvals.approvalCardTitle")}
              description={
                approvalPending
                  ? activity.currentRevisionNo > 1
                    ? t("approvals.revisedApprovalDescription")
                    : t("approvals.pendingApprovalDescription")
                  : t("approvals.changesPendingDescription")
              }
            />
            <CardBody>
              <ApprovalPanel
                activityId={activity.id}
                canApprove={approvalPending}
                changesReasons={changesReasons}
                rejectReasons={rejectReasons}
              />
            </CardBody>
          </Card>
        ) : null}

        {approvalPending && isAuthor ? (
          <Alert tone="info" title={t("approvals.awaitingApproval")}>
            {activity.approver
              ? t("approvals.approvedBy", { name: activity.approver.fullName })
              : t("approvals.higherLevelsAfterApproval")}{" "}
            {t("approvals.lockedWhilePending")}
          </Alert>
        ) : null}

        {changesRequested && activity.approvalReason ? (
          <Card data-test="changes-requested-reason">
            <CardHeader
              title={t("approvals.changesRequested")}
              description={
                activity.approver
                  ? t("approvals.requestedBy", { name: activity.approver.fullName })
                  : undefined
              }
              action={
                isAuthor ? (
                  <ButtonLink
                    href={`/activities/${activity.id}/edit`}
                    variant="primary"
                    size="sm"
                  >
                    {t("activities.revise")}
                  </ButtonLink>
                ) : null
              }
            />
            <CardBody>
              <p className="font-medium text-ink">{activity.approvalReason.label}</p>
              {activity.approvalReasonNote ? (
                <p className="mt-1 whitespace-pre-line text-muted">
                  {activity.approvalReasonNote}
                </p>
              ) : null}
              {isAuthor ? (
                <p className="mt-3 text-[length:var(--text-sm)] text-muted">
                  {t("approvals.reviseAndResubmit")}
                </p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {isRejected && activity.approvalReason ? (
          <Card data-test="rejection-reason">
            <CardHeader
              title={t("approvals.rejected")}
              description={
                activity.approver
                  ? t("approvals.rejectedBy", { name: activity.approver.fullName })
                  : t("approvals.rejectedDescription")
              }
            />
            <CardBody>
              <p className="font-medium text-ink">{activity.approvalReason.label}</p>
              {activity.approvalReasonNote ? (
                <p className="mt-1 whitespace-pre-line text-muted">
                  {activity.approvalReasonNote}
                </p>
              ) : null}
              {isAuthor ? (
                <p className="mt-3 text-[length:var(--text-sm)] text-muted">
                  {t("approvals.cannotReviseRejected")}
                </p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        <FollowUpPanel
          activityId={activity.id}
          item={
            openFollowUp
              ? {
                  id: openFollowUp.id,
                  ownerName: openFollowUp.owner.fullName,
                  openedByName: openFollowUp.openedBy.fullName,
                  nextStep: openFollowUp.nextStep,
                  reviewDate: openFollowUp.reviewDate
                    ? formatDay(openFollowUp.reviewDate, locale)
                    : null,
                  idleBusinessDays: followUpInactivity,
                }
              : null
          }
          closed={
            !openFollowUp && closedFollowUp && closedFollowUp.closedAt
              ? {
                  id: closedFollowUp.id,
                  closedByName: closedFollowUp.closedBy?.fullName ?? "—",
                  closingNote: closedFollowUp.closingNote ?? "",
                  closedAt: formatDay(closedFollowUp.closedAt, locale),
                }
              : null
          }
          canManage={canManageFollowUp}
            canOpen={!isCancelled && !isRejected}
        />

          </aside>
        </div>

        {/* Read-time measurement is meaningful only for another person's record. */}
        {isAuthor ? null : (
          <ReadTracker
            activityId={activity.id}
            dwellMs={readDwellSeconds * 1_000}
            // The ticket is issued here, after visibility is verified; the server
            // supplies the timestamp (§10.2).
            ticket={issueReadTicket(activity.id, user.id, new Date(), appSecret())}
          />
        )}
      </Page>
    </AppShell>
  );
}
