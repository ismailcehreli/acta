"use client";

import Link from "next/link";
import { useTranslations } from "@/components/i18n";

import {
  profileWeights,
  type ScoreProfile,
  type ScoreWeights,
} from "@/server/scoring/compute";
import { SETTING_KEYS } from "@/server/settings/registry";

function numberValue(values: Record<string, string>, key: string, fallback: number) {
  const value = Number(values[key]);
  return Number.isFinite(value) ? value : fallback;
}

function readWeights(values: Record<string, string>): ScoreWeights {
  return {
    regularity: numberValue(values, SETTING_KEYS.scoringWeightRegularity, 60),
    acceptance: numberValue(values, SETTING_KEYS.scoringWeightAcceptance, 30),
    approval: numberValue(values, SETTING_KEYS.scoringWeightApproval, 30),
    followUp: numberValue(values, SETTING_KEYS.scoringWeightFollowUp, 10),
  };
}

function readAppreciationPoints(values: Record<string, string>): number {
  return numberValue(values, SETTING_KEYS.scoringAppreciationPoints, 1);
}

function distribution(
  weights: ScoreWeights,
  labels: Record<"regularity" | "acceptance" | "approval" | "followUp", string>,
  formatWeight: (label: string, value: number) => string,
): string[] {
  const dimensions: Array<[string, number]> = [
    [labels.regularity, weights.regularity],
    [labels.acceptance, weights.acceptance],
    [labels.approval, weights.approval],
    [labels.followUp, weights.followUp],
  ];

  return dimensions
    .filter(([, value]) => value > 0)
    .map(([label, value]) => formatWeight(label, value));
}

export function ScorePolicy({ values }: { values: Record<string, string> }) {
  const t = useTranslations();
  const weights = readWeights(values);
  const appreciationPoints = readAppreciationPoints(values);
  const profiles: ScoreProfile[] = ["employee", "unapproved", "manager"];
  const labels = {
    regularity: t("screens.scoring.reportingRegularity"),
    acceptance: t("screens.scoring.acceptanceRate"),
    approval: t("screens.scoring.approvalTime"),
    followUp: t("screens.scoring.followUpDiscipline"),
  };
  const profileLabels: Record<ScoreProfile, string> = {
    employee: t("screens.scoring.profileEmployee"),
    unapproved: t("screens.scoring.profileUnapproved"),
    manager: t("screens.scoring.profileManager"),
  };

  return (
    <div className="border-t border-line pt-4">
      <p className="text-[length:var(--text-sm)] font-medium text-ink">
        {t("screens.scoring.policyDistribution")}
      </p>
      <p className="mt-1 text-[length:var(--text-sm)] text-muted">
        {t("screens.scoring.policyDescription")}
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        {profiles.map((profile) => (
          <div key={profile} className="rounded-(--radius-sm) border border-line px-3.5 py-3">
            <dt className="text-[length:var(--text-sm)] font-medium text-ink">
              {profileLabels[profile]}
            </dt>
            <dd className="mt-1 text-[length:var(--text-xs)] leading-normal text-muted">
              {distribution(profileWeights(profile, weights), labels, (label, value) =>
                t("screens.scoring.weightValue", { label, value }),
              ).join(" · ")}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[length:var(--text-sm)] text-muted">
        {t("screens.scoring.policyRecognition")} {" "}
        <span className="font-medium text-ink">
          {t("screens.scoring.policyRecognitionValue", { points: appreciationPoints })}
        </span>
      </p>

      <div className="mt-5 rounded-(--radius-sm) border border-line bg-inset/30 px-3.5 py-3">
        <p className="text-[length:var(--text-sm)] font-medium text-ink">
          {t("screens.scoring.scoreTiming")}
        </p>
        <p className="mt-1 text-[length:var(--text-xs)] text-muted">
          {t("screens.scoring.scoreTimingDescription")}
        </p>
        <dl className="mt-3 grid gap-2 text-[length:var(--text-sm)] sm:grid-cols-3">
          <div>
            <dt className="text-muted">{t("screens.scoring.approvalTiming")}</dt>
            <dd className="font-medium text-ink">
              {numberValue(values, SETTING_KEYS.pendingApprovalBusinessDays, 2)} {t("screens.scoring.businessDay")}
            </dd>
            <Link className="text-xs text-primary underline-offset-4 hover:underline" href="#settings-approval-flow">
              {t("screens.scoring.approvalSetting")}
            </Link>
          </div>
          <div>
            <dt className="text-muted">{t("screens.scoring.responseTiming")}</dt>
            <dd className="font-medium text-ink">
              {numberValue(values, SETTING_KEYS.overdueAnswerBusinessDays, 3)} {t("screens.scoring.businessDay")}
            </dd>
            <Link className="text-xs text-primary underline-offset-4 hover:underline" href="#settings-questions-answers">
              {t("screens.scoring.responseSetting")}
            </Link>
          </div>
          <div>
            <dt className="text-muted">{t("screens.scoring.followUpTiming")}</dt>
            <dd className="font-medium text-ink">
              {numberValue(values, SETTING_KEYS.followUpStaleBusinessDays, 5)} {t("screens.scoring.businessDay")}
            </dd>
            <Link className="text-xs text-primary underline-offset-4 hover:underline" href="#settings-follow-up-items">
              {t("screens.scoring.followUpSetting")}
            </Link>
          </div>
        </dl>
      </div>
    </div>
  );
}
