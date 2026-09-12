import Link from "next/link";

import type { FeedItem } from "@/server/activities/scope-feed";
import { Badge, ReadDot } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import {
  formatDayLong,
  formatDayShort,
  formatInstantShort,
} from "@/shared/format/date-time";
import {
  ActivityFilters,
  type FilterOptions,
  type FilterValues,
} from "@/components/filters/activity-filters";
import type { Locale, TranslateFunction } from "@/shared/i18n";



//




function groupByDay(items: FeedItem[]): { day: string; date: Date; items: FeedItem[] }[] {
  const groups: { day: string; date: Date; items: FeedItem[] }[] = [];

  for (const item of items) {
    const key = item.activityDate.toISOString().slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === key) last.items.push(item);
    else groups.push({ day: key, date: item.activityDate, items: [item] });
  }

  return groups;
}

export type FeedFilterOptions = FilterOptions;


export function FeedRow({
  item,
  locale,
  t,
}: {
  item: FeedItem;
  locale: Locale;
  t: TranslateFunction;
}) {
  const isCancelled = item.approvalStatus === "CANCELLED";

  return (


    <li
      key={item.id}
      data-test="feed-row"
      data-read={item.read ? "yes" : "no"}
    >
      <Link
        href={`/activities/${item.id}`}
        className={[
          "flex items-start gap-3 px-4 py-3 transition-colors sm:px-5",
          "duration-(--duration-fast) hover:bg-surface-hover",
          item.read ? "" : "edge-mark text-primary",
        ].join(" ")}
      >
        <ReadDot read={item.read} />

        {/* The author's avatar answers "who wrote this?" before the name is read
            (Task 11.5). */}
        <Avatar
          user={{
            id: item.authorId,
            fullName: item.authorName,
            avatarExtension: item.authorAvatarExtension,
          }}
          size={28}
          locale={locale}
          className="mt-0.5"
        />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {/* Order number (§3.1): a compact reference to the record. */}
            <span className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
              #{item.activityNo}
            </span>
            <span
              className={
                isCancelled
                  ? "min-w-0 flex-1 truncate text-[length:var(--text-sm)] font-medium text-faint line-through"
                  : "min-w-0 flex-1 truncate text-[length:var(--text-sm)] font-medium text-ink"
              }
            >
              {item.title}
            </span>
            {isCancelled ? (
              <Badge tone="cancelled">{t("activityStatus.CANCELLED")}</Badge>
            ) : null}
            {!item.read && !isCancelled && item.approvalStatus !== "REJECTED" ? (
              <Badge tone="waiting">{t("activities.unread")}</Badge>
            ) : null}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-xs)] text-muted">
            <span className="font-medium text-ink">{item.authorName}</span>
            {/* A title is not an authorization signal; it answers "what does this
                person do?" Separators are omitted when it is empty. */}
            {item.authorTitle ? (
              <>
                <span aria-hidden className="text-line-strong">·</span>
                <span>{item.authorTitle}</span>
              </>
            ) : null}
            <span aria-hidden className="text-line-strong">·</span>
            <span>{item.authorUnitName}</span>
            {item.targetDepartmentNames.length > 0 ? (
              <>
                <span aria-hidden className="text-line-strong">·</span>
                <span className="text-faint">
                  {item.targetDepartmentNames.join(", ")}
                </span>
              </>
            ) : null}
            <span aria-hidden className="text-line-strong">·</span>
            <time dateTime={item.createdAt.toISOString()} className="text-faint">
              {t("activities.saved")}: {formatInstantShort(item.createdAt, locale)}
            </time>
          </span>
        </span>

        {/* The right column contains **only the activity date**. The saved-at
            timestamp is shown on the line above with its label.

            Previously the two values appeared as "Aug 20 / 20:42" and looked like
            one timestamp, although an activity dated August 20 could be saved on
            August 21. Labels make their relationship explicit. */}
        <time
          dateTime={item.activityDate.toISOString().slice(0, 10)}
          className="mono shrink-0 pt-0.5 text-[length:var(--text-xs)] text-faint"
        >
          {formatDayShort(item.activityDate, locale)}
        </time>
      </Link>
    </li>
  );
}

