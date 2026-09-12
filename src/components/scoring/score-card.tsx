import type { ScoreTrend, UserScore } from "@/server/scoring/read";
import { getLocale } from "@/server/i18n/locale";
import { getTranslations } from "@/server/i18n/server";
import { formatNumber, formatPercentage } from "@/shared/format/locale";


//



export async function ScoreCard({
  score,
  appreciations,
  trend,
  self = true,
}: {
  score: UserScore;
  /** Backward-compatible value for older callers; the new score field is canonical. */
  appreciations: number | null;
  /** Historical periods and the decline indicator (Task 11.11). */
  trend?: ScoreTrend;
  /** Whether the card is shown on the person's own screen. */
  self?: boolean;
}) {
  const locale = await getLocale();
  const t = await getTranslations(locale);
  const appreciationCount = score.appreciationCount ?? appreciations ?? 0;
  const appreciationPoints = score.appreciationPoints ?? 0;
  const appreciationPointsPer = score.appreciationPointsPer ?? 0;
  const baseTotal = score.baseTotal ?? score.total - appreciationPoints;
  const reportingText = self
    ? t("screens.scoring.selfReporting")
    : t("screens.scoring.teamReporting");
  const dimensions = [
    {
      name: t("screens.scoring.reportingRegularity"),
      points: score.regularity,
      maximum: score.weights.regularity,
      description:
        score.expectedDays > 0
          ? t("screens.scoring.reportingRegularityDescription", {
              expected: formatNumber(score.expectedDays, locale),
              reporting: reportingText,
              written: formatNumber(score.writtenDays, locale),
              percentage: formatPercentage(
                (score.writtenDays / score.expectedDays) * 100,
                locale,
              ),
            })
          : t("screens.scoring.noExpectedDays"),
      hint: t("screens.scoring.distinctDays"),
    },
    score.acceptance !== null
      ? {
          name: t("screens.scoring.acceptanceRate"),
          points: score.acceptance,
          maximum: score.weights.acceptance,
          description: t("screens.scoring.acceptanceDescription", {
            written: score.writtenCount,
            approved: score.approvedCount,
          }),
          hint: t("screens.scoring.acceptanceHint"),
        }
      : null,
    score.approval !== null
      ? {
          name: t("screens.scoring.approvalTime"),
          points: score.approval,
          maximum: score.weights.approval,
          description: t("screens.scoring.approvalDescription", {
            decided: score.decidedCount,
            onTime: score.decidedOnTimeCount,
          }),
          hint: t("screens.scoring.approvalHint"),
        }
      : null,
    {
      name: t("screens.scoring.followUpDiscipline"),
      points: score.followUp,
      maximum: score.weights.followUp,
      description: t("screens.scoring.followUpDescription", {
        total: score.followUpTotal,
        handled: score.followUpHandled,
      }),
      hint: t("screens.scoring.followUpHint"),
    },
  ].filter(Boolean) as {
    name: string;
    points: number;
    maximum: number;
    description: string;
    hint: string;
  }[];

  return (
    <div className="flex flex-col gap-4" data-test="score-card">
      <div className="flex items-baseline gap-3">
        <span className="mono text-[length:var(--text-3xl)] font-semibold text-ink">
          {score.total}
        </span>
        <span className="text-[length:var(--text-sm)] text-muted">
          {t("screens.scoring.totalLabel")}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--text-xs)] text-muted">
        <span>{t("screens.scoring.baseScore", { score: baseTotal })}</span>
        <span>
          {t("screens.scoring.recognitionContribution", { points: appreciationPoints })}
          {appreciationCount > 0
            ? ` · ${t("screens.scoring.recognitionCount", { count: appreciationCount, points: appreciationPointsPer })}`
            : ""}
        </span>
      </div>

      {appreciationPoints > 0 ? (
        <p className="text-[length:var(--text-xs)] text-muted">
          {t("screens.scoring.recognitionExplanation")}
        </p>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2">
        {dimensions.map((dimension) => (
          <div
            key={dimension.name}
            className="rounded-(--radius-sm) border border-line bg-inset/40 px-3.5 py-3"
          >
            <dt className="flex items-baseline justify-between gap-2">
              <span className="text-[length:var(--text-sm)] font-medium text-ink">
                {dimension.name}
              </span>
              <span className="mono text-[length:var(--text-sm)] text-ink">
                {dimension.points} / {dimension.maximum}
              </span>
            </dt>
            <dd className="mt-0.5 text-[length:var(--text-xs)] text-muted">
              {dimension.description}
            </dd>
            <dd className="mt-1 text-[length:var(--text-2xs)] leading-snug text-faint">
              {dimension.hint}
            </dd>
          </div>
        ))}
      </dl>

      {trend && trend.periods.length > 0 ? (
        <div className="rounded-(--radius-sm) border border-line px-3.5 py-3">
          <p className="text-[length:var(--text-sm)] font-medium text-ink">
            {t("screens.scoring.pastPeriods")}
          </p>
          {/* The useful signal is the trend, not a rank that hides the direction of change. */}
          <ol className="mt-2 flex flex-wrap gap-3">
            {trend.periods.map((period) => (
              <li
                key={period.periodStart}
                className="text-[length:var(--text-xs)] text-muted"
              >
                <span className="mono text-ink">{period.total}</span>{" "}
                <span className="text-faint">{period.periodStart.slice(0, 7)}</span>
              </li>
            ))}
          </ol>
          {trend.declining ? (
            <p className="mt-2 text-[length:var(--text-sm)] text-danger">
              {t("screens.scoring.declining")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
