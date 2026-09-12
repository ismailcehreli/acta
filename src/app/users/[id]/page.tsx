import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApprovalBadge } from "@/components/activities/approval-badge";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Page, PageHeader, Stat, StatStrip } from "@/components/ui/page";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLocale } from "@/server/i18n/locale";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { prisma } from "@/server/db";
import { readVapidPublicKey } from "@/server/settings/vapid";
import { listProfileActivities, loadProfile } from "@/server/users/profile";
import { PushToggle } from "@/components/push/push-toggle";

import { NotificationModeForm } from "./notification-mode-form";
import { AvatarForm } from "./avatar-form";
import { formatDay, formatInstant } from "@/shared/format/date-time";
import { readScoreTrend, readUserScore } from "@/server/scoring/read";
import { ScoreCard } from "@/components/scoring/score-card";


//



//


export async function generateMetadata() {
  return getLocalizedMetadata("screens.profile.myProfile");
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  const { id } = await params;
  const viewer = {
    id: user.id,
    isSystemAdmin: user.isSystemAdmin,
    isUnitManager: user.isUnitManager,
    orgUnitId: user.orgUnitId,
  };

  const profile = await loadProfile(prisma, viewer, id, new Date());



  if (profile.access === "none") notFound();



  const [score, trend] = await Promise.all([
    readUserScore(prisma, viewer, id, new Date()),
    readScoreTrend(prisma, viewer, id),
  ]);

  const shellUser = await toShellUser(user);
  const isSelf = profile.person.id === user.id;

  const roles = [
    profile.person.isSystemAdmin ? t("screens.profile.systemAdministrator") : null,
    profile.person.isUnitManager ? t("screens.profile.unitManager") : null,
  ].filter((role): role is string => role !== null);

  return (
    <AppShell user={shellUser}>
      <Page>
        <PageHeader
          breadcrumbs={
            isSelf
              ? [{ label: t("screens.profile.dashboard"), href: "/" }, { label: t("screens.profile.myProfile") }]
              : [{ label: t("screens.profile.dashboard"), href: "/" }, { label: profile.person.fullName }]
          }
          title={profile.person.fullName}
          marker={profile.person.title ?? undefined}
          description={`${profile.person.orgUnitName} · ${profile.person.email}`}
        />

        {score ? (
          <Card>
            <CardHeader
              title={t("screens.profile.scoreTitle")}
              description={`${isSelf ? t("screens.profile.baseScoreSelf") : t("screens.profile.baseScoreOther")} ${t("screens.profile.scoreDescription")}`}
            />
            <CardBody>
              <ScoreCard
                score={score}
                appreciations={null}
                trend={trend}
                self={isSelf}
              />
            </CardBody>
          </Card>
        ) : null}

        {/* The person or a system administrator can change the picture; others
            can only view it (§11.5). */}
        <Card>
          <CardBody>
            <AvatarForm
              user={{
                id: profile.person.id,
                fullName: profile.person.fullName,
                avatarExtension: profile.person.avatarExtension,
              }}
              canEdit={isSelf || profile.access === "metadata" || user.isSystemAdmin}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("screens.profile.person")} />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {roles.map((role) => (
                <Badge key={role} tone="primary">
                  {role}
                </Badge>
              ))}
              {roles.length === 0 ? <Badge>{t("screens.profile.user")}</Badge> : null}

              {profile.person.isActive ? null : (
                <Badge tone="danger">{t("screens.profile.inactive")}</Badge>
              )}

              {/* Some roles are not expected to enter activities (§7.4). */}
              {profile.person.writesActivities ? null : (
                <Badge tone="neutral">{t("screens.profile.activityWriterDisabled")}</Badge>
              )}
            </div>
            {profile.person.lastLoginVisible ? (
              <p className="mt-3 text-[length:var(--text-sm)] text-muted">
                <span className="font-medium text-ink">{t("screens.profile.lastSuccessfulSignIn")}</span>{" "}
                {profile.person.lastLoginAt
                  ? formatInstant(profile.person.lastLoginAt, locale)
                  : t("screens.profile.neverSignedIn")}
              </p>
            ) : null}
          </CardBody>
        </Card>

        {/* Notification preferences belong only to the signed-in person's profile. */}
        {isSelf ? (
          <Card>
            <CardHeader
              title={t("screens.profile.browserNotifications")}
              description={t("screens.profile.browserNotificationsDescription")}
            />
            <CardBody>
              <PushToggle publicKey={await readVapidPublicKey(prisma)} />
            </CardBody>
          </Card>
        ) : null}

        {isSelf ? (
          <Card>
            <CardHeader
              title={t("screens.profile.emailNotifications")}
              description={t("screens.profile.emailNotificationsDescription")}
            />
            <CardBody>
              <NotificationModeForm current={user.notificationMode} />
            </CardBody>
          </Card>
        ) : null}

        {profile.access === "metadata" ? (
          <Card>
            <CardBody>
              <p className="text-[length:var(--text-sm)] text-muted">
                {t("screens.profile.metadataDescription")}
              </p>
            </CardBody>
          </Card>
        ) : (
          <>
            {/* The summary strip makes the person's reporting rhythm readable (§6). */}
            <section aria-labelledby="summary-heading">
              <h2 id="summary-heading" className="section-label mb-2">
                {t("screens.profile.summary")}
              </h2>
              <StatStrip>
                <Stat label={t("screens.profile.total")} value={profile.stats.total} />
                <Stat label={t("screens.profile.thisMonth")} value={profile.stats.thisMonth} tone="primary" />
                <Stat
                  label={t("screens.profile.pending")}
                  value={profile.stats.pending}
                  tone={profile.stats.pending > 0 ? "correction" : "neutral"}
                  hint={
                    profile.stats.pending > 0
                      ? t("screens.profile.pendingHint")
                      : undefined
                  }
                />
                <Stat
                  label={t("screens.profile.lastActivity")}
                  value={
                    profile.stats.lastActivityDate
                      ? formatDay(profile.stats.lastActivityDate, locale)
                      : "—"
                  }
                />
              </StatStrip>
            </section>

            <ProfileArchive viewer={viewer} userId={profile.person.id} locale={locale} />
          </>
        )}
      </Page>
    </AppShell>
  );
}

