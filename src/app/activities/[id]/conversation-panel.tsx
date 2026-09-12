"use client";

import { useActionState } from "react";

import { useLocale, useTranslations } from "@/components/i18n/provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import type { ConversationView } from "@/server/conversations/read";

import {
  askQuestionAction,
  closeConversationAction,
  replyAction,
} from "./conversation-actions";
import { emptyConversationFormState } from "./conversation-state";
import { formatInstant } from "@/shared/format/date-time";




export function AskQuestionForm({ activityId }: { activityId: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    askQuestionAction,
    emptyConversationFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="activityId" value={activityId} />

      <Field htmlFor="new-question" label={t("conversations.askQuestion")} required>
        <Textarea id="new-question" name="text" rows={3} required />
      </Field>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("conversations.submitting") : t("conversations.submitQuestion")}
        </Button>
      </div>
    </form>
  );
}

function ReplyForm({ conversationId }: { conversationId: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    replyAction,
    emptyConversationFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <label htmlFor={`reply-${conversationId}`} className="sr-only">
        {t("conversations.answer")}
      </label>
      <Textarea
        id={`reply-${conversationId}`}
        name="text"
        rows={2}
        required
        placeholder={t("conversations.writeAnswer")}
      />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <div>
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {t("common.submit")}
        </Button>
      </div>
    </form>
  );
}

function CloseForm({
  conversationId,
  requiresReason,
}: {
  conversationId: string;
  /** A required closure cannot be submitted without a reason (§9.3). */
  requiresReason: boolean;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    closeConversationAction,
    emptyConversationFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      {requiresReason ? (
        <Field
          htmlFor={`close-reason-${conversationId}`}
          label={t("conversations.closeReasonRequired")}
          required
        >
          <Textarea
            id={`close-reason-${conversationId}`}
            name="reason"
            required
            maxLength={500}
            rows={2}
          />
        </Field>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {t("conversations.close")}
        </Button>
      </div>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </form>
  );
}

function closureLabel(
  closeType: string | null,
  labels: { administrative: string; cancelled: string },
): string {
  if (closeType === "ADMINISTRATIVE") return labels.administrative;
  if (closeType === "CANCELLED_ACTIVITY") return labels.cancelled;
  return "";
}

export function ConversationList({
  conversations,
  viewerId,
  viewerIsSystemAdmin,
}: {
  conversations: ConversationView[];
  viewerId: string;
  /** A functional administrator; their closure is administrative and requires a reason (§9.3). */
  viewerIsSystemAdmin: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  if (conversations.length === 0) {
    return (
      <p className="text-[length:var(--text-sm)] text-muted">
        {t("conversations.noQuestions")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {conversations.map((conversation) => {
        const isParty =
          conversation.askerId === viewerId ||
          conversation.messages.some((m) => m.authorId === viewerId) ||
          conversation.responsibleId === viewerId;

        return (
          <li
            key={conversation.id}
            data-status={conversation.status === "OPEN" ? "open" : "closed"}
            className="rounded-(--radius-sm) border border-line bg-inset/40 p-3.5"
          >
            <div className="flex flex-wrap items-baseline gap-2 text-[length:var(--text-sm)]">
              <span className="font-medium text-ink">
                {t("conversations.asked", { name: conversation.askerName })}
              </span>
              <span className="text-[length:var(--text-xs)] text-muted tabular">
                {formatInstant(conversation.openedAt, locale)}
              </span>
              {conversation.status === "OPEN" ? (
                <Badge tone="waiting">
                  {t("conversations.responsible", {
                    name: conversation.responsibleName,
                  })}
                </Badge>
              ) : (
                <Badge>
                  {t("conversations.closedLabel")}
                  {closureLabel(conversation.closeType, {
                    administrative: t("conversations.closedByAdministrator"),
                    cancelled: t("conversations.closedBecauseActivityCancelled"),
                  })}
                </Badge>
              )}
            </div>

            {/* Messages form a left-aligned timeline: author, time, and content
                remain readable on the same line. */}
            <ul className="mt-3 flex flex-col gap-3 border-l-2 border-line pl-3">
              {conversation.messages.map((message) => (
                <li key={message.id} className="text-[length:var(--text-sm)]">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-ink">
                      {message.authorName}
                    </span>
                    <span className="text-[length:var(--text-xs)] text-muted tabular">
                      {formatInstant(message.createdAt, locale)}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-line text-muted">
                    {message.text}
                  </p>
                </li>
              ))}
            </ul>

            {conversation.status === "OPEN" ? (
              <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                {isParty ? <ReplyForm conversationId={conversation.id} /> : null}
                <CloseForm
                  conversationId={conversation.id}
                  // This only controls which field is shown. The server makes the
                  // final decision and rejects a required closure without a reason.
                  requiresReason={
                    viewerIsSystemAdmin && conversation.askerId !== viewerId
                  }
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
