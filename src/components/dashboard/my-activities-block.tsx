import Link from "next/link";
import { getTranslations } from "@/server/i18n/server";


//



//



export async function MyActivitiesBlock({
  todayCount,
  totalCount,
}: {
  todayCount: number;
  totalCount: number;
}) {
  const t = await getTranslations();
  return (
    <section
      aria-labelledby="today-record"
      className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-y border-line bg-raised px-4 py-4 sm:px-5"
    >
      <div className="flex min-w-0 items-center gap-5">
        <span className="section-label" id="today-record">
          {t("dashboard.todaysRecord")}
        </span>

        {todayCount === 0 ? (



          <p className="text-[length:var(--text-sm)] text-muted">
            {t("dashboard.recordTodayHint")}
          </p>
        ) : (
          <p className="flex items-baseline gap-2 text-[length:var(--text-sm)] text-muted">
            <span className="mono text-[length:var(--text-xl)] font-semibold text-ink">
              {todayCount}
            </span>
            <span>{t("dashboard.recordsEntered")}</span>
            <span aria-hidden className="text-line-strong">
              ·
            </span>
            <span>
              {t("dashboard.totalRecordsShort", { count: totalCount })}
            </span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <Link
          href="/activities"
          className="text-[length:var(--text-sm)] text-muted hover:text-ink hover:underline"
        >
          {t("dashboard.myActivitiesLink")}
        </Link>
        <Link
          href="/activities/new"
          className="inline-flex min-h-(--spacing-control) items-center gap-2 rounded-(--radius-sm) bg-primary px-4 text-[length:var(--text-sm)] font-medium text-white transition-colors duration-(--duration-fast) hover:bg-primary-hover active:bg-primary-pressed"
        >
          {t("dashboard.newActivityLink")}
        </Link>
      </div>
    </section>
  );
}
