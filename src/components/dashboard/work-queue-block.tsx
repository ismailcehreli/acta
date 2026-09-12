"use client";

import Link from "next/link";

import { useTranslations } from "@/components/i18n";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import type {
  WatchedItem,
  WorkItem,
  WorkKind,
} from "@/server/dashboard/work-queue";


const WORK_KIND_STYLES: Record<WorkKind, { labelKey: string; tone: BadgeTone }> = {
  answer: { labelKey: "dashboard.answer", tone: "waiting" },
  approve: { labelKey: "dashboard.approve", tone: "primary" },
  revise: { labelKey: "dashboard.revise", tone: "correction" },
};

const WORK_KIND_FROM_KEYS: Record<WorkKind, string> = {
  answer: "dashboard.askedBy",
  approve: "dashboard.submittedBy",
  revise: "dashboard.requestedChangesBy",
};

/** Render a waiting duration; zero is omitted because it adds no information. */
function formatWaitingDays(
  businessDays: number,
  t: ReturnType<typeof useTranslations>,
): string | null {
  if (businessDays <= 0) return null;
  return t("dashboard.businessDaysWaiting", { count: businessDays });
}

function Row({ item }: { item: WorkItem }) {
  const t = useTranslations();
  const type = WORK_KIND_STYLES[item.kind];
  const waiting = formatWaitingDays(item.waitingBusinessDays, t);

  return (
    <li data-test="work-item" data-type={item.kind}>
      <Link
        href={`/activities/${item.activityId}`}
        className="flex items-start gap-3 rounded-(--radius-sm) px-2 py-2.5 transition-colors hover:bg-inset"
      >
        <span className="shrink-0 pt-0.5">
          <Badge tone={type.tone}>{t(type.labelKey)}</Badge>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[length:var(--text-sm)] font-medium text-ink">
            {item.activityTitle}
          </span>
          <span className="block text-[length:var(--text-xs)] text-muted">
            {t(WORK_KIND_FROM_KEYS[item.kind], { name: item.fromName })}
            {waiting ? (
              <>
                {" · "}
                <span className={item.waitingBusinessDays >= 3 ? "text-correction" : undefined}>
                  {waiting}
                </span>
              </>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function WatchedRow({ item }: { item: WatchedItem }) {
  const t = useTranslations();
  const waiting = formatWaitingDays(item.waitingBusinessDays, t);

  return (
    <li data-test="watched-item">
      <Link
        href={`/activities/${item.activityId}`}
        className="flex items-baseline gap-2 rounded-(--radius-sm) px-2 py-1.5 transition-colors hover:bg-inset"
      >
        <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-muted">
          {item.activityTitle}
        </span>
        <span className="shrink-0 text-[length:var(--text-xs)] text-muted">
          {t("dashboard.willAnswer", { name: item.counterpartName })}
          {waiting ? ` · ${waiting}` : ""}
        </span>
      </Link>
    </li>
  );
}

export function WorkQueueBlock({
  items,
  watched,
}: {
  items: WorkItem[];
  watched: WatchedItem[];
}) {
  const t = useTranslations();
  return (
    <Card id="work-queue" data-test="assigned-work" className="scroll-mt-6">
      <CardHeader
        title={t("dashboard.assignedToMe")}
        description={
          items.length === 0
            ? undefined
            : t("dashboard.longestWaitingDescription")
        }
        action={
          items.length > 0 ? (
            <span className="flex items-center gap-2">
              {/* When approval work exists, provide a shortcut to the batch view so
                  the manager does not make ten round trips for ten records (Task 10.6). */}
              {items.some((item) => item.kind === "approve") ? (
                <Link
                  href="/approvals"
                  className="text-[length:var(--text-sm)] font-medium text-primary hover:underline"
                >
                  {t("dashboard.approveAll")}
                </Link>
              ) : null}
              <Badge tone="waiting">
                {t("dashboard.itemsCount", { count: items.length })}
              </Badge>
            </span>
          ) : null
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title={t("dashboard.noAssignedWork")}
          description={t("dashboard.assignedWorkDescription")}
        />
      ) : (
        <CardBody className="py-2">
          <ul className="flex flex-col">
            {items.map((item) => (
              <Row key={`${item.kind}:${item.activityId}`} item={item} />
            ))}
          </ul>
        </CardBody>
      )}

      {watched.length > 0 ? (
        <CardBody className="border-t border-line pt-3 pb-2">
          <p className="px-2 pb-1 text-[length:var(--text-xs)] font-medium text-muted uppercase tracking-[var(--tracking-wide)]">
            {t("dashboard.watchedByMe")}
          </p>
          <ul className="flex flex-col" data-test="watched-items">
            {watched.map((item) => (
              <WatchedRow key={item.activityId} item={item} />
            ))}
          </ul>
        </CardBody>
      ) : null}
    </Card>
  );
}