async function ProfileArchive({
  viewer,
  userId,
  locale,
}: {
  viewer: { id: string; isSystemAdmin: boolean };
  userId: string;
  locale: Parameters<typeof formatDay>[1];
}) {
  const t = await getTranslations(locale);
  const records = await listProfileActivities(prisma, viewer, userId);

  return (
    <Card>
      <CardHeader
        title={t("screens.profile.archive")}
        description={
          records.length === 0
            ? undefined
            : t("screens.profile.archiveDescription", { count: records.length })
        }
      />

      {records.length === 0 ? (
        <CardBody>
          <p className="text-[length:var(--text-sm)] text-muted">
            {t("screens.profile.noActivities")}
          </p>
        </CardBody>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH align="right">{t("screens.profile.number")}</TH>
              <TH>{t("screens.profile.date")}</TH>
              <TH>{t("screens.profile.title")}</TH>
              <TH>{t("screens.profile.status")}</TH>
            </TR>
          </THead>
          <TBody>
            {records.map((record) => (
              <TR key={record.id} data-test="profile-activity">
                <TD align="right" className="tabular text-muted">
                  {record.activityNo}
                </TD>
                <TD className="whitespace-nowrap text-muted">
                  {formatDay(record.activityDate, locale)}
                </TD>
                <TD>
                  <Link
                    href={`/activities/${record.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {record.title}
                  </Link>
                </TD>
                <TD>
                  <ApprovalBadge status={record.approvalStatus} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
