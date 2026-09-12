import Link from "next/link";

import type { DeputyDecision } from "@/server/absence/deputy-read";
import { getTranslations } from "@/server/i18n/server";
import { EmptyState } from "@/components/ui/card";
import { RecordItem, RecordList } from "@/components/ui/table";
import { formatInstantShort } from "@/shared/format/date-time";
import type { Locale } from "@/shared/i18n";

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function actionKey(action: string): string {
  return action === "activity_approved"
    ? "screens.deputy.approved"
    : action === "activity_changes_requested"
      ? "screens.deputy.changesRequested"
      : action === "activity_rejected"
        ? "screens.deputy.rejected"
        : action;
}

export function DecisionList({
  decisions,
  t,
  locale,
}: {
  decisions: DeputyDecision[];
  t: Translator;
  locale: Locale;
}) {
  if (decisions.length === 0) {
    return (
      <EmptyState
        title={t("screens.deputy.noDecisions")}
        description={t("screens.deputy.noDecisionsDescription")}
      />
    );
  }

  return (
    <RecordList>
      {decisions.map((decision) => (
        <RecordItem
          key={`${decision.activityId}-${decision.at.toISOString()}`}
          data-test="delegation-decision"
          className="sm:px-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
                #{decision.activityNo}
              </span>
              <Link
                href={`/activities/${decision.activityId}`}
                className="font-medium text-ink hover:underline"
              >
                {decision.activityTitle}
              </Link>
            </p>
            <time className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
              {formatInstantShort(decision.at, locale)}
            </time>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-sm)] text-muted">
            <span className="font-medium text-ink">{t(actionKey(decision.action))}</span>
            <span aria-hidden className="text-line-strong">·</span>
            <span>{decision.authorName} {t("screens.deputy.wrote")}</span>
            {decision.onBehalfOfName ? (
              <>
                <span aria-hidden className="text-line-strong">·</span>
                <span className="text-faint">
                  {t("screens.deputy.onBehalfOf", {
                    actor: decision.actorName,
                    person: decision.onBehalfOfName,
                  })}
                </span>
              </>
            ) : null}
          </p>
        </RecordItem>
      ))}
    </RecordList>
  );
}
