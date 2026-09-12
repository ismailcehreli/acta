"use client";

import { useActionState } from "react";

import { useLocale, useTranslations } from "@/components/i18n";
import { FormMessage } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/form";
import { formatInstantShort } from "@/shared/format/date-time";
import type { Locale } from "@/shared/i18n";
import type { FeedbackStatus } from "@prisma/client";
import type { FeedbackView } from "@/server/feedback/service";

import {
  archiveFeedbackAction,
  markFeedbackReadAction,
  updateFeedbackAction,
} from "./actions";
import { emptyFeedbackFormState } from "./form-state";

export type FeedbackClientView = Omit<
  FeedbackView,
  "readAt" | "reviewedAt" | "resolvedAt" | "createdAt" | "updatedAt"
> & {
  readAt: string | null;
  reviewedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_TONES: Record<FeedbackStatus, BadgeTone> = {
  NEW: "neutral",
  IN_REVIEW: "waiting",
  RESOLVED: "success",
};

function categoryKey(category: FeedbackView["category"]): string {
  switch (category) {
    case "BUG":
      return "bug";
    case "SUGGESTION":
      return "suggestion";
    case "CRITIQUE":
      return "criticism";
    case "QUESTION":
      return "question";
  }
}

function statusKey(status: FeedbackStatus): string {
  switch (status) {
    case "NEW":
      return "newStatus";
    case "IN_REVIEW":
      return "inReviewStatus";
    case "RESOLVED":
      return "resolvedStatus";
  }
}

function time(value: string | null, locale: Locale): string | null {
  return value ? formatInstantShort(new Date(value), locale) : null;
}

function FeedbackAdminRow({ feedback }: { feedback: FeedbackClientView }) {
  const locale = useLocale();
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    updateFeedbackAction,
    emptyFeedbackFormState,
  );

  return (
    <Card data-test="feedback-management-record">
      <CardHeader
        title={feedback.title}
        description={`${t(`screens.feedback.${categoryKey(feedback.category)}`)} · ${feedback.submittedByName} · ${feedback.submittedByUnitName}`}
        action={<Badge tone={STATUS_TONES[feedback.status]}>{t(`screens.feedback.${statusKey(feedback.status)}`)}</Badge>}
      />
      <CardBody className="flex flex-col gap-4">
        <p className="whitespace-pre-line text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-ink">
          {feedback.description}
        </p>

        <div className="flex flex-wrap gap-x-8 gap-y-2 text-[length:var(--text-xs)] text-muted">
          <span>{t("screens.feedback.submittedAt")}: {time(feedback.createdAt, locale)}</span>
          {feedback.sourcePath ? <span>{t("screens.feedback.relatedSectionShort")}: {feedback.sourcePath}</span> : null}
          {feedback.adminsOnly ? <span>{t("screens.feedback.administratorsOnly")}</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-[length:var(--text-sm)]">
          {feedback.readAt ? (
            <span>
              {t("screens.feedback.read")}: {feedback.readByName ?? t("screens.feedback.manager")} · {time(feedback.readAt, locale)}
            </span>
          ) : (
            <form action={markFeedbackReadAction}>
              <input type="hidden" name="id" value={feedback.id} />
              <Button type="submit" size="sm">
                {t("screens.feedback.markRead")}
              </Button>
            </form>
          )}
          {feedback.reviewedAt ? (
            <span>
              {t("screens.feedback.reviewStarted")}: {feedback.reviewedByName ?? t("screens.feedback.manager")} · {time(feedback.reviewedAt, locale)}
            </span>
          ) : null}
        </div>

        <form action={formAction} className="flex flex-col gap-4 border-t border-line pt-4">
          <input type="hidden" name="id" value={feedback.id} />
          <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-end">
            <label className="flex flex-col gap-1.5">
              <span className="text-[length:var(--text-sm)] font-medium text-ink">{t("screens.feedback.status")}</span>
              <Select name="status" defaultValue={feedback.status}>
                <option value="NEW">{t("screens.feedback.newStatus")}</option>
                <option value="IN_REVIEW">{t("screens.feedback.inReviewStatus")}</option>
                <option value="RESOLVED">{t("screens.feedback.resolvedStatus")}</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[length:var(--text-sm)] font-medium text-ink">{t("screens.feedback.response")}</span>
              <Textarea
                name="response"
                defaultValue={feedback.response ?? ""}
                maxLength={5000}
                rows={3}
                placeholder={t("screens.feedback.responsePlaceholder")}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" variant="primary" disabled={pending}>
              {pending ? t("screens.feedback.saving") : t("screens.feedback.update")}
            </Button>
            <FormMessage error={state.error} success={state.success} />
          </div>
        </form>

        {feedback.response ? (
          <p className="border-s-2 border-primary-line ps-3 text-[length:var(--text-sm)] text-muted">
            {t("screens.feedback.currentResponse")} {feedback.response}
          </p>
        ) : null}

        {feedback.status === "RESOLVED" && feedback.resolvedAt ? (
          <p className="text-[length:var(--text-xs)] text-muted">
            {t("screens.feedback.resolved")}: {feedback.resolvedByName ?? t("screens.feedback.manager")} · {time(feedback.resolvedAt, locale)}
          </p>
        ) : null}

        <form
          action={archiveFeedbackAction}
          onSubmit={(event) => {
            if (
              !window.confirm(
                t("screens.feedback.archiveConfirm"),
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={feedback.id} />
          <Button type="submit" size="sm" variant="ghost">
            {t("screens.feedback.archive")}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function FeedbackAdmin({ feedback }: { feedback: FeedbackClientView[] }) {
  return (
    <div className="flex flex-col gap-4">
      {feedback.map((item) => (
        <FeedbackAdminRow key={item.id} feedback={item} />
      ))}
    </div>
  );
}