export function ScopeFeed({
  locale,
  t,
  label,
  items,
  filters,
  selected,
  nextPageHref,
  statusLabel,
  clearStatusHref,
  unreadOnly = false,
  unreadHref,
  clearUnreadHref,
  personCount,
  unreadCount,
  totalCount,
  pageSize,
  firstPageHref,
  clearHref = "/",
}: {
  locale: Locale;
  t: TranslateFunction;
  label: string;
  items: FeedItem[];
  filters: FeedFilterOptions;
  selected: FilterValues;
  nextPageHref?: string | null;
  /**
   * The status-filter label from the counter (for example, "awaiting approval").
   * The filter must be **visible**: when the list shrinks, users need to know
   * whether it is because of a filter or missing data.
   */
  statusLabel?: string | null;
  /** URL that removes the status filter. */
  clearStatusHref?: string;
  /** Feed filter that shows only unread records. */
  unreadOnly?: boolean;
  /** Unread feed URL opened by the counter badge. */
  unreadHref?: string;
  /** URL that removes the unread filter while preserving other filters. */
  clearUnreadHref?: string;
  /** Number of people in scope, shown beside the heading for context. */
  personCount?: number;
  /** Number of unread records in scope; no badge is rendered when it is zero. */
  unreadCount?: number;
  /** Total records in the filtered scope, shown in the pagination heading. */
  totalCount?: number;
  /** Records per page, used to render values such as "1-50 / 312". */
  pageSize?: number;
  /** URL for returning to the first cursor page. */
  firstPageHref?: string | null;
  /** URL that clears the filters; each page provides its own URL. */
  clearHref?: string;
}) {
  return (
    <Card id="scope" className="scroll-mt-6">
      {/* The filter controls use the selected value as their `key`.
          `defaultValue` is written to the DOM only on mount. A link from the
          department summary can reuse the same `<select>` node, leaving its old
          value visible while the list is filtered. Changing `key` remounts it. */}
      <CardHeader
        title={label}
        description={
          personCount === undefined
            ? undefined
              : t("dashboard.peopleRepresented", { count: personCount })
        }
        action={
          <span className="flex items-center gap-2">
            {/* The unread count belongs to the whole scope, not this page, so it
                must not change when a filter narrows the list. The badge says
                "in scope" when a filter is active because the two counts measure
                different things (Task 11.2). */}
            {unreadCount ? (
              unreadOnly ? (
                <Badge tone="waiting">
                  {t("dashboard.unreadCount", { count: unreadCount })}
                </Badge>
              ) : (
                <Link
                  href={unreadHref ?? "/feed?period=all&unread=1"}
                  className="rounded-(--radius-xs) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  data-test="unread-feed-link"
                >
                  <Badge tone="waiting">
                    {statusLabel
                      ? t("dashboard.inScopeUnread", { count: unreadCount })
                      : t("dashboard.unreadCount", { count: unreadCount })}
                  </Badge>
                </Link>
              )
            ) : null}
            <Badge tone="primary">
              {totalCount === undefined
                ? t("dashboard.recordCount", { count: items.length })
                : pageSize !== undefined && totalCount > pageSize
                  ? t("dashboard.recordRange", {
                      shown: items.length,
                      total: totalCount,
                    })
                  : t("dashboard.recordCount", { count: totalCount })}
            </Badge>
          </span>
        }
      />

      <ActivityFilters
        options={filters}
        selected={selected}
        clearHref={clearHref}
        pageSize={pageSize}
        unreadOnly={unreadOnly}
        hidden={unreadOnly ? [{ name: "unread", value: "1" }] : undefined}
      />

      {unreadOnly ? (
        <div
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-waiting-soft px-4 py-2.5 sm:px-5"
          data-test="unread-filter"
        >
          <p className="text-[length:var(--text-sm)] text-ink">
            {t("dashboard.onlyUnread")}
          </p>
          <Link
            href={clearUnreadHref ?? "/feed"}
            className="text-[length:var(--text-sm)] text-primary underline-offset-4 hover:underline"
          >
            {t("dashboard.clearUnreadFilter")}
          </Link>
        </div>
      ) : null}

      {statusLabel ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-inset px-4 py-2.5">
          <p className="text-[length:var(--text-sm)] text-ink">
            {t("dashboard.onlyStatus", { status: statusLabel })}
          </p>
          <Link
            href={clearStatusHref ?? "/"}
            className="text-[length:var(--text-sm)] text-primary underline-offset-4 hover:underline"
          >
            {t("common.clearFilter")}
          </Link>
        </div>
      ) : null}

      {items.length === 0 ? (
        // Reflect the reason for an empty list in the message. When a filter is
        // active, saying "no records in this period" incorrectly points users to
        // expand the period; the filter is what emptied the list (Task 11.2).
        statusLabel || unreadOnly ? (
          <EmptyState
            title={
              unreadOnly
                ? t("dashboard.noUnreadActivitiesInScope")
                : t("dashboard.noStatusRecordsInScope", { status: statusLabel ?? "" })
            }
            description={t("dashboard.clearFilterToSeeAll")}
          />
        ) : (
          <EmptyState
            title={t("dashboard.noRecordsInPeriod")}
            description={t("dashboard.tryExpandingPeriod")}
          />
        )
      ) : (
        <div>
          {groupByDay(items).map((group) => (
            <section key={group.day} aria-label={formatDayLong(group.date, locale)}>
              {/* The date strip separates logbook days. It is not sticky: on a
                  long list, a permanent strip would fill the screen instead of
                  providing context for the row being read. */}
              <h3 className="section-label flex items-center gap-3 border-y border-line bg-inset/60 px-4 py-2 sm:px-5">
                <span>{formatDayLong(group.date, locale)}</span>
                <span aria-hidden className="h-px flex-1 bg-line" />
                <span className="mono">{group.items.length}</span>
              </h3>

              <ul className="divide-y divide-line">
                {group.items.map((item) => (
                  <FeedRow key={item.id} item={item} locale={locale} t={t} />
                ))}
              </ul>
            </section>
          ))}

          {nextPageHref || firstPageHref ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3.5 sm:px-5">
              {firstPageHref ? (
                <ButtonLink href={firstPageHref} size="sm">
                  {t("dashboard.backToFirstPage")}
                </ButtonLink>
              ) : null}
              {nextPageHref ? (
                <ButtonLink href={nextPageHref} data-test="next-page" size="sm">
                  {t("common.next")}
                </ButtonLink>
              ) : null}
              {/* Cursor pagination has no numbered pages; the total keeps the
                  user's position visible. */}
              {totalCount !== undefined ? (
                <span className="ms-auto text-[length:var(--text-xs)] text-faint">
                  {t("dashboard.totalRecords", { count: totalCount })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
