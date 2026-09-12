import Link from "next/link";
import { redirect } from "next/navigation";

import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { AppShell } from "@/components/shell/app-shell";
import { ScoreCard } from "@/components/scoring/score-card";
import { toShellUser } from "@/components/shell/shell-user";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordItem, RecordList } from "@/components/ui/table";
import { getCurrentUser } from "@/server/auth/current-user";
import { subordinateUserIds } from "@/server/authz/visibility";
import { prisma } from "@/server/db";
import {
  readDeclineThreshold,
  readScoreTrends,
  readTeamScores,
  readUserScore,
} from "@/server/scoring/read";
import { SETTING_KEYS, readBooleanSetting } from "@/server/settings/system-settings";
import { getLocale } from "@/server/i18n/locale";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.scoresPage.pageTitle");
}

export default async function ScoresPage({
  searchParams,
}: {
  searchParams: Promise<{ ranking?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const now = new Date();
  const params = await searchParams;

  const [rawScores, declineThreshold, subordinates, rankingEnabled, ownScore] =
    await Promise.all([
      readTeamScores(prisma, viewer, now),
      readDeclineThreshold(prisma),
      subordinateUserIds(prisma, viewer.id),
      readBooleanSetting(prisma, SETTING_KEYS.scoringRankingEnabled),
      readUserScore(prisma, viewer, viewer.id, now),
    ]);

  const trends = await readScoreTrends(
    prisma,
    viewer,
    rawScores.map((score) => score.userId),
  );
  const scores = rawScores.map((score) => ({
    ...score,
    declining: trends.get(score.userId)?.declining ?? false,
  }));

  const sortByScore = rankingEnabled && params.ranking === "score";
  if (sortByScore) scores.sort((a, b) => b.total - a.total);

  return (
    <AppShell user={await toShellUser(user, subordinates)}>
      <Page marker="scores">
        <PageHeader
          title={t("screens.scoresPage.pageTitle")}
          description={t("screens.scoresPage.pageDescription")}
          breadcrumbs={[
            { label: t("screens.scoresPage.dashboard"), href: "/" },
            { label: t("screens.scoresPage.pageTitle") },
          ]}
        />

        {ownScore ? (
          <Card>
            <CardHeader
              title={t("screens.scoresPage.myScore")}
              description={t("screens.scoresPage.myScoreDescription")}
            />
            <CardBody>
              <ScoreCard score={ownScore} appreciations={null} />
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title={t("screens.scoresPage.currentPeriod")}
            description={t("screens.scoresPage.currentPeriodDescription", {
              periods: declineThreshold,
            })}
            action={
              rankingEnabled ? (
                <Link
                  href={sortByScore ? "/scores" : "/scores?ranking=score"}
                  className="text-[length:var(--text-sm)] text-primary underline-offset-4 hover:underline"
                >
                  {sortByScore
                    ? t("screens.scoresPage.sortAlphabetically")
                    : t("screens.scoresPage.sortByScore")}
                </Link>
              ) : null
            }
          />

          {scores.length === 0 ? (
            <EmptyState
              title={t("screens.scoresPage.noScores")}
              description={t("screens.scoresPage.noScoresDescription")}
            />
          ) : (
            <RecordList>
              {scores.map((score) => (
                <RecordItem key={score.userId} data-test="score-record">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar
                        user={{ id: score.userId, fullName: score.fullName }}
                        size={28}
                        locale={locale}
                      />
                      <Link
                        href={`/users/${score.userId}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {score.fullName}
                      </Link>
                      <span className="text-[length:var(--text-xs)] text-muted">
                        {t("screens.scoresPage.businessDays", {
                          written: score.writtenDays,
                          expected: score.expectedDays,
                        })}
                      </span>
                    </span>

                    <span className="flex items-center gap-3">
                      {score.declining ? (
                        <Badge tone="danger">
                          {t("screens.scoresPage.declining", { periods: declineThreshold })}
                        </Badge>
                      ) : null}
                      {score.regularity === 0 && score.expectedDays > 0 ? (
                        <Badge tone="danger">{t("screens.scoresPage.noActivity")}</Badge>
                      ) : null}
                      <span className="mono text-[length:var(--text-lg)] font-semibold text-ink">
                        {score.total}
                      </span>
                      {score.appreciationCount > 0 ? (
                        <span className="text-[length:var(--text-xs)] text-muted">
                          {t("screens.scoresPage.recognitionContribution", {
                            points: score.appreciationPoints,
                          })}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </RecordItem>
              ))}
            </RecordList>
          )}
        </Card>
      </Page>
    </AppShell>
  );
}
